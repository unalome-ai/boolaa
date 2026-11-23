/**
 * Browser connectivity (docs/boolaa-spec.md, "Offline and poor network"): navigator.onLine and the
 * online/offline events say whether there is a network; every Supabase request reports whether
 * the server answered (timedFetch below), which tells "no network" from "server unreachable".
 * While unreachable, a probe (`/auth/v1/health`) runs with backoff. A reconnect, or the tab coming
 * back after a while, bumps `generation`: screens refetch and live channels resubscribe.
 */
import { useSyncExternalStore } from "react";
import {
  BACK_ONLINE_MS,
  FOREGROUND_REFRESH_MS,
  REQUEST_TIMEOUT_MS,
  STORAGE_TIMEOUT_MS,
  backoffDelay,
  nextStatus,
  type NetEvent,
  type NetStatus,
} from "@/lib/offline";

export type Connectivity = { status: NetStatus; backOnline: boolean; generation: number };

const SERVER: Connectivity = { status: "online", backOnline: false, generation: 0 };
let snapshot: Connectivity = SERVER;
const listeners = new Set<() => void>();
let started = false;
let backOnlineTimer: number | undefined;
let probeTimer: number | undefined;
let probeAttempt = 0;
let hiddenAt: number | null = null;

function set(next: Partial<Connectivity>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((l) => l());
}

/** Feeds the status machine. Exported for the fetch wrapper and tests. */
export function reportNet(event: NetEvent) {
  const prev = snapshot.status;
  const { status, reconnected } = nextStatus(prev, event);
  if (status === prev && !reconnected) return;
  window.clearTimeout(backOnlineTimer);
  set({
    status,
    backOnline: reconnected,
    generation: reconnected ? snapshot.generation + 1 : snapshot.generation,
  });
  if (reconnected) backOnlineTimer = window.setTimeout(() => set({ backOnline: false }), BACK_ONLINE_MS);
  if (status === "unreachable") scheduleProbe(true);
  else stopProbe();
}

function stopProbe() {
  window.clearTimeout(probeTimer);
  probeTimer = undefined;
  probeAttempt = 0;
}

function scheduleProbe(reset = false) {
  if (reset) stopProbe();
  if (probeTimer !== undefined && !reset) return;
  probeTimer = window.setTimeout(async () => {
    probeTimer = undefined;
    if (snapshot.status !== "unreachable") return;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    try {
      // Any HTTP answer means the server is reachable again.
      await fetch(`${url}/auth/v1/health`, {
        headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
      reportNet({ type: "success" });
    } catch {
      probeAttempt++;
      if (snapshot.status === "unreachable") scheduleProbe();
    }
  }, backoffDelay(probeAttempt));
}

/** Starts listening once per page; safe to call from every provider render. */
export function startConnectivity() {
  if (started || typeof window === "undefined") return;
  started = true;
  if (!navigator.onLine) set({ status: "offline" });
  window.addEventListener("online", () => reportNet({ type: "path", available: true }));
  window.addEventListener("offline", () => reportNet({ type: "path", available: false }));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      return;
    }
    const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
    hiddenAt = null;
    // Back in the foreground after a while: refresh what's on screen (sockets may have slept).
    if (away >= FOREGROUND_REFRESH_MS && snapshot.status === "online") set({ generation: snapshot.generation + 1 });
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function getConnectivity() {
  return snapshot;
}

export function useConnectivity(): Connectivity {
  return useSyncExternalStore(subscribe, getConnectivity, () => SERVER);
}

/**
 * fetch for the Supabase client: gives up after 15 s (storage: 60 s) with a network-style error
 * instead of hanging, and reports to the status machine whether the server answered. A caller's
 * own abort is passed through and reported as nothing.
 */
export async function timedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const timeoutMs = url.includes("/storage/v1/") ? STORAGE_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const outer = init?.signal;
  const onAbort = () => controller.abort();
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener("abort", onAbort, { once: true });
  }
  try {
    const res = await fetch(input, { ...init, signal: controller.signal });
    if (typeof window !== "undefined") reportNet({ type: "success" });
    return res;
  } catch (err) {
    if (outer?.aborted && !timedOut) throw err;
    if (typeof window !== "undefined") reportNet({ type: "failure", network: true });
    // Same shape as a browser network failure, so error mapping shows "Can't reach the server".
    throw timedOut ? new TypeError("Failed to fetch: the request timed out") : err;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onAbort);
  }
}
