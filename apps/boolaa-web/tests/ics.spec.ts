import { expect, test } from "@playwright/test";
import { buildIcs, DEFAULT_DURATION_MS, escapeText, foldLine, formatDate, formatUtc, icsFileName } from "../src/lib/ics";

// Pure unit tests for the RFC 5545 generator behind "Add to calendar" (no browser needed).
const NOW = new Date("2026-11-22T10:00:00Z");
const bytes = (s: string) => new TextEncoder().encode(s).length;
/** Undoes folding (CRLF + one space) and splits into content lines. */
const unfold = (ics: string) => ics.replace(/\r\n /g, "").split("\r\n").filter(Boolean);
const prop = (ics: string, name: string) => unfold(ics).find((l) => l.startsWith(`${name}:`) || l.startsWith(`${name};`));

test("minimal timed event: structure, UID, DTSTAMP, UTC times, 1-hour default, CRLF", () => {
  const ics = buildIcs({ id: "8d6f0c1e-0000-4000-8000-000000000001", title: "Board games", start: "2026-12-01T18:00:00Z" }, NOW);
  expect(ics.endsWith("\r\n")).toBe(true);
  expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/); // no bare LF or CR anywhere
  expect(unfold(ics)).toEqual([
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Boolaa//Boolaa Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    "UID:8d6f0c1e-0000-4000-8000-000000000001@boolaa.ro",
    "DTSTAMP:20261122T100000Z",
    "DTSTART:20261201T180000Z",
    "DTEND:20261201T190000Z",
    "SUMMARY:Board games",
    "END:VEVENT",
    "END:VCALENDAR",
  ]);
  expect(DEFAULT_DURATION_MS).toBe(3_600_000);
});

test("UID is stable per event; DTSTAMP follows the export time", () => {
  const ev = { id: "e1", title: "x", start: "2026-12-01T18:00:00Z" };
  const a = buildIcs(ev, NOW);
  const b = buildIcs(ev, new Date("2026-11-23T08:30:15.987Z"));
  expect(prop(a, "UID")).toBe(prop(b, "UID"));
  expect(prop(b, "DTSTAMP")).toBe("DTSTAMP:20261123T083015Z");
  expect(prop(buildIcs({ ...ev, id: "e2" }, NOW), "UID")).not.toBe(prop(a, "UID"));
});

test("time zones: offsets and Date objects are converted to UTC", () => {
  // 20:30 in Bucharest (UTC+2 in winter) is 18:30Z.
  expect(prop(buildIcs({ id: "a", title: "t", start: "2026-12-01T20:30:00+02:00" }, NOW), "DTSTART")).toBe("DTSTART:20261201T183000Z");
  // Summer time (UTC+3) and a negative offset crossing midnight.
  expect(prop(buildIcs({ id: "a", title: "t", start: "2026-07-01T09:00:00+03:00" }, NOW), "DTSTART")).toBe("DTSTART:20260701T060000Z");
  const ics = buildIcs({ id: "a", title: "t", start: "2026-12-31T22:00:00-05:00" }, NOW);
  expect(prop(ics, "DTSTART")).toBe("DTSTART:20270101T030000Z");
  expect(prop(ics, "DTEND")).toBe("DTEND:20270101T040000Z");
  // PostgREST timestamptz text (microseconds, +00:00).
  expect(prop(buildIcs({ id: "a", title: "t", start: "2026-12-01T18:00:00.123456+00:00" }, NOW), "DTSTART")).toBe("DTSTART:20261201T180000Z");
  expect(formatUtc(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)))).toBe("20260102T030405Z");
  expect(() => formatUtc(new Date("nope"))).toThrow(RangeError);
});

test("explicit end is kept; an end not after the start falls back to 1 hour", () => {
  const ok = buildIcs({ id: "a", title: "t", start: "2026-12-01T18:00:00Z", end: "2026-12-01T21:15:00Z" }, NOW);
  expect(prop(ok, "DTEND")).toBe("DTEND:20261201T211500Z");
  const bad = buildIcs({ id: "a", title: "t", start: "2026-12-01T18:00:00Z", end: "2026-12-01T17:00:00Z" }, NOW);
  expect(prop(bad, "DTEND")).toBe("DTEND:20261201T190000Z");
});

