import type { BoolaaClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/database.types";
import { getDeviceId } from "@/lib/device";

/**
 * Web Push client (docs/push-notifications.md §8, Web). The service worker is `public/sw.js`; the
 * subscription is stored with `register_push_token` (platform "web") and dropped with
 * `unregister_push_token` before sign-out. The public VAPID key must equal the push-dispatch
 * function's VAPID_PUBLIC_KEY.
 */
export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
export const SW_URL = "/sw.js";
/** Set when the user turned push off on this browser, so app start doesn't subscribe it again. */
const OPT_OUT_KEY = "boolaa_push_off";
const APP_VERSION = "web";

export type NotificationPrefs = Database["public"]["Tables"]["notification_prefs"]["Row"];
export type PrefKey = "chat" | "join_requests" | "approvals" | "new_events" | "event_reminders" | "food" | "market" | "item_requests" | "request_updates";
export const PREF_KEYS: PrefKey[] = ["chat", "join_requests", "approvals", "new_events", "event_reminders", "food", "market", "item_requests", "request_updates"];

/** Defaults when the row is missing (docs §2): everything on except food and market. */
export const DEFAULT_PREFS: Omit<NotificationPrefs, "user_id" | "updated_at"> = {
  enabled: true,
  chat: true,
  join_requests: true,
  approvals: true,
  new_events: true,
  event_reminders: true,
  food: false,
  market: false,
  item_requests: true, // 20261124100000_requests_food_expiry.sql (toggles: spec "Requests and picking")
  request_updates: true,
  preview_content: true,
};

export type PushState = "unsupported" | "default" | "denied" | "granted";

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    !!VAPID_PUBLIC_KEY &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function permissionState(): PushState {
  return pushSupported() ? (Notification.permission as PushState) : "unsupported";
}

function optedOut() {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === "1";
  } catch {
    return false;
  }
}
function setOptedOut(off: boolean) {
  try {
    if (off) localStorage.setItem(OPT_OUT_KEY, "1");
    else localStorage.removeItem(OPT_OUT_KEY);
  } catch {
    /* storage blocked */
  }
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = base64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try {
    return await navigator.serviceWorker.register(SW_URL, { scope: "/" });
  } catch {
    return null;
  }
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** True when this browser holds a push subscription (and the user didn't turn it off here). */
export async function isSubscribed(): Promise<boolean> {
  return !optedOut() && !!(await currentSubscription().catch(() => null));
}

async function saveSubscription(supabase: BoolaaClient, sub: PushSubscription, locale: string) {
  const j = sub.toJSON();
  if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) throw new Error("invalid push subscription");
  const { error } = await supabase.rpc("register_push_token", {
    p_platform: "web",
    p_endpoint: j.endpoint,
    p_p256dh: j.keys.p256dh,
    p_auth: j.keys.auth,
    p_device_id: getDeviceId(),
    p_locale: locale,
    p_app_version: APP_VERSION,
  });
  if (error) throw error;
}

async function subscription(reg: ServiceWorkerRegistration) {
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) });
}

/**
 * From a click only: asks for permission (the browser prompt), subscribes and registers the
 * subscription. Returns the resulting permission state.
 */
export async function enablePush(supabase: BoolaaClient, locale: string): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  if (permission !== "granted") return permission as PushState;
  const reg = await registerServiceWorker();
  if (!reg) throw new Error("service worker unavailable");
  await navigator.serviceWorker.ready;
  await saveSubscription(supabase, await subscription(reg), locale);
  setOptedOut(false);
  return "granted";
}

/**
 * App start / language change: browsers rotate subscriptions, so register again whenever permission
 * is already granted (never prompts). Skipped when the user turned push off on this browser.
 */
export async function syncPush(supabase: BoolaaClient, locale: string): Promise<void> {
  if (!pushSupported() || Notification.permission !== "granted" || optedOut()) return;
  const reg = await registerServiceWorker();
  if (!reg) return;
  await navigator.serviceWorker.ready;
  await saveSubscription(supabase, await subscription(reg), locale);
}

/** "Turn off on this browser": unregister on the server, then drop the browser subscription. */
export async function disablePush(supabase: BoolaaClient): Promise<void> {
  setOptedOut(true);
  await unregisterPush(supabase);
}

/**
 * Before signOut() (and after account deletion, with `server: false`): best effort, never throws.
 * The server also drops the token when the session ends.
 */
export async function unregisterPush(supabase: BoolaaClient, { server = true } = {}): Promise<void> {
  try {
    const sub = await currentSubscription();
    if (!sub) return;
    if (server) await supabase.rpc("unregister_push_token", { p_token: sub.endpoint });
    await sub.unsubscribe();
  } catch {
    /* best effort */
  }
}

/** Tells the service worker which page and bubble this tab shows (no banner for the open chat). */
export function reportView(path: string, bubbleId: string | null) {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.controller?.postMessage({ type: "boolaa:view", path, bubbleId });
}

/** Mute end for an option; null = until unmuted. */
export function muteUntil(option: "1h" | "8h" | "1w" | "forever", now = Date.now()): string | null {
  const hours = { "1h": 1, "8h": 8, "1w": 24 * 7, forever: 0 }[option];
  return hours ? new Date(now + hours * 3_600_000).toISOString() : null;
}

/** A mute row is active when `until` is null or in the future. */
export function muteActive(row: { until: string | null } | null | undefined, now = Date.now()): boolean {
  return !!row && (row.until === null || new Date(row.until).getTime() > now);
}

/**
 * Query parameter that carries the deep-link target on each route (docs/push-notifications.md §5;
 * `/links` for search hits, docs/boolaa-spec.md "Search"). The chat handles `?message=` itself.
 */
export const TARGET_PARAM: Record<string, string> = { "/events": "event", "/food": "post", "/marketplace": "item", "/links": "link" };
