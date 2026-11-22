"use client";

import { useEffect } from "react";

// Hands a prefilled (unsent) message to the chat screen, e.g. "Ask in chat" on a market item.
// sessionStorage covers a chat page that mounts after navigation; the window event covers one that
// is already mounted but hidden (visited routes stay mounted).
const KEY = "boolaa_chat_draft";
const EVENT = "boolaa:chat-draft";

export function setChatDraft(bubbleId: string, text: string) {
  sessionStorage.setItem(KEY, JSON.stringify({ bubbleId, text }));
  window.dispatchEvent(new Event(EVENT));
}

/** Returns and clears the pending draft for this bubble, if any. */
export function takeChatDraft(bubbleId: string): string | null {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as { bubbleId?: string; text?: string };
    if (d.bubbleId !== bubbleId || typeof d.text !== "string") return null;
    sessionStorage.removeItem(KEY);
    return d.text;
  } catch {
    sessionStorage.removeItem(KEY);
    return null;
  }
}

export function useChatDraft(bubbleId: string, onDraft: (text: string) => void) {
  useEffect(() => {
    const pull = () => {
      const text = takeChatDraft(bubbleId);
      if (text !== null) onDraft(text);
    };
    pull();
    window.addEventListener(EVENT, pull);
    return () => window.removeEventListener(EVENT, pull);
  }, [bubbleId, onDraft]);
}
