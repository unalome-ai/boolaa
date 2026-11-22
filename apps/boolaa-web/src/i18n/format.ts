"use client";

import { useFormatter, useNow } from "next-intl";
import { useMemo } from "react";

/** Locale-aware date/time helpers (Intl under the hood, via next-intl). */
export function useFormat() {
  const format = useFormatter();
  // Re-renders once a minute so "5 minutes ago" stays fresh.
  const now = useNow({ updateInterval: 60_000 });
  return useMemo(
    () => ({
      relative: (iso: string) => format.relativeTime(new Date(iso), now),
      dateTime: (iso: string) =>
        format.dateTime(new Date(iso), { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }),
      time: (iso: string) => format.dateTime(new Date(iso), { hour: "numeric", minute: "2-digit" }),
      month: (iso: string) => format.dateTime(new Date(iso), { month: "short" }),
      day: (iso: string) => format.dateTime(new Date(iso), { day: "numeric" }),
      number: (n: number) => format.number(n),
      now,
    }),
    [format, now],
  );
}
