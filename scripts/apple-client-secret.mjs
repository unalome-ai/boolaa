#!/usr/bin/env node
// Signs the "Sign in with Apple" client secret (an ES256 JWT, valid for at most 6 months)
// and installs it on the hosted Supabase project. The secret is never printed.
//
// Usage: node scripts/apple-client-secret.mjs [--dry-run]
// Needs: ~/.boolaa-signing/AuthKey_<KEY_ID>.p8 and the Keychain item "supabase-boolaa-token".
// Re-run it before the expiry date it prints; web and Android Apple sign-in break after that.
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";

const TEAM_ID = "W5WKF2N472";
const KEY_ID = "HTL62BCS2D";
const SERVICES_ID = "ro.boolaa.web"; // web + Android (OAuth redirect); the JWT "sub"
const APP_ID = "ro.boolaa.app"; // native iOS id_token audience
const PROJECT_REF = "rstugahfcpwllumgxwrm";
const LIFETIME_S = 180 * 24 * 3600; // Apple's maximum is 15777000 s (~182.6 days)

const b64url = (b) => Buffer.from(b).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const header = { alg: "ES256", kid: KEY_ID, typ: "JWT" };
const payload = { iss: TEAM_ID, iat: now, exp: now + LIFETIME_S, aud: "https://appleid.apple.com", sub: SERVICES_ID };
const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
const key = createPrivateKey(readFileSync(`${homedir()}/.boolaa-signing/AuthKey_${KEY_ID}.p8`));
const sig = sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" });
const jwt = `${input}.${b64url(sig)}`;

const expires = new Date((now + LIFETIME_S) * 1000).toISOString().slice(0, 10);
if (process.argv.includes("--dry-run")) {
  console.log(`signed OK (length ${jwt.length}), would expire ${expires}`);
  process.exit(0);
}

const token = execFileSync("security", ["find-generic-password", "-s", "supabase-boolaa-token", "-w"]).toString().trim();
const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`, {
  method: "PATCH",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    external_apple_enabled: true,
    external_apple_client_id: `${SERVICES_ID},${APP_ID}`,
    external_apple_secret: jwt,
  }),
});
if (!res.ok) {
  console.error(`Supabase PATCH failed: ${res.status}`);
  process.exit(1);
}
console.log(`Apple sign-in secret installed. Expires ${expires}; re-run this script before then.`);
