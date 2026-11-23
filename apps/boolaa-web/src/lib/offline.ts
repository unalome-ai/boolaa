/**
 * Offline and poor-network building blocks (docs/boolaa-spec.md, "Offline and poor network").
 * The pure parts (status machine, backoff, cache envelope) are shared in behaviour with iOS and
 * Android and unit-tested in tests/offline-logic.spec.ts.
 */

// ---------------------------------------------------------------------------------------------
// Connectivity status machine
// ---------------------------------------------------------------------------------------------

/** online; offline = the browser has no network; unreachable = network, but Supabase didn't answer. */
export type NetStatus = "online" | "offline" | "unreachable";

export type NetEvent =
  | { type: "path"; available: boolean }
  | { type: "success" }
  | { type: "failure"; network: boolean };

/**
 * Next status after an event, and whether this transition is a reconnect (screens refetch and
 * live channels resubscribe). Non-network failures (RLS, HTTP errors with a body) change nothing.
 */
export function nextStatus(status: NetStatus, event: NetEvent): { status: NetStatus; reconnected: boolean } {
  switch (event.type) {
    case "path":
      if (!event.available) return { status: "offline", reconnected: false };
      // The OS says the network is back: optimistic, a failing request moves it to unreachable.
      return status === "offline" ? { status: "online", reconnected: true } : { status, reconnected: false };
    case "success":
      return status === "unreachable" ? { status: "online", reconnected: true } : { status, reconnected: false };
    case "failure":
      if (!event.network) return { status, reconnected: false };
      return status === "online" ? { status: "unreachable", reconnected: false } : { status, reconnected: false };
  }
}

// ---------------------------------------------------------------------------------------------
// Backoff
// ---------------------------------------------------------------------------------------------

export const BACKOFF_CAP_S = 30;
/** Automatic retries of a failed screen load (Try again always works, and so does a reconnect). */
export const MAX_AUTO_RETRIES = 5;
/** Loading indicators appear only after this long, so fast loads don't flash. */
export const LOADER_DELAY_MS = 300;
/** REST, RPC and auth requests give up after this long (a timeout counts as a network error). */
export const REQUEST_TIMEOUT_MS = 15_000;
/** Storage uploads and downloads. */
export const STORAGE_TIMEOUT_MS = 60_000;
/** How long "Back online" stays. */
export const BACK_ONLINE_MS = 2_500;
/** A tab hidden at least this long refetches when it becomes visible again. */
export const FOREGROUND_REFRESH_MS = 30_000;

/**
 * Delay in ms before retry number `attempt` (0-based): 1, 2, 4, 8, 16, 30, 30 … seconds, times a
 * jitter factor in [0.8, 1.2] from `random` (0..1; 0.5 gives the exact sequence).
 */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(BACKOFF_CAP_S, 2 ** Math.max(0, Math.min(attempt, 10)));
  const factor = 0.8 + 0.4 * Math.min(1, Math.max(0, random()));
  return Math.round(base * factor * 1000);
}

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

type ErrorLike = { name?: unknown; message?: unknown; code?: unknown; status?: unknown; statusCode?: unknown };

/** A failed fetch (no network, DNS, CORS-level failure, our timeout), as opposed to an answer. */
export function isNetworkError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as ErrorLike;
  const name = String(err.name ?? "");
  const msg = String(err.message ?? "").toLowerCase();
  return (
    name === "AuthRetryableFetchError" ||
    name === "TimeoutError" ||
    msg.includes("failed to fetch") ||
    msg.includes("fetch failed") ||
    msg.includes("networkerror") ||
    msg.includes("load failed") ||
    msg.includes("timed out")
  );
}

/** Postgres unique_violation: a retried insert whose first attempt reached the server. */
export function isUniqueViolation(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as ErrorLike).code === "23505";
}

/** Storage refuses to overwrite: the object was uploaded by an earlier attempt. */
export function isAlreadyUploaded(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as ErrorLike;
  const msg = String(err.message ?? "").toLowerCase();
  return String(err.statusCode ?? err.status ?? "") === "409" || msg.includes("already exists") || msg.includes("duplicate");
}

