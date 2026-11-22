// Sends one claimed outbox row to every token of its recipient and folds the per-token
// outcomes into one result for complete_push_batch.
import { type ApnsConfig, sendApns } from "./apns.ts";
import { type ServiceAccount, sendFcm } from "./fcm.ts";
import { buildMessage, type ClaimedItem, type TokenRow } from "./render.ts";
import type { FetchFn, Outcome, PushMessage } from "./types.ts";
import { sendWebPush, type VapidKeys } from "./webpush.ts";

export interface Providers {
  apns: ApnsConfig | null;
  fcm: ServiceAccount | null;
  vapid: VapidKeys | null;
  /** Real fetch, or the dry-run recorder (fetch per token so it can log title/body). */
  fetchFor: (item: ClaimedItem, token: TokenRow, m: PushMessage) => FetchFn;
}

export interface ItemResult {
  id: number;
  status: "sent" | "retry" | "failed";
  error?: string;
  retry_token_ids?: string[];
  retry_after_seconds?: number;
}

export async function sendToToken(item: ClaimedItem, token: TokenRow, p: Providers): Promise<Outcome> {
  const m = buildMessage(item, token);
  const f = p.fetchFor(item, token, m);
  try {
    switch (token.platform) {
      case "ios":
        return await sendApns(token.token, token.apns_env ?? "production", m, p.apns, f);
      case "android":
        return await sendFcm(token.token, m, p.fcm, f);
      case "web":
        return await sendWebPush({ endpoint: token.endpoint ?? token.token, p256dh: token.p256dh ?? "", auth: token.auth ?? "" }, m, p.vapid, f);
    }
  } catch (e) {
    // Network errors, TLS, timeouts: transient.
    return { kind: "retry", reason: `network: ${(e as Error).message}`.slice(0, 200) };
  }
}

export async function sendItem(item: ClaimedItem, p: Providers): Promise<{ result: ItemResult; invalid: string[] }> {
  const outcomes = await Promise.all(item.tokens.map(async (t) => [t, await sendToToken(item, t, p)] as const));
  const invalid = outcomes.filter(([, o]) => o.kind === "invalid").map(([t]) => t.id);
  const retry = outcomes.filter(([, o]) => o.kind === "retry");
  const ok = outcomes.some(([, o]) => o.kind === "ok");
  const errors = outcomes.filter(([, o]) => o.kind !== "ok")
    .map(([t, o]) => `${t.platform}:${(o as { reason: string }).reason}`);
  const error = errors.length ? errors.join("; ").slice(0, 500) : undefined;

  if (retry.length) {
    const after = Math.max(0, ...retry.map(([, o]) => (o.kind === "retry" ? o.retryAfter ?? 0 : 0)));
    return {
      result: { id: item.id, status: "retry", error, retry_token_ids: retry.map(([t]) => t.id), retry_after_seconds: after || undefined },
      invalid,
    };
  }
  return { result: { id: item.id, status: ok ? "sent" : "failed", error }, invalid };
}

/** Runs `fn` over `items` with at most `limit` in flight. */
export async function pool<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

/** PUSH_DRY_RUN: tokens containing "invalid" (or iOS hex tokens starting with "dead") answer
 * like an unregistered device, "transient" (or "beef") like a provider outage. */
export function simulatedResponse(provider: "apns" | "fcm" | "web", token: string): { status: number; body: unknown; label: string } {
  const t = token.toLowerCase();
  const sim = /invalid/.test(t) || (provider === "apns" && t.startsWith("dead"))
    ? "invalid"
    : /transient/.test(t) || (provider === "apns" && t.startsWith("beef"))
    ? "transient"
    : "ok";
  if (sim === "ok") return { status: provider === "web" ? 201 : 200, body: provider === "fcm" ? { name: "projects/dry-run/messages/1" } : null, label: "ok" };
  if (sim === "invalid") {
    if (provider === "apns") return { status: 410, body: { reason: "Unregistered" }, label: sim };
    if (provider === "fcm") {
      return {
        status: 404,
        body: { error: { code: 404, status: "NOT_FOUND", details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" }] } },
        label: sim,
      };
    }
    return { status: 410, body: null, label: sim };
  }
  if (provider === "apns") return { status: 503, body: { reason: "ServiceUnavailable" }, label: sim };
  if (provider === "fcm") return { status: 503, body: { error: { code: 503, status: "UNAVAILABLE" } }, label: sim };
  return { status: 503, body: null, label: sim };
}
