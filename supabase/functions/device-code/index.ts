// Emailed 6-digit codes for (a) signing in on a new device and (b) re-confirming a
// sensitive action (delete_account, change_password, change_email, export_data). Called by clients
// with their user JWT:
//
//   POST /functions/v1/device-code
//   { "action": "send",   "purpose": "device", "device_id": "<secret>" }
//   { "action": "verify", "purpose": "device", "device_id": "<secret>", "code": "123456", "label": "iPhone" }
//   { "action": "send",   "purpose": "sensitive_action", "sensitive_action": "delete_account" }
//   { "action": "verify", "purpose": "sensitive_action", "code": "123456" }
//
// Codes are stored only as HMAC-SHA256(DEVICE_CODE_SECRET, ...) and compared in
// constant time here; attempts/limits are enforced atomically in SQL.
// Contract and error codes: docs/auth-security.md.
import { createClient } from "npm:@supabase/supabase-js@2";
import { render, sensitiveActionLabel, unknownDeviceLabel } from "../_shared/email/render.ts";
import { sendMail } from "../_shared/mailer.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function sha256Hex(s: string) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

let hmacKey: CryptoKey | null = null;
async function hmacHex(message: string) {
  if (!hmacKey) {
    const secret = Deno.env.get("DEVICE_CODE_SECRET");
    if (!secret || secret.length < 32) throw new Error("DEVICE_CODE_SECRET missing or shorter than 32 chars");
    hmacKey = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  }
  return hex(await crypto.subtle.sign("HMAC", hmacKey, enc.encode(message)));
}

function timingSafeEqual(a: string, b: string): boolean {
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// Uniform 6-digit code (rejection sampling avoids modulo bias).
function newCode(): string {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return String(buf[0] % 1_000_000).padStart(6, "0");
}

const codeMessage = (userId: string, purpose: string, deviceHash: string | null, code: string) =>
  `boolaa-email-code:v1:${userId}:${purpose}:${deviceHash ?? "-"}:${code}`;

function decodeJwt(token: string): Record<string, unknown> {
  const part = token.split(".")[1] ?? "";
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
}

// Maps the SQL helper exceptions to HTTP responses.
const SQL_ERRORS: Record<string, [number, string]> = {
  rate_limited: [429, "rate_limited"],
  no_active_code: [404, "no_active_code"],
  too_many_attempts: [423, "too_many_attempts"],
  code_expired: [410, "code_expired"],
};
function sqlError(message: string | undefined) {
  const hit = Object.keys(SQL_ERRORS).find((k) => message?.includes(k));
  if (hit) return json(SQL_ERRORS[hit][0], { error: SQL_ERRORS[hit][1] });
  console.error("device-code sql error", message);
  return json(500, { error: "server_error" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  // 1. Authenticate: GoTrue validates the JWT (signature, expiry, session still alive).
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json(401, { error: "unauthorized" });
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) return json(401, { error: "unauthorized" });
  const user = userData.user;
  const claims = decodeJwt(jwt);
  const sessionId = typeof claims.session_id === "string" ? claims.session_id : null;
  if (!sessionId) return json(401, { error: "unauthorized" });

  // 2. Validate input.
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_request" });
  }
  const action = body.action, purpose = body.purpose;
  if ((action !== "send" && action !== "verify") || (purpose !== "device" && purpose !== "sensitive_action")) {
    return json(400, { error: "invalid_request" });
  }
  let deviceHash: string | null = null;
  if (purpose === "device") {
    const id = body.device_id;
    if (typeof id !== "string" || id.length < 16 || id.length > 512) return json(400, { error: "invalid_request" });
    deviceHash = await sha256Hex(id);
  } else {
    // Re-confirmation only makes sense for a session that already passed the device check.
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: ok, error } = await userClient.rpc("is_device_verified");
    if (error) return sqlError(error.message);
    if (!ok) return json(403, { error: "session_not_verified" });
    // "Download my data" is limited to once an hour: don't email a code that can't be used
    // (export_my_data still checks the limit itself).
    if (action === "send" && body.sensitive_action === "export_data") {
      const { data: availableAt, error: limitErr } = await userClient.rpc("data_export_available_at");
      if (limitErr) return sqlError(limitErr.message);
      if (typeof availableAt === "string") {
        const retryAfter = Math.max(1, Math.ceil((Date.parse(availableAt) - Date.now()) / 1000));
        return json(429, { error: "export_rate_limited", retry_after: retryAfter, available_at: availableAt });
      }
    }
  }
  const label = typeof body.label === "string" ? body.label.slice(0, 120) : null;

  // 3a. Send a new code.
  if (action === "send") {
    const code = newCode();
    const { data: issued, error } = await admin.rpc("issue_email_challenge", {
      p_user_id: user.id,
      p_session_id: sessionId,
      p_purpose: purpose,
      p_device_hash: deviceHash,
      p_code_hash: await hmacHex(codeMessage(user.id, purpose, deviceHash, code)),
    });
    if (error) return sqlError(error.message);

    const meta = user.user_metadata ?? {};
    const locale = typeof meta.locale === "string" ? meta.locale : (typeof body.locale === "string" ? body.locale : null);
    const vars: Record<string, string> = { minutes: "10" };
    if (purpose === "device") vars.device = label?.trim() || unknownDeviceLabel(locale ?? "en");
    else vars.action = sensitiveActionLabel(locale ?? "en", typeof body.sensitive_action === "string" ? body.sensitive_action : undefined);
    try {
      await sendMail({
        to: user.email!,
        ...render({
          template: purpose === "device" ? "device" : "sensitive_action",
          locale,
          name: typeof meta.name === "string" ? meta.name : null,
          code,
          vars,
        }),
      });
    } catch (e) {
      console.error("device-code email failed", (e as Error).message);
      return json(502, { error: "email_failed" });
    }
    return json(200, { status: "sent", expires_at: issued?.expires_at });
  }

  // 3b. Verify a code.
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!/^\d{6}$/.test(code)) return json(400, { error: "invalid_request" });

  const { data: attempt, error: attemptErr } = await admin.rpc("attempt_email_challenge", {
    p_user_id: user.id,
    p_session_id: sessionId,
    p_purpose: purpose,
    p_device_hash: deviceHash,
  });
  if (attemptErr) return sqlError(attemptErr.message);

  const expected = await hmacHex(codeMessage(user.id, purpose, deviceHash, code));
  if (!timingSafeEqual(expected, attempt.code_hash)) {
    return attempt.attempts_left > 0
      ? json(400, { error: "invalid_code", attempts_left: attempt.attempts_left })
      : json(423, { error: "too_many_attempts" });
  }

  const { error: doneErr } = await admin.rpc("complete_email_challenge", {
    p_challenge_id: attempt.id,
    p_session_id: sessionId,
    p_label: label,
  });
  if (doneErr) return sqlError(doneErr.message);
  return json(200, { status: "verified" });
});
