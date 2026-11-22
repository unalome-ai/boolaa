"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useBoolaa } from "@/components/boolaa-provider";
import { TARGET_PARAM, reportView } from "@/lib/push";
import { HIGHLIGHT_EVENT, type HighlightDetail } from "@/lib/search";

const HIGHLIGHT_MS = 4000;

/** Waits for the visible card `[data-item-id=id]`, scrolls to it and highlights it; returns a cancel. */
function highlightWhenShown(param: string, id: string) {
  let tries = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const find = () => {
    // Visited routes stay mounted but hidden: only the visible card counts.
    const el = [...document.querySelectorAll<HTMLElement>(`[data-item-id="${CSS.escape(id)}"]`)].find((e) =>
      typeof e.checkVisibility === "function" ? e.checkVisibility() : e.offsetParent !== null,
    );
    if (!el) {
      if (++tries < 40) timer = setTimeout(find, 250); // the list loads client-side
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    el.dataset.highlight = "true";
    setTimeout(() => delete el.dataset.highlight, HIGHLIGHT_MS); // not cancelled: never leave it stuck
    const url = new URL(window.location.href);
    if (url.searchParams.get(param) === id) {
      url.searchParams.delete(param);
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }
  };
  find();
  return () => clearTimeout(timer);
}

/**
 * Notification deep links (docs/push-notifications.md §5). The bubble switch (`?bubble=`) happens in
 * BoolaaProvider; this scrolls to and briefly highlights the target item (`/events?event=`,
 * `/food?post=`, `/marketplace?item=`, and `/links?link=` from search) once its card (`data-item-id`) is
 * on screen. A target that no longer exists just leaves the screen as it is. It also tells the service
 * worker which page and bubble this tab shows, so a chat push for the open chat shows no banner.
 */
export function DeepLinkTarget() {
  const pathname = usePathname();
  const { bubble } = useBoolaa();
  const bubbleId = bubble?.id ?? null;

  useEffect(() => {
    const report = () => reportView(pathname, bubbleId);
    report();
    const sw = typeof navigator !== "undefined" && "serviceWorker" in navigator ? navigator.serviceWorker : null;
    sw?.addEventListener("controllerchange", report);
    return () => sw?.removeEventListener("controllerchange", report);
  }, [pathname, bubbleId]);

  useEffect(() => {
    let stop: (() => void) | undefined;
    const run = (param: string, id: string) => {
      stop?.();
      stop = highlightWhenShown(param, id);
    };
    const param = TARGET_PARAM[pathname];
    const id = param ? new URLSearchParams(window.location.search).get(param) : null;
    if (param && id) run(param, id);
    // Search opening an item on the route already shown: the pathname doesn't change, so it says so.
    const onHighlight = (e: Event) => {
      const d = (e as CustomEvent<HighlightDetail>).detail;
      if (d && d.path === pathname && TARGET_PARAM[pathname] === d.param) run(d.param, d.id);
    };
    window.addEventListener(HIGHLIGHT_EVENT, onHighlight);
    return () => {
      window.removeEventListener(HIGHLIGHT_EVENT, onHighlight);
      stop?.();
    };
  }, [pathname]);

  return null;
}
