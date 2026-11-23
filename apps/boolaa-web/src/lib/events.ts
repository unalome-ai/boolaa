import { DEFAULT_DURATION_MS } from "@/lib/ics";

/**
 * Past events (docs/boolaa-spec.md "Events"). Events store only their start; like "Add to calendar"
 * they last 1 hour, so an event has ended once start + 1 h has passed. The server uses the same rule
 * (`event_has_ended`, toggle_rsvp refuses ended events), and so do iOS and Android.
 */
export const EVENT_DURATION_MS = DEFAULT_DURATION_MS;

export function hasEnded(datetime: string, now: number): boolean {
  return new Date(datetime).getTime() + EVENT_DURATION_MS <= now;
}

/** Splits events (sorted by start, ascending) into upcoming (same order) and past (most recent first). */
export function splitPast<T extends { datetime: string }>(events: T[], now: number): { upcoming: T[]; past: T[] } {
  const upcoming: T[] = [];
  const past: T[] = [];
  for (const e of events) (hasEnded(e.datetime, now) ? past : upcoming).push(e);
  past.sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime());
  return { upcoming, past };
}
