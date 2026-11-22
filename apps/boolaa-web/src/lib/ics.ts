/**
 * iCalendar (RFC 5545) export for one event: "Add to calendar" on the web.
 *
 * - Timed events are written in UTC (`DTSTART:20261201T180000Z`). Events store a timestamptz, so
 *   UTC is exact and needs no VTIMEZONE block; calendar apps show it in the viewer's zone.
 * - All-day events (`allDay: true`) use `VALUE=DATE` with an exclusive DTEND (the next day), the
 *   calendar date taken in `timeZone` (an IANA name, default UTC).
 * - Boolaa events have no end time: without `end`, timed events last DEFAULT_DURATION_MS (1 hour)
 *   and all-day events one day. iOS and Android use the same 1-hour default.
 * - TEXT values are escaped (\\ ; , and newlines), lines are folded at 75 octets (UTF-8, never
 *   splitting a character) and every line ends with CRLF.
 */

export const DEFAULT_DURATION_MS = 60 * 60 * 1000;
const PRODID = "-//Boolaa//Boolaa Events//EN";
/** Right-hand side of UIDs: a stable id per event, the same on every export. */
export const UID_DOMAIN = "boolaa.ro";

export interface IcsEvent {
  /** Stable id (the event row's uuid) → UID `<id>@boolaa.ro`. */
  id: string;
  title: string;
  start: Date | string;
  end?: Date | string | null;
  allDay?: boolean;
  /** IANA zone used to pick the calendar date of an all-day event. Default "UTC". */
  timeZone?: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
}

/** Escapes a TEXT value (RFC 5545 §3.3.11). */
export function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

const encoder = new TextEncoder();

/** Folds one content line into ≤75-octet chunks joined by CRLF + space (RFC 5545 §3.1). */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  // Continuation lines start with a space, which counts toward their 75 octets.
  let limit = 75;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    if (bytes + n > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
      limit = 74;
    }
    current += ch;
    bytes += n;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** `20261201T180000Z` (seconds kept, milliseconds dropped). */
export function formatUtc(d: Date): string {
  if (Number.isNaN(d.getTime())) throw new RangeError("invalid date");
  return `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** The calendar date of `d` in `timeZone` as `YYYYMMDD`. */
export function formatDate(d: Date, timeZone = "UTC"): string {
  if (Number.isNaN(d.getTime())) throw new RangeError("invalid date");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}${get("month")}${get("day")}`;
}

/** YYYYMMDD + n days (pure calendar arithmetic, no zone). */
function addDays(yyyymmdd: string, n: number): string {
  const d = new Date(Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8) + n));
  return `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

const toDate = (v: Date | string) => (v instanceof Date ? v : new Date(v));

/** Builds a complete VCALENDAR with one VEVENT. `now` is the DTSTAMP (injectable for tests). */
export function buildIcs(ev: IcsEvent, now: Date = new Date()): string {
  const start = toDate(ev.start);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${PRODID}`, "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT"];
  lines.push(`UID:${ev.id}@${UID_DOMAIN}`, `DTSTAMP:${formatUtc(now)}`);
  if (ev.allDay) {
    const zone = ev.timeZone ?? "UTC";
    const first = formatDate(start, zone);
    // DTEND is exclusive for dates: the day after the last day, at least one day after DTSTART.
    let endDay = ev.end ? addDays(formatDate(toDate(ev.end), zone), 1) : addDays(first, 1);
    if (endDay <= first) endDay = addDays(first, 1);
    lines.push(`DTSTART;VALUE=DATE:${first}`, `DTEND;VALUE=DATE:${endDay}`);
  } else {
    let end = ev.end ? toDate(ev.end) : new Date(start.getTime() + DEFAULT_DURATION_MS);
    if (!(end.getTime() > start.getTime())) end = new Date(start.getTime() + DEFAULT_DURATION_MS);
    lines.push(`DTSTART:${formatUtc(start)}`, `DTEND:${formatUtc(end)}`);
  }
  lines.push(`SUMMARY:${escapeText(ev.title)}`);
  if (ev.description?.trim()) lines.push(`DESCRIPTION:${escapeText(ev.description)}`);
  if (ev.location?.trim()) lines.push(`LOCATION:${escapeText(ev.location)}`);
  // URI values are not TEXT-escaped (§3.3.13); drop anything that would break the line.
  if (ev.url) lines.push(`URL:${ev.url.replace(/[\r\n]/g, "")}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** A safe file name for the download, e.g. "Board games night.ics". */
export function icsFileName(title: string): string {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return `${base || "event"}.ics`;
}

/** Triggers a browser download of the event as a .ics file. */
export function downloadIcs(ev: IcsEvent): void {
  const blob = new Blob([buildIcs(ev)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = icsFileName(ev.title);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
