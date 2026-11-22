"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Bell, BellOff, Check, X } from "lucide-react";
import { useBoolaa, useBubble } from "@/components/boolaa-provider";
import { ErrorText } from "@/components/ui";
import { useErrorText } from "@/i18n/errors";
import { useFormat } from "@/i18n/format";
import {
  DEFAULT_PREFS,
  PREF_KEYS,
  disablePush,
  enablePush,
  isSubscribed,
  muteActive,
  muteUntil,
  permissionState,
  type NotificationPrefs,
  type PrefKey,
  type PushState,
} from "@/lib/push";
import { cx } from "@/lib/utils";

type Prefs = Omit<NotificationPrefs, "user_id" | "updated_at">;

const LABEL = {
  chat: "chat",
  join_requests: "joinRequests",
  approvals: "approvals",
  new_events: "newEvents",
  event_reminders: "eventReminders",
  food: "food",
  market: "market",
} as const satisfies Record<PrefKey, string>;

function Toggle({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className={cx("flex items-center gap-3 px-4 py-3", disabled && "opacity-50")}>
      <div className="min-w-0 flex-1">
        <span id={`${id}-label`} className="font-medium">
          {label}
        </span>
        {hint && <p className="text-sm text-muted">{hint}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        data-testid={`pref-${id}`}
        className={cx(
          "relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed",
          checked ? "bg-brand" : "bg-field ring-1 ring-line",
        )}
      >
        <span
          aria-hidden
          className={cx(
            "absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-soft transition-[left] motion-reduce:transition-none",
            checked ? "left-[22px]" : "left-0.5",
          )}
        />
      </button>
    </div>
  );
}

/** This browser's push subscription: turn on (click only), on/off state, blocked and unsupported notes. */
export function PushPermission({ compact = false, onDone }: { compact?: boolean; onDone?: () => void }) {
  const { supabase } = useBoolaa();
  const t = useTranslations("notifications");
  const locale = useLocale();
  const errorText = useErrorText();
  const [state, setState] = useState<PushState | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const s = permissionState();
    isSubscribed().then((sub) => {
      if (!alive) return;
      setState(s);
      setSubscribed(s === "granted" && sub);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      const s = await enablePush(supabase, locale);
      setState(s);
      setSubscribed(s === "granted");
      if (s === "granted") onDone?.();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    await disablePush(supabase);
    setSubscribed(false);
    setBusy(false);
  }

  if (state === null) return null;
  if (state === "unsupported")
    return compact ? null : (
      <p className="px-4 py-3 text-sm text-muted" data-testid="push-unsupported">
        {t("unsupported")}
      </p>
    );
  if (state === "denied")
    return (
      <div className="hue-sunny m-3 rounded-field bg-hue-wash px-4 py-3 text-hue-ink" role="status" data-testid="push-blocked">
        <p className="flex items-center gap-2 font-semibold">
          <BellOff size={17} aria-hidden /> {t("blocked")}
        </p>
        <p className="mt-1 text-sm">{t("blockedHint")}</p>
      </div>
    );
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="push-permission" data-subscribed={subscribed}>
      {subscribed ? (
        <>
          <span className="hue-mint inline-flex flex-1 items-center gap-2 font-semibold text-hue-ink" data-testid="push-on">
            <Check size={17} strokeWidth={3} aria-hidden /> {t("on")}
          </span>
          <button type="button" className="chip bg-field text-muted hover:text-fg" disabled={busy} onClick={disable} data-testid="push-disable">
            <BellOff size={15} aria-hidden /> {t("turnOff")}
          </button>
        </>
      ) : (
        <>
          <p className="min-w-0 flex-1 text-sm text-muted">{t("askHint")}</p>
          <button type="button" className="btn-primary h-11 px-4 text-sm" disabled={busy} onClick={enable} data-testid="push-enable">
            <Bell size={16} aria-hidden /> {t("ask")}
          </button>
        </>
      )}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

/** Settings → Notifications (account level, docs/push-notifications.md §9): `notification_prefs`. */
export function NotificationSettings() {
  const { supabase, userId } = useBoolaa();
  const t = useTranslations("notifications");
  const errorText = useErrorText();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("notification_prefs")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) setError(errorText(error));
        setPrefs(Object.fromEntries(Object.keys(DEFAULT_PREFS).map((k) => [k, (data ?? DEFAULT_PREFS)[k as keyof Prefs]])) as Prefs);
      });
  }, [supabase, userId, errorText]);

  const set = useCallback(
    async (patch: Partial<Prefs>) => {
      if (!prefs) return;
      const before = prefs;
      const next = { ...prefs, ...patch };
      setPrefs(next);
      setError(null);
      const { error } = await supabase.from("notification_prefs").upsert({ user_id: userId, ...next }, { onConflict: "user_id" });
      if (error) {
        setPrefs(before);
        setError(errorText(error));
      }
    },
    [prefs, supabase, userId, errorText],
  );

  return (
    <div className="space-y-3" data-testid="notification-settings" data-loaded={prefs !== null}>
      <div className="card divide-y divide-line">
        <PushPermission />
        {prefs && (
          <>
            <Toggle id="enabled" label={t("enabled")} checked={prefs.enabled} onChange={(v) => set({ enabled: v })} />
            {PREF_KEYS.map((k) => (
              <Toggle key={k} id={k} label={t(LABEL[k])} checked={prefs[k]} disabled={!prefs.enabled} onChange={(v) => set({ [k]: v })} />
            ))}
            <Toggle
              id="preview_content"
              label={t("preview")}
              hint={t("previewHint")}
              checked={prefs.preview_content}
              disabled={!prefs.enabled}
              onChange={(v) => set({ preview_content: v })}
            />
          </>
        )}
      </div>
      <p className="px-1 text-xs text-muted">{t("allBubbles")}</p>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

type MuteOption = "1h" | "8h" | "1w" | "forever";
const MUTE_OPTIONS: MuteOption[] = ["1h", "8h", "1w", "forever"];

/** Bubble Settings → Mute this bubble (`bubble_mutes`; until null = until unmuted). */
export function BubbleMute() {
  const { supabase, userId } = useBoolaa();
  const bubble = useBubble();
  const t = useTranslations("mute");
  const fmt = useFormat();
  const errorText = useErrorText();
  const [row, setRow] = useState<{ until: string | null } | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    supabase
      .from("bubble_mutes")
      .select("until")
      .eq("user_id", userId)
      .eq("bubble_id", bubble.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) setError(errorText(error));
        setRow(data ?? null);
      });
    return () => {
      alive = false;
    };
  }, [supabase, userId, bubble.id, errorText]);

  async function mute(option: MuteOption) {
    setBusy(true);
    setError(null);
    const until = muteUntil(option);
    const { error } = await supabase.from("bubble_mutes").upsert({ user_id: userId, bubble_id: bubble.id, until }, { onConflict: "user_id,bubble_id" });
    setBusy(false);
    if (error) return setError(errorText(error));
    setRow({ until });
  }

  async function unmute() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("bubble_mutes").delete().eq("user_id", userId).eq("bubble_id", bubble.id);
    setBusy(false);
    if (error) return setError(errorText(error));
    setRow(null);
  }

  if (row === undefined) return null;
  const active = muteActive(row, fmt.now.getTime());
  const date = row?.until ? fmt.dateTime(row.until) : "";

  return (
    <div className="card space-y-3 p-4" data-testid="bubble-mute" data-muted={active}>
      <div>
        <h3 className="flex items-center gap-2 font-semibold">
          <BellOff size={17} aria-hidden /> {t("title")}
        </h3>
        <p className="text-sm text-muted">{t("hint")}</p>
      </div>
      {active ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex-1 font-medium" data-testid="mute-status">
            {row?.until ? t("until", { date }) : t("mutedForever")}
          </span>
          <button type="button" className="chip bg-brand/15 text-brand-ink hover:bg-brand/20" disabled={busy} onClick={unmute} data-testid="unmute">
            <Bell size={15} aria-hidden /> {t("unmute")}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("title")}>
          {MUTE_OPTIONS.map((o) => (
            <button key={o} type="button" className="chip bg-field text-muted hover:text-fg" disabled={busy} onClick={() => mute(o)} data-testid={`mute-${o}`}>
              {t(o)}
            </button>
          ))}
        </div>
      )}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

const CARD_DISMISSED_KEY = "boolaa_push_card_dismissed";

/**
 * Dismissible "Turn on notifications" card on Home (docs/push-notifications.md §8: ask after a
 * user action, never on load). Only while the browser hasn't been asked yet.
 */
export function PushCard() {
  const t = useTranslations();
  const [show, setShow] = useState(false);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(CARD_DISMISSED_KEY) === "1";
    } catch {
      /* storage blocked */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!dismissed && permissionState() === "default") setShow(true);
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(CARD_DISMISSED_KEY, "1");
    } catch {
      /* storage blocked */
    }
    setShow(false);
  };

  if (!show) return null;
  return (
    <section className="card anim-pop-soft relative mb-5 pr-10" data-testid="push-card" aria-label={t("notifications.title")}>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("common.close")}
        className="press-round absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-field hover:text-fg"
        data-testid="push-card-dismiss"
      >
        <X size={18} aria-hidden />
      </button>
      <PushPermission compact onDone={dismiss} />
    </section>
  );
}
