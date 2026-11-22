// Shared shapes of push-dispatch.

/** A rendered notification for one token. */
export interface PushMessage {
  type: string;
  bubbleId: string | null;
  targetId: string | null;
  title: string;
  body: string;
  collapseKey: string | null;
  /** iOS notification category (UNNotificationCategory identifier). */
  category: string;
  /** Android notification channel id: chat | bubble | events. */
  channelId: string;
  /** Web: path to open on click (the web app switches to `bubble` first). */
  url: string;
  /** Unix seconds after which the provider may drop an undelivered message. */
  expiresAt: number;
}

/** What one provider call means for the token and the outbox row. */
export type Outcome =
  | { kind: "ok" }
  | { kind: "invalid"; reason: string } // token is gone: delete it
  | { kind: "retry"; reason: string; retryAfter?: number } // transient: try again later
  | { kind: "failed"; reason: string }; // permanent for this message, keep the token

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

/** Deep-link data every platform receives: open the right screen. */
export function deepLink(m: PushMessage) {
  return { type: m.type, bubble_id: m.bubbleId ?? "", target_id: m.targetId ?? "" };
}

export function retryAfterSeconds(h: Headers): number | undefined {
  const v = h.get("retry-after");
  if (!v) return undefined;
  const n = Number(v);
  if (Number.isFinite(n)) return Math.max(0, Math.round(n));
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, Math.round((t - Date.now()) / 1000)) : undefined;
}
