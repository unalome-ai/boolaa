"use client";

import { useEffect } from "react";

// Hands a prefilled (unsent) message to the chat screen, e.g. "Ask in chat" on a market item.
// sessionStorage covers a chat page that mounts after navigation; the window event covers one that
// is already mounted but hidden (visited routes stay mounted).
const KEY = "boolaa_chat_draft";
const EVENT = "boolaa:chat-draft";

/** The person the draft starts with (`@name`): a mention token when they are a mention candidate. */
export type DraftMention = { userId: string; name: string };
export type ChatDraft = { text: string; mention: DraftMention | null };

export function setChatDraft(bubbleId: string, text: string, mention: DraftMention | null = null) {
  sessionStorage.setItem(KEY, JSON.stringify({ bubbleId, text, mention }));
  window.dispatchEvent(new Event(EVENT));
}

/** Returns and clears the pending draft for this bubble, if any. */
export function takeChatDraft(bubbleId: string): ChatDraft | null {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as { bubbleId?: string; text?: string; mention?: DraftMention | null };
    if (d.bubbleId !== bubbleId || typeof d.text !== "string") return null;
    sessionStorage.removeItem(KEY);
    const m = d.mention;
    return { text: d.text, mention: m && typeof m.userId === "string" && typeof m.name === "string" ? m : null };
  } catch {
    sessionStorage.removeItem(KEY);
    return null;
  }
}

export function useChatDraft(bubbleId: string, onDraft: (draft: ChatDraft) => void) {
  useEffect(() => {
    const pull = () => {
      const draft = takeChatDraft(bubbleId);
      if (draft !== null) onDraft(draft);
    };
    pull();
    window.addEventListener(EVENT, pull);
    return () => window.removeEventListener(EVENT, pull);
  }, [bubbleId, onDraft]);
}
