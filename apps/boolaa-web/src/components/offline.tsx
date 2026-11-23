"use client";

/**
 * Offline UI (docs/boolaa-spec.md, "Offline and poor network"): the status pill under the header,
 * the inline load error with Try again, the compact "couldn't refresh" notice, and the hooks that
 * give every screen its cached last view, retries with backoff and a refetch on reconnect.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CloudOff, RotateCw, Wifi, WifiOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useConnectivity } from "@/lib/connectivity";
import { MAX_AUTO_RETRIES, backoffDelay, readCache, writeCache } from "@/lib/offline";
import { cx } from "@/lib/utils";
import { Mascot } from "@/components/orb";

/** Offline / unreachable pill, and "Back online" for a moment after a reconnect. */
export function ConnectivityBanner() {
  const t = useTranslations("offline");
  const { status, backOnline } = useConnectivity();
  const text = status === "offline" ? t("banner") : status === "unreachable" ? t("unreachable") : backOnline ? t("backOnline") : null;
  const Icon = status === "offline" ? WifiOff : status === "unreachable" ? CloudOff : Wifi;
  return (
    // The live region stays mounted so screen readers announce each change politely.
    <div role="status" aria-live="polite" className="flex justify-center" data-testid="connectivity" data-status={status}>
      {text && (
        <p
          key={status}
          data-testid={status === "online" ? "back-online" : "offline-banner"}
          className={cx(
            "anim-pop-soft mb-3 inline-flex max-w-full items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold shadow-soft",
            status === "online" ? "hue-mint bg-hue-wash text-hue-ink" : "bg-card text-fg",
          )}
        >
          <Icon size={16} strokeWidth={2.4} aria-hidden className="shrink-0" />
          <span>{text}</span>
        </p>
      )}
    </div>
  );
}

/**
 * Runs a screen's `load` (it returns whether it succeeded) on mount and whenever it changes, again
 * after a reconnect or a long time in the background, and automatically with backoff (1, 2, 4 …
 * 30 s, at most 5 times) while it keeps failing and the network is up. `retry` is for Try again.
 */
export function useResilientLoad(load: () => Promise<boolean>) {
  const { status, generation } = useConnectivity();
  const [failures, setFailures] = useState(0);
  const run = useCallback(async () => {
    let ok = false;
    try {
      ok = await load();
    } catch {
      ok = false;
    }
    setFailures((n) => (ok ? 0 : n + 1));
    return ok;
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async load, state is set after it
    void run();
  }, [run]);

  const seen = useRef(generation);
  useEffect(() => {
    if (seen.current === generation) return;
    seen.current = generation;
    void run();
  }, [generation, run]);

  useEffect(() => {
    if (failures === 0 || failures > MAX_AUTO_RETRIES || status !== "online") return;
    const id = window.setTimeout(() => void run(), backoffDelay(failures - 1));
    return () => window.clearTimeout(id);
  }, [failures, status, run]);

  const retry = useCallback(() => {
    setFailures(0);
    void run();
  }, [run]);

  return { failed: failures > 0, retry };
}

/**
 * State seeded from the cached last view under `key` (per user, sessionStorage) and saved back
 * whenever it changes (loads and live merges, debounced). `save` can trim what is kept.
 */
export function useCachedState<T>(key: string, save: (value: T) => T = (v) => v) {
  const [value, setValue] = useState<T | null>(() => readCache<T>(key));
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    if (value === null) return;
    const id = window.setTimeout(() => writeCache(key, saveRef.current(value)), 400);
    return () => window.clearTimeout(id);
  }, [key, value]);
  return [value, setValue] as const;
}

/** Nothing to show and the load failed: say so, with Try again (never an empty screen). */
export function LoadError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("offline");
  // Mascot (design-system 8.4): sleepy while there's no connection, worried when the load itself failed.
  const { status } = useConnectivity();
  return (
    <div className="anim-pop-soft card flex flex-col items-center gap-3 px-6 py-8 text-center" data-testid="load-error" role="alert">
      <Mascot hue="grape" expression={status === "online" ? "worried" : "sleepy"} size={72} />
      <p className="text-[15px] font-medium">{t("loadFailed")}</p>
      <button type="button" className="btn-primary min-h-11 px-4" onClick={onRetry} data-testid="load-retry">
        <RotateCw size={16} strokeWidth={2.6} aria-hidden /> {t("retry")}
      </button>
    </div>
  );
}

/**
 * The last view is on screen but refreshing it failed. Hidden while the offline/unreachable pill
 * already says so.
 */
export function StaleNotice({ show, onRetry }: { show: boolean; onRetry: () => void }) {
  const t = useTranslations("offline");
  const { status } = useConnectivity();
  if (!show || status !== "online") return null;
  return (
    <div className="mb-3 flex items-center justify-between gap-3 rounded-field bg-field px-4 py-2 text-sm" data-testid="stale-notice">
      <span className="text-muted">{t("staleNotice")}</span>
      <button type="button" className="btn-ghost min-h-9 shrink-0 px-3 text-sm" onClick={onRetry}>
        <RotateCw size={14} strokeWidth={2.6} aria-hidden /> {t("retry")}
      </button>
    </div>
  );
}

/** Loader, inline error or content, depending on what a screen has and whether its load failed. */
export function LoadGate<T>({
  data,
  failed,
  onRetry,
  loader,
  children,
}: {
  data: T | null;
  failed: boolean;
  onRetry: () => void;
  loader: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (data === null) return failed ? <LoadError onRetry={onRetry} /> : <>{loader}</>;
  return (
    <>
      <StaleNotice show={failed} onRetry={onRetry} />
      {children(data)}
    </>
  );
}
