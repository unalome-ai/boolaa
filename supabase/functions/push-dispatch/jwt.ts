// Base64url and JWT (ES256 / RS256) helpers on WebCrypto. No dependencies.

const enc = new TextEncoder();

export function b64urlEncode(data: Uint8Array | ArrayBuffer | string): string {
  const bytes = typeof data === "string" ? enc.encode(data) : new Uint8Array(data);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type Bytes = Uint8Array<ArrayBuffer>;

export function b64urlDecode(s: string): Bytes {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** DER bytes of a PEM block ("-----BEGIN PRIVATE KEY-----" ...). Accepts literal "\n" escapes. */
export function pemToDer(pem: string): Bytes {
  const body = pem.replace(/\\n/g, "\n").replace(/-----(BEGIN|END)[^-]+-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

/** APNs .p8 key (PKCS#8, EC P-256) for ES256. */
export function importEs256Pkcs8(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", pemToDer(pem), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

/** Google service-account private_key (PKCS#8, RSA) for RS256. */
export function importRs256Pkcs8(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", pemToDer(pem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

/** P-256 private key from raw base64url `d` plus the uncompressed public key (65 bytes). */
export function importEcPrivateRaw(d: string, publicKey: Uint8Array): Promise<CryptoKey> {
  if (publicKey.length !== 65 || publicKey[0] !== 4) throw new Error("expected an uncompressed P-256 public key");
  return crypto.subtle.importKey("jwk", {
    kty: "EC", crv: "P-256", d,
    x: b64urlEncode(publicKey.subarray(1, 33)),
    y: b64urlEncode(publicKey.subarray(33, 65)),
    ext: true,
  }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

export async function signJwt(
  header: Record<string, unknown>,
  claims: Record<string, unknown>,
  key: CryptoKey,
): Promise<string> {
  const input = `${b64urlEncode(JSON.stringify(header))}.${b64urlEncode(JSON.stringify(claims))}`;
  const alg = header.alg === "ES256"
    ? { name: "ECDSA", hash: "SHA-256" }
    : { name: "RSASSA-PKCS1-v1_5" };
  // WebCrypto ECDSA signatures are already raw r||s (64 bytes), as JWS ES256 requires.
  const sig = await crypto.subtle.sign(alg, key, enc.encode(input));
  return `${input}.${b64urlEncode(sig)}`;
}

export function decodeJwt(jwt: string): { header: Record<string, unknown>; claims: Record<string, unknown> } {
  const [h, c] = jwt.split(".");
  const dec = new TextDecoder();
  return { header: JSON.parse(dec.decode(b64urlDecode(h))), claims: JSON.parse(dec.decode(b64urlDecode(c))) };
}