// ---------------------------------------------------------------------------------------------
// Cache envelope and storage (sessionStorage: per tab, gone when the tab closes)
// ---------------------------------------------------------------------------------------------

export const CACHE_VERSION = 1;
export const CACHE_MAX_AGE_MS = 30 * 24 * 3600 * 1000;
export const CACHE_PREFIX = "boolaa:offline:v1:";
export const OUTBOX_PREFIX = "boolaa:outbox:v1:";
/** The chat cache holds the newest page only. */
export const CHAT_CACHE_LIMIT = 50;

export type Envelope<T> = { v: number; savedAt: string; data: T };

export function encodeEnvelope<T>(data: T, now = new Date()): string {
  return JSON.stringify({ v: CACHE_VERSION, savedAt: now.toISOString(), data } satisfies Envelope<T>);
}

/** The payload, or null when missing, unreadable, from another version or older than 30 days. */
export function decodeEnvelope<T>(raw: string | null | undefined, now = new Date()): T | null {
  if (!raw) return null;
  try {
    const env = JSON.parse(raw) as Partial<Envelope<T>>;
    if (env?.v !== CACHE_VERSION || typeof env.savedAt !== "string" || env.data === undefined) return null;
    const age = now.getTime() - Date.parse(env.savedAt);
    if (!Number.isFinite(age) || age > CACHE_MAX_AGE_MS) return null;
    return env.data as T;
  } catch {
    return null;
  }
}

/** Minimal Storage surface, so tests can pass a Map-backed fake. */
export type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

function sessionStore(): KeyValueStore | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null; // storage disabled
  }
}

let cacheUser: string | null = null;

/**
 * Sets whose cache is read and written, and deletes every other user's cache and outbox, so
 * nothing of user A is ever shown to user B in this tab (also covers a session that ended
 * without a sign-out).
 */
export function setOfflineUser(userId: string, store: KeyValueStore | null = sessionStore()) {
  cacheUser = userId;
  if (!store) return;
  for (const key of allKeys(store)) {
    const owned = key.startsWith(`${CACHE_PREFIX}${userId}:`) || key === `${OUTBOX_PREFIX}${userId}`;
    if ((key.startsWith(CACHE_PREFIX) || key.startsWith(OUTBOX_PREFIX)) && !owned) store.removeItem(key);
  }
}

/** Sign-out and account deletion: forget every cached view and queued message of every user. */
export function clearOfflineData(store: KeyValueStore | null = sessionStore()) {
  cacheUser = null;
  if (!store) return;
  for (const key of allKeys(store)) if (key.startsWith(CACHE_PREFIX) || key.startsWith(OUTBOX_PREFIX)) store.removeItem(key);
}

function allKeys(store: KeyValueStore) {
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (k) keys.push(k);
  }
  return keys;
}

export function cacheKey(userId: string, key: string) {
  return `${CACHE_PREFIX}${userId}:${key}`;
}

/** The last view saved under `key` for the current user (e.g. `events.<bubble id>`), or null. */
export function readCache<T>(key: string, store: KeyValueStore | null = sessionStore()): T | null {
  if (!cacheUser || !store) return null;
  const full = cacheKey(cacheUser, key);
  const data = decodeEnvelope<T>(store.getItem(full));
  if (data === null && store.getItem(full) !== null) store.removeItem(full);
  return data;
}

export function writeCache<T>(key: string, data: T, store: KeyValueStore | null = sessionStore()) {
  if (!cacheUser || !store) return;
  try {
    store.setItem(cacheKey(cacheUser, key), encodeEnvelope(data));
  } catch {
    // Quota exceeded: the cache is best effort. Drop this key so a stale copy isn't shown.
    store.removeItem(cacheKey(cacheUser, key));
  }
}

export function currentOfflineUser() {
  return cacheUser;
}
