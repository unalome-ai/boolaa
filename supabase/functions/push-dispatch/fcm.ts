// Firebase Cloud Messaging HTTP v1. OAuth2 access token from a service-account JSON
// (RS256 JWT bearer grant), cached until 5 minutes before it expires.
import { importRs256Pkcs8, signJwt } from "./jwt.ts";
import { deepLink, type FetchFn, type Outcome, type PushMessage, retryAfterSeconds } from "./types.ts";

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";

export function parseServiceAccount(json: string): ServiceAccount {
  const sa = JSON.parse(json);
  if (!sa?.project_id || !sa?.client_email || !sa?.private_key) {
    throw new Error("FCM_SERVICE_ACCOUNT_JSON needs project_id, client_email and private_key");
  }
  return sa;
}

let cached: { token: string; expiresAt: number; email: string } | null = null;

export function resetFcmToken() {
  cached = null;
}

export async function fcmAccessToken(sa: ServiceAccount, fetchFn: FetchFn, now = Date.now()): Promise<string> {
  if (cached && cached.email === sa.client_email && now < cached.expiresAt - 5 * 60 * 1000) return cached.token;
  const iat = Math.floor(now / 1000);
  const tokenUri = sa.token_uri || DEFAULT_TOKEN_URI;
  const assertion = await signJwt(
    { alg: "RS256", typ: "JWT" },
    { iss: sa.client_email, scope: FCM_SCOPE, aud: tokenUri, iat, exp: iat + 3600 },
    await importRs256Pkcs8(sa.private_key),
  );
  const res = await fetchFn(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || typeof body.access_token !== "string") {
    throw new Error(`fcm oauth ${res.status}: ${body.error ?? "no access_token"}`);
  }
  cached = { token: body.access_token, expiresAt: now + (Number(body.expires_in) || 3600) * 1000, email: sa.client_email };
  return cached.token;
}

export function fcmRequest(
  projectId: string,
  token: string,
  m: PushMessage,
  accessToken: string,
  now = Date.now(),
): { url: string; init: RequestInit } {
  const ttl = Math.max(0, m.expiresAt - Math.floor(now / 1000));
  const android: Record<string, unknown> = {
    priority: "HIGH",
    ttl: `${ttl}s`,
    notification: { channel_id: m.channelId, ...(m.collapseKey ? { tag: m.collapseKey } : {}) },
  };
  // collapse_key: an undelivered older message is replaced; notification.tag replaces the shown one.
  if (m.collapseKey) android.collapse_key = m.collapseKey;
  const message = {
    token,
    notification: { title: m.title, body: m.body },
    data: { ...deepLink(m), collapse_key: m.collapseKey ?? "" }, // FCM data values must be strings
    android,
  };
  return {
    url: `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
    init: {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ message }),
    },
  };
}

// https://firebase.google.com/docs/reference/fcm/rest/v1/ErrorCode
// deno-lint-ignore no-explicit-any
export function classifyFcm(status: number, body: any, headers?: Headers): Outcome {
  if (status === 200) return { kind: "ok" };
  const err = body?.error ?? {};
  // deno-lint-ignore no-explicit-any
  const code: string | undefined = (err.details ?? []).find((d: any) => d?.errorCode)?.errorCode;
  const reason = code ?? err.status ?? `http_${status}`;
  if (code === "UNREGISTERED" || status === 404) return { kind: "invalid", reason };
  if (code === "SENDER_ID_MISMATCH") return { kind: "invalid", reason }; // token of another Firebase project
  if (status === 400 && /registration token/i.test(err.message ?? "")) return { kind: "invalid", reason };
  if (status === 401 || code === "THIRD_PARTY_AUTH_ERROR") {
    resetFcmToken();
    return { kind: "retry", reason };
  }
  if (status === 429 || status >= 500 || code === "QUOTA_EXCEEDED" || code === "UNAVAILABLE" || code === "INTERNAL") {
    return { kind: "retry", reason, retryAfter: headers ? retryAfterSeconds(headers) : undefined };
  }
  return { kind: "failed", reason };
}

export async function sendFcm(token: string, m: PushMessage, sa: ServiceAccount | null, fetchFn: FetchFn): Promise<Outcome> {
  let access = "dry-run";
  if (sa) {
    try {
      access = await fcmAccessToken(sa, fetchFn);
    } catch (e) {
      return { kind: "retry", reason: (e as Error).message.slice(0, 200) };
    }
  }
  const { url, init } = fcmRequest(sa?.project_id ?? "dry-run", token, m, access);
  const res = await fetchFn(url, init);
  const body = res.status === 200 ? (await res.body?.cancel(), null) : await res.json().catch(() => ({}));
  return classifyFcm(res.status, body, res.headers);
}
