// Web Push: message encryption (RFC 8291, "aes128gcm" content coding of RFC 8188) and
// VAPID (RFC 8292), on WebCrypto only. Tested against the RFC 8291 example and with a
// round trip (supabase/tests/push_unit.test.ts).
import { b64urlDecode, b64urlEncode, type Bytes, concat, importEcPrivateRaw, signJwt } from "./jwt.ts";
import { deepLink, type FetchFn, type Outcome, type PushMessage, retryAfterSeconds } from "./types.ts";

const enc = new TextEncoder();
const RECORD_SIZE = 4096;

export interface WebSubscription {
  endpoint: string;
  p256dh: string; // base64url, uncompressed P-256 point (65 bytes)
  auth: string; // base64url, 16 bytes
}

export interface VapidKeys {
  publicKey: string; // base64url, 65 bytes (what the browser gets as applicationServerKey)
  privateKey: string; // base64url, 32 bytes (the raw `d`)
  subject: string; // mailto:hello@boolaa.ro
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, bytes: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

async function deriveKeys(
  ecdhSecret: Bytes,
  authSecret: Bytes,
  uaPublic: Bytes,
  asPublic: Bytes,
  salt: Bytes,
) {
  // RFC 8291 §3.4: IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0x00 || ua_public || as_public, 32)
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  // RFC 8188 §2.2 / §2.3
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  return { cek, nonce };
}

export interface EncryptOptions {
  /** Test vectors only: fixed salt and application-server ECDH key pair. */
  salt?: Bytes;
  asKeyPair?: { privateKey: CryptoKey; publicKey: Bytes };
}

/** Encrypts one push message into a single aes128gcm record (header included). */
export async function encryptPayload(
  plaintext: Bytes,
  uaPublicB64: string,
  authB64: string,
  opts: EncryptOptions = {},
): Promise<Bytes> {
  const uaPublic = b64urlDecode(uaPublicB64);
  const authSecret = b64urlDecode(authB64);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error("invalid p256dh");
  if (authSecret.length !== 16) throw new Error("invalid auth secret");
  // Header (86 bytes) + delimiter + 16-byte tag must fit in one record.
  if (plaintext.length > RECORD_SIZE - 86 - 17) throw new Error("payload too large");

  let asPrivate: CryptoKey, asPublic: Bytes;
  if (opts.asKeyPair) {
    asPrivate = opts.asKeyPair.privateKey;
    asPublic = opts.asKeyPair.publicKey;
  } else {
    const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
    asPrivate = kp.privateKey;
    asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  }
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));

  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asPrivate, 256));
  const { cek, nonce } = await deriveKeys(ecdhSecret, authSecret, uaPublic, asPublic, salt);

  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // Single (last) record: plaintext || 0x02, no extra padding.
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, concat(plaintext, new Uint8Array([2]))),
  );
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

/** The user agent's side (what a browser does): used by the tests. */
export async function decryptPayload(
  body: Uint8Array,
  uaPrivate: CryptoKey,
  uaPublicB64: string,
  authB64: string,
): Promise<Bytes> {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, uaPrivate, 256));
  const { cek, nonce } = await deriveKeys(ecdhSecret, b64urlDecode(authB64), b64urlDecode(uaPublicB64), asPublic, salt);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aes, ciphertext));
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  if (end < 0 || padded[end] !== 2) throw new Error("bad padding delimiter");
  return padded.slice(0, end);
}

const vapidCache = new Map<string, { header: string; exp: number }>();

/** RFC 8292 `Authorization: vapid t=<jwt>, k=<public key>` for the endpoint's origin. */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, now = Date.now()): Promise<string> {
  const aud = new URL(endpoint).origin;
  const hit = vapidCache.get(aud);
  const nowS = Math.floor(now / 1000);
  if (hit && hit.exp - nowS > 3600) return hit.header;
  const exp = nowS + 12 * 3600; // at most 24 h (RFC 8292 §2)
  const key = await importEcPrivateRaw(keys.privateKey, b64urlDecode(keys.publicKey));
  const jwt = await signJwt({ typ: "JWT", alg: "ES256" }, { aud, exp, sub: keys.subject }, key);
  const header = `vapid t=${jwt}, k=${keys.publicKey}`;
  vapidCache.set(aud, { header, exp });
  return header;
}

/** Topic header: up to 32 URL-safe base64 characters (RFC 8030 §5.4). */
export async function topicFor(collapseKey: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", enc.encode(collapseKey));
  return b64urlEncode(h).slice(0, 32);
}

/** JSON the service worker receives (push event `event.data.json()`). */
export function webPayload(m: PushMessage) {
  return { title: m.title, body: m.body, tag: m.collapseKey ?? undefined, url: m.url, ...deepLink(m) };
}

export async function webPushRequest(
  sub: WebSubscription,
  m: PushMessage,
  keys: VapidKeys,
  now = Date.now(),
): Promise<{ url: string; init: RequestInit }> {
  const body = await encryptPayload(enc.encode(JSON.stringify(webPayload(m))), sub.p256dh, sub.auth);
  const headers: Record<string, string> = {
    authorization: await vapidAuthorization(sub.endpoint, keys, now),
    "content-encoding": "aes128gcm",
    "content-type": "application/octet-stream",
    ttl: String(Math.max(0, m.expiresAt - Math.floor(now / 1000))),
    urgency: m.type === "chat" || m.type === "chat_mention" || m.type === "event_reminder" ? "high" : "normal",
  };
  if (m.collapseKey) headers.topic = await topicFor(m.collapseKey);
  return { url: sub.endpoint, init: { method: "POST", headers, body } };
}

export function classifyWebPush(status: number, headers?: Headers): Outcome {
  if (status >= 200 && status < 300) return { kind: "ok" };
  if (status === 404 || status === 410) return { kind: "invalid", reason: `http_${status}` };
  if (status === 429 || status >= 500) {
    return { kind: "retry", reason: `http_${status}`, retryAfter: headers ? retryAfterSeconds(headers) : undefined };
  }
  return { kind: "failed", reason: `http_${status}` }; // 400/401/403 (VAPID setup), 413 (too large)
}

export async function sendWebPush(sub: WebSubscription, m: PushMessage, keys: VapidKeys | null, fetchFn: FetchFn): Promise<Outcome> {
  if (!keys) return { kind: "retry", reason: "vapid_not_configured" };
  let req;
  try {
    req = await webPushRequest(sub, m, keys);
  } catch (e) {
    const msg = (e as Error).message;
    // Unusable keys mean a broken subscription (delete it); anything else is about this message.
    return /p256dh|auth secret|point|key/i.test(msg)
      ? { kind: "invalid", reason: `bad_subscription: ${msg}`.slice(0, 200) }
      : { kind: "failed", reason: msg.slice(0, 200) };
  }
  const res = await fetchFn(req.url, req.init);
  await res.body?.cancel();
  return classifyWebPush(res.status, res.headers);
}
