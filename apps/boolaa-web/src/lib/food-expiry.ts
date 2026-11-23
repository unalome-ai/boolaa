/**
 * Food expiry (docs/boolaa-spec.md, "Food expiry"): the "Good until" presets, the custom bounds, the card
 * label and which posts are shown. Pure functions over local time (the browser's zone), so tests can pin
 * `now`.
 */

export const EXPIRY_PRESETS = ["today", "tomorrow", "in3days", "custom"] as const;
export type ExpiryPreset = (typeof EXPIRY_PRESETS)[number];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 23:59 local, `days` after today. */
function endOfDay(now: Date, days: number) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, 23, 59, 0, 0);
}

/** The value of a preset ("custom" has none: see {@link customDefault}). */
export function presetValue(preset: Exclude<ExpiryPreset, "custom">, now: Date): Date {
  return endOfDay(now, preset === "today" ? 0 : preset === "tomorrow" ? 1 : 3);
}

/** "Today" is off from 23:00 (less than an hour left). */
export const todayDisabled = (now: Date) => now.getHours() >= 23;

/** Custom picker range: now + 15 min … now + 14 days − 5 min (margin for clock skew). */
export function customBounds(now: Date) {
  return { min: new Date(now.getTime() + 15 * MINUTE), max: new Date(now.getTime() + 14 * DAY - 5 * MINUTE) };
}

/** Custom starts at tomorrow 18:00. */
export function customDefault(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 18, 0, 0, 0);
}

const sameMinute = (a: Date, b: Date) => Math.floor(a.getTime() / MINUTE) === Math.floor(b.getTime() / MINUTE);

/** Editing: the segment whose value equals `expiresAt` to the minute, else "custom". */
export function presetFor(expiresAt: Date, now: Date): ExpiryPreset {
  for (const p of ["today", "tomorrow", "in3days"] as const) {
    if (p === "today" && todayDisabled(now)) continue;
    if (sameMinute(presetValue(p, now), expiresAt)) return p;
  }
  return "custom";
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `<input type="datetime-local">` value (local, minute precision). */
export function toLocalInput(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parses a datetime-local value as local time; null when empty or invalid. */
export function fromLocalInput(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Whether a custom value is inside the allowed range at `now`. */
export function customValid(d: Date | null, now: Date) {
  if (!d) return false;
  const { min, max } = customBounds(now);
  return d.getTime() >= min.getTime() - MINUTE && d.getTime() <= max.getTime();
}

export type ExpiryLabel =
  | { kind: "minutes"; count: number }
  | { kind: "hours"; count: number }
  | { kind: "today" | "tomorrow" | "day" | "date"; at: Date };

const dayIndex = (d: Date) => Math.round(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / DAY);

/**
 * The card label: under 1 h "Expires in N minutes" (at least 1), under 6 h "Expires in N hours" (rounded
 * down), then today / tomorrow / weekday (within 7 days) / date. Null once expired.
 */
export function expiryLabel(expiresAt: Date, now: Date): ExpiryLabel | null {
  const left = expiresAt.getTime() - now.getTime();
  if (left <= 0) return null;
  if (left < HOUR) return { kind: "minutes", count: Math.max(1, Math.floor(left / MINUTE)) };
  if (left < 6 * HOUR) return { kind: "hours", count: Math.floor(left / HOUR) };
  const days = dayIndex(expiresAt) - dayIndex(now);
  if (days <= 0) return { kind: "today", at: expiresAt };
  if (days === 1) return { kind: "tomorrow", at: expiresAt };
  if (days < 7) return { kind: "day", at: expiresAt };
  return { kind: "date", at: expiresAt };
}

type FoodLike = { expires_at: string; availability: string };

/** Food lists and Home never render handed-over or expired posts (RLS hides only the expired ones). */
export const foodVisible = (p: FoodLike, now: number) => p.availability !== "taken" && Date.parse(p.expires_at) > now;

/** The earliest expiry still ahead, to re-render when it passes; null when none. */
export function nextExpiry(posts: readonly FoodLike[], now: number): number | null {
  let next: number | null = null;
  for (const p of posts) {
    const at = Date.parse(p.expires_at);
    if (at > now && (next === null || at < next)) next = at;
  }
  return next;
}
