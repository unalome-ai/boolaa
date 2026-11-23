"use client";

import { useEffect, useRef, useSyncExternalStore, type RefObject } from "react";

/**
 * Says a short status ("Copied", "Saved") through a polite live region, for changes that are only
 * visible as a button's new text. One shared region, created on first use.
 */
export function announce(text: string) {
  if (typeof document === "undefined") return;
  let el = document.getElementById("a11y-announcer");
  if (!el) {
    el = document.createElement("div");
    el.id = "a11y-announcer";
    el.className = "sr-only";
    el.setAttribute("aria-live", "polite");
    el.setAttribute("aria-atomic", "true");
    document.body.appendChild(el);
  }
  // Clear first so the same text twice is still read.
  el.textContent = "";
  const node = el;
  setTimeout(() => (node.textContent = text), 50);
}

/** True when the OS asks for reduced motion (docs/design-system.md 5.5). */
export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Smooth scrolling unless reduced motion is on. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}

/**
 * Keyboard for a popup menu (WAI-ARIA menu pattern): focus goes to the first item when it opens,
 * arrow keys / Home / End move between items, Escape closes it and gives focus back to the trigger.
 * Escape is marked handled so a dialog around the menu stays open.
 */
export function useMenuKeys(
  open: boolean,
  close: () => void,
  menu: RefObject<HTMLElement | null>,
  trigger: RefObject<HTMLElement | null>,
  orientation: "vertical" | "horizontal" = "vertical",
) {
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    if (!open) return;
    const items = () => Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    items()[0]?.focus();
    const next = orientation === "vertical" ? "ArrowDown" : "ArrowRight";
    const prev = orientation === "vertical" ? "ArrowUp" : "ArrowLeft";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
        trigger.current?.focus();
        return;
      }
      const list = items();
      const at = list.indexOf(document.activeElement as HTMLElement);
      if (at < 0) return;
      let to = -1;
      if (e.key === next) to = (at + 1) % list.length;
      else if (e.key === prev) to = (at - 1 + list.length) % list.length;
      else if (e.key === "Home") to = 0;
      else if (e.key === "End") to = list.length - 1;
      else if (e.key === "Tab") {
        closeRef.current();
        return;
      }
      if (to >= 0) {
        e.preventDefault();
        list[to]?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, menu, trigger, orientation]);
}

const subscribeMotion = (cb: () => void) => {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

/** Reactive prefers-reduced-motion for components that animate from script. */
export function useReducedMotion() {
  return useSyncExternalStore(subscribeMotion, prefersReducedMotion, () => false);
}
