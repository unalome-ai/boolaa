// APNs over HTTP/2 with token-based auth (ES256 JWT signed with the .p8 key).
// Deno's fetch negotiates h2 through ALPN, which APNs requires (measured on the Supabase
// edge-runtime image v1.70: see docs/push-notifications.md, "APNs and HTTP/2").
import { importEs256Pkcs8, signJwt } from "./jwt.ts";
import { deepLink, type FetchFn, type Outcome, type PushMessage, retryAfterSeconds } from "./types.ts";

export interface ApnsConfig {
  keyId: string; // APNS_KEY_ID
  teamId: string; // APNS_TEAM_ID
  keyP8: string; // APNS_KEY_P8: the .p8 file contents (PEM)
  topic: string; // bundle id, ro.boolaa.app
}

export const APNS_HOSTS = {
  sandbox: "https://api.sandbox.push.apple.com",
  production: "https://api.push.apple.com",
} as const;

// Apple: refresh the provider token at most once every 20 minutes, and before it is 1 hour old.
const JWT_TTL_MS = 50 * 60 * 1000;
let cached: { jwt: string; at: number; keyId: string } | null = null;

export async function apnsJwt(cfg: ApnsConfig, now = Date.now()): Promise<string> {
  if (cached && cached.keyId === cfg.keyId && now - cached.at < JWT_TTL_MS) return cached.jwt;
  const key = await importEs256Pkcs8(cfg.keyP8);
  const jwt = await signJwt({ alg: "ES256", kid: cfg.keyId }, { iss: cfg.teamId, iat: Math.floor(now / 1000) }, key);
  cached = { jwt, at: now, keyId: cfg.keyId };
  return jwt;
}

export function resetApnsJwt() {
  cached = null;
}

export function apnsRequest(
  token: string,
  env: "sandbox" | "production",
  m: PushMessage,
  jwt: string,
  topic: string,
): { url: string; init: RequestInit } {
  const aps: Record<string, unknown> = {
    alert: { title: m.title, body: m.body },
    sound: "default",
    category: m.category,
  };
  if (m.bubbleId) aps["thread-id"] = m.bubbleId; // groups a bubble's notifications
  const headers: Record<string, string> = {
    authorization: `bearer ${jwt}`,
    "apns-topic": topic,
    "apns-push-type": "alert",
    "apns-priority": "10",
    "apns-expiration": String(m.expiresAt),
    "content-type": "application/json",
  };
  if (m.collapseKey) headers["apns-collapse-id"] = m.collapseKey.slice(0, 64);
  return {
    url: `${APNS_HOSTS[env]}/3/device/${token}`,
    init: { method: "POST", headers, body: JSON.stringify({ aps, ...deepLink(m) }) },
  };
}

// https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns
export function classifyApns(status: number, reason: string | undefined, headers?: Headers): Outcome {
  if (status === 200) return { kind: "ok" };
  const r = reason ?? `http_${status}`;
  if (status === 410) return { kind: "invalid", reason: r }; // Unregistered / ExpiredToken
  if (status === 400 && (r === "BadDeviceToken" || r === "DeviceTokenNotForTopic")) {
    // Also what a sandbox token sent to production (or the reverse) gets: the client
    // re-registers with the right apns_env on its next start.
    return { kind: "invalid", reason: r };
  }
  if (status === 403 && (r === "ExpiredProviderToken" || r === "InvalidProviderToken")) {
    resetApnsJwt();
    return { kind: "retry", reason: r };
  }
  if (status === 429 || status >= 500) {
    return { kind: "retry", reason: r, retryAfter: headers ? retryAfterSeconds(headers) : undefined };
  }
  return { kind: "failed", reason: r }; // PayloadTooLarge, BadTopic, TopicDisallowed, ...
}

export async function sendApns(
  token: string,
  env: "sandbox" | "production",
  m: PushMessage,
  cfg: ApnsConfig | null,
  fetchFn: FetchFn,
): Promise<Outcome> {
  const jwt = cfg ? await apnsJwt(cfg) : "dry-run";
  const { url, init } = apnsRequest(token, env, m, jwt, cfg?.topic ?? "ro.boolaa.app");
  const res = await fetchFn(url, init);
  let reason: string | undefined;
  if (res.status !== 200) {
    reason = (await res.json().catch(() => ({})))?.reason;
  } else {
    await res.body?.cancel();
  }
  return classifyApns(res.status, reason, res.headers);
}
