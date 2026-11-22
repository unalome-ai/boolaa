// Unit tests of push-dispatch: JWT signing (APNs ES256, FCM RS256) with throwaway keys,
// Web Push encryption (RFC 8291 example + round trip) and VAPID, response classification,
// rendering and localization. No local stack needed:
//
//   deno test -A --no-check supabase/tests/push_unit.test.ts
import { apnsJwt, apnsRequest, classifyApns, resetApnsJwt, sendApns } from "../functions/push-dispatch/apns.ts";
import { classifyFcm, fcmAccessToken, fcmRequest, resetFcmToken, sendFcm } from "../functions/push-dispatch/fcm.ts";
import { b64urlDecode, b64urlEncode, decodeJwt } from "../functions/push-dispatch/jwt.ts";
import { sendItem, simulatedResponse } from "../functions/push-dispatch/dispatch.ts";
import { buildMessage, type ClaimedItem, pickLocale, render, safeName, truncate } from "../functions/push-dispatch/render.ts";
import type { PushMessage } from "../functions/push-dispatch/types.ts";
import {
  classifyWebPush, decryptPayload, encryptPayload, topicFor, vapidAuthorization, webPushRequest,
} from "../functions/push-dispatch/webpush.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}
function assertEq<T>(a: T, b: T, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

const dec = new TextDecoder();
const enc = new TextEncoder();

function pem(label: string, der: ArrayBuffer) {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  return `-----BEGIN ${label}-----\n${b64.replace(/.{64}/g, "$&\n")}\n-----END ${label}-----\n`;
}

async function verifyJwt(jwt: string, key: CryptoKey, alg: "ES256" | "RS256") {
  const [h, c, s] = jwt.split(".");
  const params = alg === "ES256" ? { name: "ECDSA", hash: "SHA-256" } : { name: "RSASSA-PKCS1-v1_5" };
  return crypto.subtle.verify(params, key, b64urlDecode(s), enc.encode(`${h}.${c}`));
}

const msg = (over: Partial<PushMessage> = {}): PushMessage => ({
  type: "chat", bubbleId: "b-1", targetId: "m-1", title: "Ana in Flatmates", body: "Pizza tonight?",
  collapseKey: "chat:b-1", category: "CHAT_MESSAGE", channelId: "chat", url: "/chat?bubble=b-1",
  expiresAt: Math.floor(Date.now() / 1000) + 3600, ...over,
});

// --- APNs --------------------------------------------------------------------------------

Deno.test("APNs: ES256 provider JWT from a .p8 (PKCS#8) key verifies and is cached", async () => {
  resetApnsJwt();
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const p8 = pem("PRIVATE KEY", await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  const cfg = { keyId: "ABC123DEFG", teamId: "W5WKF2N472", keyP8: p8, topic: "ro.boolaa.app" };
  const now = Date.now();
  const jwt = await apnsJwt(cfg, now);
  const { header, claims } = decodeJwt(jwt);
  assertEq(header, { alg: "ES256", kid: "ABC123DEFG" }, "header");
  assertEq(claims, { iss: "W5WKF2N472", iat: Math.floor(now / 1000) }, "claims");
  assert(await verifyJwt(jwt, kp.publicKey, "ES256"), "signature verifies with the public key");
  assertEq(await apnsJwt(cfg, now + 10 * 60_000), jwt, "reused within 50 minutes");
  assert((await apnsJwt(cfg, now + 51 * 60_000)) !== jwt, "refreshed after 50 minutes");
  // Literal "\n" escapes (how secrets are often pasted) work too.
  resetApnsJwt();
  assert(await verifyJwt(await apnsJwt({ ...cfg, keyP8: p8.replace(/\n/g, "\\n") }), kp.publicKey, "ES256"), "escaped newlines");
  resetApnsJwt();
});

Deno.test("APNs: request shape (host per env, topic, collapse id, thread-id, deep link)", () => {
  const { url, init } = apnsRequest("ab".repeat(32), "sandbox", msg(), "JWT", "ro.boolaa.app");
  assertEq(url, `https://api.sandbox.push.apple.com/3/device/${"ab".repeat(32)}`, "sandbox host");
  assertEq(apnsRequest("aa", "production", msg(), "J", "t").url, "https://api.push.apple.com/3/device/aa", "prod host");
  const h = init.headers as Record<string, string>;
  assertEq([h.authorization, h["apns-topic"], h["apns-push-type"], h["apns-collapse-id"]],
    ["bearer JWT", "ro.boolaa.app", "alert", "chat:b-1"], "headers");
  const body = JSON.parse(String(init.body));
  assertEq(body.aps.alert, { title: "Ana in Flatmates", body: "Pizza tonight?" }, "alert");
  assertEq([body.aps["thread-id"], body.aps.category], ["b-1", "CHAT_MESSAGE"], "thread and category");
  assertEq([body.type, body.bubble_id, body.target_id], ["chat", "b-1", "m-1"], "deep link");
});

Deno.test("APNs: response classification", () => {
  assertEq(classifyApns(200, undefined).kind, "ok", "200");
  assertEq(classifyApns(410, "Unregistered").kind, "invalid", "410");
  assertEq(classifyApns(400, "BadDeviceToken").kind, "invalid", "BadDeviceToken");
  assertEq(classifyApns(400, "DeviceTokenNotForTopic").kind, "invalid", "DeviceTokenNotForTopic");
  assertEq(classifyApns(400, "PayloadTooLarge").kind, "failed", "PayloadTooLarge");
  assertEq(classifyApns(403, "ExpiredProviderToken").kind, "retry", "expired JWT");
  assertEq(classifyApns(429, "TooManyRequests").kind, "retry", "429");
  assertEq(classifyApns(503, "ServiceUnavailable").kind, "retry", "503");
  const o = classifyApns(503, "x", new Headers({ "retry-after": "120" }));
  assertEq(o.kind === "retry" ? o.retryAfter : null, 120, "Retry-After");
});

Deno.test("APNs: sendApns reads the reason from the JSON body", async () => {
  const fake = () => Promise.resolve(new Response(JSON.stringify({ reason: "BadDeviceToken" }), { status: 400 }));
  assertEq(await sendApns("ab".repeat(32), "production", msg(), null, fake), { kind: "invalid", reason: "BadDeviceToken" }, "outcome");
});

// --- FCM ---------------------------------------------------------------------------------

Deno.test("FCM: RS256 service-account assertion verifies; access token is cached", async () => {
  resetFcmToken();
  const kp = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"]);
  const sa = {
    project_id: "boolaa-test", client_email: "push@boolaa-test.iam.gserviceaccount.com",
    private_key: pem("PRIVATE KEY", await crypto.subtle.exportKey("pkcs8", kp.privateKey)),
    token_uri: "https://oauth2.googleapis.com/token",
  };
  let calls = 0;
  let verified = false;
  const fake = async (url: string, init: RequestInit) => {
    calls++;
    assertEq(url, "https://oauth2.googleapis.com/token", "token uri");
    const form = new URLSearchParams(String(init.body));
    assertEq(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer", "grant type");
    const assertion = form.get("assertion")!;
    verified = await verifyJwt(assertion, kp.publicKey, "RS256");
    const { header, claims } = decodeJwt(assertion);
    assertEq(header, { alg: "RS256", typ: "JWT" }, "header");
    assertEq([claims.iss, claims.scope, claims.aud, (claims.exp as number) - (claims.iat as number)],
      [sa.client_email, "https://www.googleapis.com/auth/firebase.messaging", sa.token_uri, 3600], "claims");
    return new Response(JSON.stringify({ access_token: "ya29.test", expires_in: 3599, token_type: "Bearer" }));
  };
  const now = Date.now();
  assertEq(await fcmAccessToken(sa, fake, now), "ya29.test", "token");
  assert(verified, "assertion signature verifies");
  assertEq(await fcmAccessToken(sa, fake, now + 30 * 60_000), "ya29.test", "cached");
  assertEq(calls, 1, "one OAuth call while valid");
  await fcmAccessToken(sa, fake, now + 56 * 60_000);
  assertEq(calls, 2, "refreshed 5 minutes before expiry");

  // A full send: OAuth token reused, message shape.
  let sent: { url: string; body: any; auth: string } | null = null;
  const fake2 = (url: string, init: RequestInit) => {
    sent = { url, body: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>).authorization };
    return Promise.resolve(new Response(JSON.stringify({ name: "projects/boolaa-test/messages/1" })));
  };
  assertEq((await sendFcm("fcm-token-123", msg(), sa, fake2)).kind, "ok", "send ok");
  assertEq(sent!.url, "https://fcm.googleapis.com/v1/projects/boolaa-test/messages:send", "endpoint");
  assertEq(sent!.auth, "Bearer ya29.test", "bearer");
  resetFcmToken();
});

Deno.test("FCM: message has notification, string data, collapse key and channel", () => {
  const { init } = fcmRequest("p", "tok", msg({ channelId: "events", collapseKey: "event:e1" }), "AT");
  const m = JSON.parse(String(init.body)).message;
  assertEq(m.token, "tok", "token");
  assertEq(m.notification, { title: "Ana in Flatmates", body: "Pizza tonight?" }, "notification");
  assertEq(m.data, { type: "chat", bubble_id: "b-1", target_id: "m-1", collapse_key: "event:e1" }, "data");
  assertEq([m.android.collapse_key, m.android.notification.channel_id, m.android.notification.tag, m.android.priority],
    ["event:e1", "events", "event:e1", "HIGH"], "android");
  assert(Object.values(m.data).every((v) => typeof v === "string"), "data values are strings");
});

Deno.test("FCM: response classification", () => {
  const err = (code: number, status: string, errorCode?: string, message = "") => ({
    error: { code, status, message, details: errorCode ? [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode }] : [] },
  });
  assertEq(classifyFcm(200, null).kind, "ok", "200");
  assertEq(classifyFcm(404, err(404, "NOT_FOUND", "UNREGISTERED")).kind, "invalid", "UNREGISTERED");
  assertEq(classifyFcm(403, err(403, "PERMISSION_DENIED", "SENDER_ID_MISMATCH")).kind, "invalid", "sender mismatch");
  assertEq(classifyFcm(400, err(400, "INVALID_ARGUMENT", "INVALID_ARGUMENT", "The registration token is not a valid FCM registration token")).kind,
    "invalid", "malformed token");
  assertEq(classifyFcm(400, err(400, "INVALID_ARGUMENT", "INVALID_ARGUMENT", "Invalid JSON payload")).kind, "failed", "bad payload");
  assertEq(classifyFcm(401, err(401, "UNAUTHENTICATED")).kind, "retry", "401");
  assertEq(classifyFcm(429, err(429, "RESOURCE_EXHAUSTED", "QUOTA_EXCEEDED")).kind, "retry", "quota");
  assertEq(classifyFcm(503, err(503, "UNAVAILABLE", "UNAVAILABLE")).kind, "retry", "unavailable");
});

// --- Web Push ----------------------------------------------------------------------------

Deno.test("Web Push: RFC 8291 §5 example encrypts to the published message", async () => {
  // https://www.rfc-editor.org/rfc/rfc8291#section-5
  const plaintext = "When I grow up, I want to be a watermelon";
  const asPublic = "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
  const asPrivateD = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw";
  const uaPublic = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
  const uaPrivateD = "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94";
  const salt = "DGv6ra1nlYgDCS1FRnbzlw";
  const authSecret = "BTBZMqHH6r4Tts7J_aSIgg"; // gitleaks:allow (public RFC 8291 test vector)
  const expected = "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN";

  const ecdhKey = (d: string, pub: string) => {
    const p = b64urlDecode(pub);
    return crypto.subtle.importKey("jwk", {
      kty: "EC", crv: "P-256", d, x: b64urlEncode(p.subarray(1, 33)), y: b64urlEncode(p.subarray(33)), ext: true,
    }, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  };
  const body = await encryptPayload(enc.encode(plaintext), uaPublic, authSecret, {
    salt: b64urlDecode(salt),
    asKeyPair: { privateKey: await ecdhKey(asPrivateD, asPublic), publicKey: b64urlDecode(asPublic) },
  });
  assertEq(b64urlEncode(body), expected, "ciphertext matches RFC 8291");
  const back = await decryptPayload(b64urlDecode(expected), await ecdhKey(uaPrivateD, uaPublic), uaPublic, authSecret);
  assertEq(dec.decode(back), plaintext, "the RFC message decrypts");
});

Deno.test("Web Push: round trip with a freshly generated subscription", async () => {
  const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const p256dh = b64urlEncode(await crypto.subtle.exportKey("raw", ua.publicKey));
  const auth = b64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
  const text = JSON.stringify({ title: "Ana în Flatmates", body: "Pizza diseară? 🍕" });
  const a = await encryptPayload(enc.encode(text), p256dh, auth);
  const b = await encryptPayload(enc.encode(text), p256dh, auth);
  assert(b64urlEncode(a) !== b64urlEncode(b), "fresh salt and key per message");
  assertEq(dec.decode(await decryptPayload(a, ua.privateKey, p256dh, auth)), text, "decrypts");
  assertEq(new DataView(a.buffer).getUint32(16), 4096, "record size");
  assertEq(a[20], 65, "keyid is the 65-byte server key");
  const tampered = a.slice();
  tampered[tampered.length - 1] ^= 1;
  let threw = false;
  try {
    await decryptPayload(tampered, ua.privateKey, p256dh, auth);
  } catch {
    threw = true;
  }
  assert(threw, "tampered ciphertext is rejected");
});

Deno.test("Web Push: VAPID header and full request", async () => {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const keys = {
    publicKey: b64urlEncode(await crypto.subtle.exportKey("raw", kp.publicKey)),
    privateKey: (await crypto.subtle.exportKey("jwk", kp.privateKey)).d!,
    subject: "mailto:hello@boolaa.ro",
  };
  const endpoint = "https://fcm.googleapis.com/fcm/send/abc:def";
  const now = Date.now();
  const h = await vapidAuthorization(endpoint, keys, now);
  const m = h.match(/^vapid t=([^,]+), k=(.+)$/);
  assert(m, `header format: ${h}`);
  assertEq(m![2], keys.publicKey, "k = public key");
  const { header, claims } = decodeJwt(m![1]);
  assertEq(header, { typ: "JWT", alg: "ES256" }, "jwt header");
  assertEq(claims.aud, "https://fcm.googleapis.com", "aud = origin");
  assertEq(claims.sub, "mailto:hello@boolaa.ro", "sub");
  assert((claims.exp as number) - Math.floor(now / 1000) <= 24 * 3600, "exp within 24 h");
  assert(await verifyJwt(m![1], kp.publicKey, "ES256"), "VAPID signature verifies");

  const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const sub = {
    endpoint,
    p256dh: b64urlEncode(await crypto.subtle.exportKey("raw", ua.publicKey)),
    auth: b64urlEncode(crypto.getRandomValues(new Uint8Array(16))),
  };
  const req = await webPushRequest(sub, msg(), keys, now);
  const rh = req.init.headers as Record<string, string>;
  assertEq([rh["content-encoding"], rh.urgency], ["aes128gcm", "high"], "headers");
  assertEq(rh.topic, await topicFor("chat:b-1"), "topic from collapse key");
  assert(/^[A-Za-z0-9_-]{1,32}$/.test(rh.topic), "topic is <= 32 url-safe chars");
  const payload = JSON.parse(dec.decode(await decryptPayload(req.init.body as Uint8Array, ua.privateKey, sub.p256dh, sub.auth)));
  assertEq(payload, {
    title: "Ana in Flatmates", body: "Pizza tonight?", tag: "chat:b-1", url: "/chat?bubble=b-1",
    type: "chat", bubble_id: "b-1", target_id: "m-1",
  }, "service worker payload");
});

Deno.test("Web Push: response classification", () => {
  assertEq(classifyWebPush(201).kind, "ok", "201");
  assertEq(classifyWebPush(404).kind, "invalid", "404");
  assertEq(classifyWebPush(410).kind, "invalid", "410");
  assertEq(classifyWebPush(413).kind, "failed", "413");
  assertEq(classifyWebPush(403).kind, "failed", "403 (VAPID mismatch)");
  assertEq(classifyWebPush(429).kind, "retry", "429");
  assertEq(classifyWebPush(502).kind, "retry", "502");
});

// --- Rendering ---------------------------------------------------------------------------

const item = (over: Partial<ClaimedItem> = {}): ClaimedItem => ({
  id: 1, type: "chat", bubble_id: "b-1", target_id: "m-1", collapse_key: "chat:b-1", attempts: 1, count: 1,
  bubble_name: "Flatmates", actor_name: "Ana", preview_content: true, user_locale: null,
  data: { text: "Pizza tonight?" }, tokens: [], ...over,
});
const tok = (locale: string | null) =>
  ({ id: "t", platform: "android", token: "x", endpoint: null, p256dh: null, auth: null, apns_env: null, locale }) as const;

Deno.test("render: chat text, preview off, coalesced count and plural forms", () => {
  assertEq(render(item(), "en"), { title: "Ana in Flatmates", body: "Pizza tonight?" }, "en");
  assertEq(render(item(), "ro"), { title: "Ana în Flatmates", body: "Pizza tonight?" }, "ro (content not translated)");
  assertEq(render(item({ preview_content: false }), "en"), { title: "Boolaa", body: "New message in Flatmates" }, "private");
  assertEq(render(item({ preview_content: false, count: 3 }), "en").body, "3 new messages in Flatmates", "private plural");
  assertEq(render(item({ preview_content: false, count: 3 }), "ro").body, "3 mesaje noi în Flatmates", "ro few");
  assertEq(render(item({ preview_content: false, count: 21 }), "ro").body, "21 de mesaje noi în Flatmates", "ro other");
  assertEq(render(item({ count: 2 }), "en").body, "Pizza tonight? +1 more message", "coalesced");
  assertEq(render(item({ count: 4 }), "fr").body, "Pizza tonight? +3 autres messages", "fr plural");
  for (const l of ["en", "ro", "fr", "es", "it"] as const) {
    for (const type of ["chat", "join_request", "approval", "new_event", "event_reminder", "food", "market"] as const) {
      for (const preview_content of [true, false]) {
        const r = render(item({ type, preview_content, data: { text: "t", title: "Dinner", location: "Kitchen", status: "trade" } }), l);
        assert(r.title && r.body && !/[{}#]/.test(r.title + r.body), `${l} ${type} ${preview_content}: ${JSON.stringify(r)}`);
        if (!preview_content) assert(!/Ana|Dinner|Kitchen/.test(r.title + r.body), `${l} ${type} private leaks content`);
      }
    }
  }
});

Deno.test("render: each type in English", () => {
  const d = { title: "Flat dinner", location: "Kitchen", status: "trade", text: "Leftover salad" };
  const r = (type: ClaimedItem["type"], data: Record<string, unknown> = d) => render(item({ type, data }), "en");
  assertEq(r("join_request"), { title: "Flatmates", body: "Ana wants to join" }, "join_request");
  assertEq(r("approval"), { title: "You're in Flatmates!", body: "Your join request was approved. Say hi!" }, "approval");
  assertEq(r("new_event"), { title: "New event in Flatmates", body: "Ana added Flat dinner" }, "new_event");
  assertEq(r("event_reminder"), { title: "Flat dinner", body: "Starts in 1 hour · Kitchen" }, "reminder");
  assertEq(r("event_reminder", { title: "Flat dinner" }).body, "Starts in 1 hour", "reminder without place");
  assertEq(r("food"), { title: "Food Circle · Flatmates", body: "Ana: Leftover salad" }, "food");
  assertEq(r("food", {}).body, "Ana shared something to eat", "food without text");
  assertEq(r("market", { title: "Old sofa", status: "free" }), { title: "Marketplace · Flatmates", body: "Ana: Old sofa (Free)" }, "market");
});

Deno.test("render: truncation to ~100 graphemes, names never carry an email", () => {
  const long = "ă".repeat(80) + " " + "🍕".repeat(60);
  const t = truncate(long);
  assertEq([...new Intl.Segmenter().segment(t)].length, 100, "100 graphemes");
  assert(t.endsWith("…"), "ellipsis");
  assertEq(truncate("line one\n\nline   two"), "line one line two", "single line");
  assertEq(safeName("ana.pop@example.com", "Someone"), "ana.pop", "email stripped from name");
  assertEq(safeName("  ", "Someone"), "Someone", "fallback");
  const r = render(item({ actor_name: "bob@mail.ro", data: { text: "x".repeat(300) } }), "en");
  assert(!r.title.includes("@"), "no address in title");
  assert([...r.body].length <= 100, "body truncated");
});

Deno.test("localization: token locale, then the user's locale, then English", () => {
  assertEq(pickLocale("ro", "fr"), "ro", "token first");
  assertEq(pickLocale(null, "fr-FR"), "fr", "user next");
  assertEq(pickLocale("de", undefined), "en", "unsupported falls back to en");
  assertEq(buildMessage(item({ user_locale: "es" }), tok(null)).title, "Ana en Flatmates", "user locale es");
  assertEq(buildMessage(item({ user_locale: "es" }), tok("it")).title, "Ana in Flatmates", "token locale it wins");
  const m = buildMessage(item({ type: "event_reminder", data: { title: "X", starts_at: new Date(Date.now() + 3600_000).toISOString() } }), tok("fr"));
  assertEq([m.channelId, m.category, m.body], ["events", "EVENT_REMINDER", "Commence dans 1 heure"], "reminder fr");
  assert(Math.abs(m.expiresAt - (Date.now() / 1000 + 3600)) < 5, "reminder expires at the start");
  assertEq(buildMessage(item({ type: "market" }), tok(null)).url, "/marketplace?bubble=b-1&item=m-1", "web url");
});

Deno.test("dispatch: per-token outcomes fold into one row result", async () => {
  const tokens = [
    { id: "a", platform: "android", token: "ok-token-000000000000", endpoint: null, p256dh: null, auth: null, apns_env: null, locale: "en" },
    { id: "b", platform: "android", token: "invalid-token-0000000", endpoint: null, p256dh: null, auth: null, apns_env: null, locale: "en" },
    { id: "c", platform: "ios", token: "beef" + "0".repeat(60), endpoint: null, p256dh: null, auth: null, apns_env: "sandbox", locale: "en" },
  ] as ClaimedItem["tokens"];
  const p = {
    apns: null, fcm: null, vapid: null,
    fetchFor: (_i: ClaimedItem, t: { platform: string; token: string }) => () => {
      const s = simulatedResponse(t.platform === "ios" ? "apns" : "fcm", t.token);
      return Promise.resolve(new Response(s.body === null ? null : JSON.stringify(s.body), { status: s.status }));
    },
  };
  const r = await sendItem(item({ tokens }), p);
  assertEq(r.invalid, ["b"], "invalid token reported");
  assertEq([r.result.status, r.result.retry_token_ids], ["retry", ["c"]], "only the transient token is retried");
  const r2 = await sendItem(item({ tokens: tokens.slice(0, 2) }), p);
  assertEq(r2.result.status, "sent", "sent when one token worked and none is transient");
  const r3 = await sendItem(item({ tokens: [tokens[1]] }), p);
  assertEq([r3.result.status, r3.invalid], ["failed", ["b"]], "all invalid: failed, token deleted");
});
