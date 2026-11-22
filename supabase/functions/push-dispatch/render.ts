// Localized, privacy-safe notification text. Strings: ./locales/<locale>.json (en, ro, fr,
// es, it; terms from docs/i18n-glossary.md). User content (names, messages, bubble names)
// is never translated, only truncated. Never contains email addresses.
import en from "./locales/en.json" with { type: "json" };
import ro from "./locales/ro.json" with { type: "json" };
import fr from "./locales/fr.json" with { type: "json" };
import es from "./locales/es.json" with { type: "json" };
import it from "./locales/it.json" with { type: "json" };
import type { PushMessage } from "./types.ts";

export const LOCALES = ["en", "ro", "fr", "es", "it"] as const;
export type Locale = (typeof LOCALES)[number];
// deno-lint-ignore no-explicit-any
const STRINGS: Record<Locale, any> = { en, ro, fr, es, it };

export const NOTIFICATION_TYPES = ["chat", "join_request", "approval", "new_event", "event_reminder", "food", "market"] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** One claimed outbox row, as claim_push_batch returns it. */
export interface ClaimedItem {
  id: number;
  type: NotificationType;
  bubble_id: string | null;
  target_id: string | null;
  collapse_key: string | null;
  attempts: number;
  count: number;
  bubble_name: string | null;
  actor_name: string | null;
  preview_content: boolean;
  user_locale: string | null;
  // deno-lint-ignore no-explicit-any
  data: Record<string, any>;
  tokens: TokenRow[];
}

export interface TokenRow {
  id: string;
  platform: "ios" | "android" | "web";
  token: string;
  endpoint: string | null;
  p256dh: string | null;
  auth: string | null;
  apns_env: "sandbox" | "production" | null;
  locale: string | null;
}

export function pickLocale(...candidates: unknown[]): Locale {
  for (const c of candidates) {
    const v = typeof c === "string" ? c.toLowerCase().slice(0, 2) : "";
    if ((LOCALES as readonly string[]).includes(v)) return v as Locale;
  }
  return "en";
}

const MAX_TEXT = 100;
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Single line, at most `max` graphemes (emoji and diacritics stay whole), "…" when cut. */
export function truncate(text: string, max = MAX_TEXT): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const g = Array.from(segmenter.segment(flat), (s) => s.segment);
  return g.length <= max ? flat : g.slice(0, max - 1).join("").trimEnd() + "…";
}

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;

/** Display names never carry an address: "ana@x.ro" becomes "ana". */
export function safeName(name: string | null | undefined, fallback: string): string {
  const n = (name ?? "").replace(EMAIL, (m) => m.split("@")[0]).trim();
  return n ? truncate(n, 40) : fallback;
}

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

function plural(locale: Locale, forms: Record<string, string>, n: number, vars: Record<string, string>): string {
  const cat = new Intl.PluralRules(locale).select(n);
  return fill((forms[cat] ?? forms.other).replace(/#/g, String(n)), vars);
}

export function render(item: ClaimedItem, locale: Locale): { title: string; body: string } {
  const s = STRINGS[locale];
  const d = item.data ?? {};
  const bubble = truncate(item.bubble_name ?? "Boolaa", 60);
  const name = safeName(item.actor_name, s.someone);
  const vars = { bubble, name };
  const preview = item.preview_content !== false;

  // Private mode: no names, no content. The bubble name stays (it is the user's own context).
  if (!preview) {
    switch (item.type) {
      case "chat":
        return { title: s.app, body: plural(locale, s.chat.private, Math.max(1, item.count), vars) };
      case "approval":
        return { title: s.app, body: fill(s.approval.private, vars) };
      default:
        return { title: s.app, body: fill(s[item.type].private, vars) };
    }
  }

  switch (item.type) {
    case "chat": {
      // A photo message may have no text (caption optional).
      let body = truncate(d.text ?? "") || (d.photo ? s.chat.photo : "");
      if (item.count > 1) body = truncate(`${body} ${plural(locale, s.chat.more, item.count - 1, vars)}`, MAX_TEXT + 30);
      return { title: fill(s.chat.title, vars), body };
    }
    case "join_request":
      return { title: bubble, body: fill(s.join_request.body, vars) };
    case "approval":
      return { title: fill(s.approval.title, vars), body: s.approval.body };
    case "new_event":
      return { title: fill(s.new_event.title, vars), body: fill(s.new_event.body, { ...vars, event: truncate(d.title ?? "", 80) }) };
    case "event_reminder": {
      const location = d.location ? truncate(String(d.location), 60) : "";
      return {
        title: truncate(d.title ?? bubble, 80),
        body: location ? fill(s.event_reminder.bodyWithPlace, { location }) : s.event_reminder.body,
      };
    }
    case "food": {
      const text = d.text ? truncate(String(d.text)) : "";
      return { title: fill(s.food.title, vars), body: text ? fill(s.food.body, { ...vars, text }) : fill(s.food.bodyNoText, vars) };
    }
    case "market":
      return {
        title: fill(s.market.title, vars),
        body: fill(s.market.body, {
          ...vars,
          item: truncate(d.title ?? "", 80),
          status: d.status === "trade" ? s.market.trade : s.market.free,
        }),
      };
  }
}

const CATEGORY: Record<NotificationType, string> = {
  chat: "CHAT_MESSAGE",
  join_request: "JOIN_REQUEST",
  approval: "BUBBLE_JOINED",
  new_event: "NEW_EVENT",
  event_reminder: "EVENT_REMINDER",
  food: "FOOD_POST",
  market: "MARKET_ITEM",
};

const CHANNEL: Record<NotificationType, string> = {
  chat: "chat",
  join_request: "bubble",
  approval: "bubble",
  new_event: "events",
  event_reminder: "events",
  food: "bubble",
  market: "bubble",
};

/** Web route to open; the web app switches to `bubble` first. */
export function webUrl(type: NotificationType, bubbleId: string | null, targetId: string | null): string {
  const b = encodeURIComponent(bubbleId ?? "");
  const t = encodeURIComponent(targetId ?? "");
  switch (type) {
    case "chat": return `/chat?bubble=${b}`;
    case "join_request": return `/settings?bubble=${b}`;
    case "approval": return `/home?bubble=${b}`;
    case "new_event":
    case "event_reminder": return `/events?bubble=${b}&event=${t}`;
    case "food": return `/food?bubble=${b}&post=${t}`;
    case "market": return `/marketplace?bubble=${b}&item=${t}`;
  }
}

export function buildMessage(item: ClaimedItem, token: TokenRow, now = Date.now()): PushMessage & { locale: Locale } {
  const locale = pickLocale(token.locale, item.user_locale);
  const { title, body } = render(item, locale);
  const nowS = Math.floor(now / 1000);
  let expiresAt = nowS + 24 * 3600;
  if (item.type === "event_reminder" && item.data?.starts_at) {
    expiresAt = Math.max(nowS + 60, Math.floor(Date.parse(item.data.starts_at) / 1000));
  }
  return {
    locale,
    type: item.type,
    bubbleId: item.bubble_id,
    targetId: item.target_id,
    title,
    body,
    collapseKey: item.collapse_key,
    category: CATEGORY[item.type],
    channelId: CHANNEL[item.type],
    url: webUrl(item.type, item.bubble_id, item.target_id),
    expiresAt,
  };
}
