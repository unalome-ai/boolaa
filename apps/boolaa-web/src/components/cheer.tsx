"use client";

import { useEffect, useState } from "react";
import { Mascot } from "@/components/orb";
import type { Hue } from "@/lib/hue";

/**
 * Success moments with the cheering mascot (docs/design-system.md §8.4): RSVP confirmed, your first event /
 * post / item, and being admitted to a bubble. A small pill above the dock for 2.8 s, announced politely.
 * It never takes focus or blocks a tap.
 */
const EVENT = "boolaa:cheer";
const SHOW_MS = 2800;

type Cheer = { text: string; hue: Hue; id: number };

export function cheer(text: string, hue: Hue = "mint") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<Omit<Cheer, "id">>(EVENT, { detail: { text, hue } }));
}

export function CheerHost() {
  const [current, setCurrent] = useState<Cheer | null>(null);
  useEffect(() => {
    let timer = 0;
    const onCheer = (e: Event) => {
      const { text, hue } = (e as CustomEvent<Omit<Cheer, "id">>).detail;
      window.clearTimeout(timer);
      setCurrent({ text, hue, id: Date.now() });
      timer = window.setTimeout(() => setCurrent(null), SHOW_MS);
    };
    window.addEventListener(EVENT, onCheer);
    return () => {
      window.removeEventListener(EVENT, onCheer);
      window.clearTimeout(timer);
    };
  }, []);
  return (
    // Stays mounted so the polite region announces each new cheer.
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 z-[150] flex justify-center px-4"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 96px)" }}
      data-testid="cheer-host"
    >
      {current && (
        <p key={current.id} data-testid="cheer" className="cheer-toast flex max-w-full items-center gap-2.5 rounded-full bg-card py-1.5 pl-1.5 pr-5 font-display text-[15px] font-extrabold text-fg shadow-float ring-1 ring-line">
          <Mascot hue={current.hue} expression="cheering" size={40} companions={false} />
          <span>{current.text}</span>
        </p>
      )}
    </div>
  );
}

const WELCOME_KEY = "boolaa:welcome";

/** Admitted to a bubble (onboarding): Home cheers once when it opens that bubble. */
export function markWelcome(bubbleId: string) {
  try {
    sessionStorage.setItem(WELCOME_KEY, bubbleId);
  } catch {
    // Storage unavailable: no cheer, nothing else changes.
  }
}

/** Plays the "you're in" cheer if this bubble was just joined (see markWelcome). */
export function useWelcomeCheer(bubbleId: string, text: string, hue: Hue) {
  useEffect(() => {
    let pending: string | null = null;
    try {
      pending = sessionStorage.getItem(WELCOME_KEY);
      if (pending === bubbleId) sessionStorage.removeItem(WELCOME_KEY);
    } catch {
      return;
    }
    if (pending !== bubbleId) return;
    // After the shell's host has mounted.
    const id = window.setTimeout(() => cheer(text, hue), 300);
    return () => window.clearTimeout(id);
  }, [bubbleId, text, hue]);
}