test("all-day events use VALUE=DATE with an exclusive end, dated in the given zone", () => {
  const one = buildIcs({ id: "a", title: "Picnic", start: "2026-12-01T00:00:00Z", allDay: true }, NOW);
  expect(prop(one, "DTSTART")).toBe("DTSTART;VALUE=DATE:20261201");
  expect(prop(one, "DTEND")).toBe("DTEND;VALUE=DATE:20261202");
  // 23:30Z on Dec 1 is already Dec 2 in Bucharest.
  const late = buildIcs({ id: "a", title: "t", start: "2026-12-01T23:30:00Z", allDay: true, timeZone: "Europe/Bucharest" }, NOW);
  expect(prop(late, "DTSTART")).toBe("DTSTART;VALUE=DATE:20261202");
  expect(prop(late, "DTEND")).toBe("DTEND;VALUE=DATE:20261203");
  // Multi-day, inclusive end date → exclusive DTEND; month and year rollover.
  const multi = buildIcs({ id: "a", title: "t", start: "2026-12-30T12:00:00Z", end: "2027-01-01T12:00:00Z", allDay: true }, NOW);
  expect(prop(multi, "DTSTART")).toBe("DTSTART;VALUE=DATE:20261230");
  expect(prop(multi, "DTEND")).toBe("DTEND;VALUE=DATE:20270102");
  // Leap day.
  expect(prop(buildIcs({ id: "a", title: "t", start: "2028-02-28T10:00:00Z", allDay: true }, NOW), "DTEND")).toBe("DTEND;VALUE=DATE:20280229");
  expect(formatDate(new Date("2026-12-01T23:30:00Z"), "America/Los_Angeles")).toBe("20261201");
});

test("TEXT escaping: backslash, semicolon, comma and every newline form", () => {
  expect(escapeText("a\\b;c,d")).toBe("a\\\\b\\;c\\,d");
  expect(escapeText("l1\nl2\r\nl3\rl4")).toBe("l1\\nl2\\nl3\\nl4");
  expect(escapeText("already \\n escaped?")).toBe("already \\\\n escaped?");
  expect(escapeText("colon: fine \"quotes\" too")).toBe("colon: fine \"quotes\" too");
  const ics = buildIcs(
    { id: "a", title: "Pizza; drinks, games", start: "2026-12-01T18:00:00Z", description: "Bring:\n- chips\n- cola, juice", location: "Str. Lungă 5, Brașov; et. 2" },
    NOW,
  );
  expect(prop(ics, "SUMMARY")).toBe("SUMMARY:Pizza\\; drinks\\, games");
  expect(prop(ics, "DESCRIPTION")).toBe("DESCRIPTION:Bring:\\n- chips\\n- cola\\, juice");
  expect(prop(ics, "LOCATION")).toBe("LOCATION:Str. Lungă 5\\, Brașov\\; et. 2");
});

test("empty description and location are left out; URL is written unescaped", () => {
  const ics = buildIcs({ id: "a", title: "t", start: "2026-12-01T18:00:00Z", description: "  ", location: null, url: "https://boolaa.ro/events?x=1,2" }, NOW);
  expect(prop(ics, "DESCRIPTION")).toBeUndefined();
  expect(prop(ics, "LOCATION")).toBeUndefined();
  expect(prop(ics, "URL")).toBe("URL:https://boolaa.ro/events?x=1,2");
});

test("folding: lines over 75 octets are split with CRLF + space, never inside a UTF-8 character", () => {
  expect(foldLine("x".repeat(75))).toBe("x".repeat(75));
  const f = foldLine("x".repeat(76));
  expect(f).toBe(`${"x".repeat(75)}\r\n x`);

  const long = `DESCRIPTION:${"Ăsta e un test cu diacritice șțâî și emoji 🎲🍕 ".repeat(8)}`;
  const folded = foldLine(long);
  const physical = folded.split("\r\n");
  expect(physical.length).toBeGreaterThan(1);
  for (const [i, l] of physical.entries()) {
    expect(bytes(l)).toBeLessThanOrEqual(75);
    if (i > 0) expect(l.startsWith(" ")).toBe(true);
    expect(l).not.toContain("�");
  }
  // Unfolding gives the original back exactly (no character was cut).
  expect(folded.replace(/\r\n /g, "")).toBe(long);

  // A whole document: every physical line ≤ 75 octets.
  const ics = buildIcs({ id: "a", title: "🎉".repeat(40), start: "2026-12-01T18:00:00Z", description: "é".repeat(200) }, NOW);
  for (const l of ics.split("\r\n")) expect(bytes(l)).toBeLessThanOrEqual(75);
  expect(prop(ics, "SUMMARY")).toBe(`SUMMARY:${"🎉".repeat(40)}`);
  expect(prop(ics, "DESCRIPTION")).toBe(`DESCRIPTION:${"é".repeat(200)}`);
});

test("download file names are safe", () => {
  expect(icsFileName("Board games night")).toBe("Board games night.ics");
  expect(icsFileName('a/b\\c:d*e?"f<g>h|i')).toBe("a b c d e f g h i.ics");
  expect(icsFileName("   ")).toBe("event.ics");
  expect(icsFileName("x".repeat(100))).toBe(`${"x".repeat(60)}.ics`);
});
