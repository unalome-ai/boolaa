/**
 * Chat outbox (docs/boolaa-spec.md, "Offline and poor network"): a message is shown at once as
 * "Sending…", sent with a client-generated id, and kept as "Not sent" with Try again when that
 * fails. A retry of a message that already reached the server fails with 23505 (primary key) and
 * counts as sent, and merges are by id, so nothing is lost or doubled. Photos upload to
 * `<uid>/<message id>.jpg`, so a retried upload of an existing object counts as uploaded.
 *
 * Text messages are kept in sessionStorage per user (restored as "Not sent"); photos only in memory.
 */
import { useSyncExternalStore } from "react";
import { getConnectivity } from "@/lib/connectivity";
import { CHAT_BUCKET } from "@/lib/chat";
import { OUTBOX_PREFIX, clearOfflineData, isAlreadyUploaded, isNetworkError, isUniqueViolation, type KeyValueStore } from "@/lib/offline";
import { AUTHOR, type ChatMessage } from "@/lib/types";
import type { BoolaaClient } from "@/lib/supabase/client";

export type OutboxState = "sending" | "failed";

export type OutboxItem = {
  /** Client-generated; becomes the message id. */
  id: string;
  bubble_id: string;
  sender_id: string;
  content: string;
  /** Local time it was written (display order only; the server sets created_at). */
  created_at: string;
  state: OutboxState;
  /** `<uid>/<id>.jpg` in chat.images when the message has a photo. */
  image_path: string | null;
  /** Last failure, for the error text (memory only). */
  error?: unknown;
};

// ---- pure helpers (tests/offline-logic.spec.ts) ---------------------------------------------

export function enqueue(list: OutboxItem[], item: OutboxItem): OutboxItem[] {
  return list.some((i) => i.id === item.id) ? list : [...list, item];
}

export function setState(list: OutboxItem[], id: string, state: OutboxState, error?: unknown): OutboxItem[] {
  return list.map((i) => (i.id === id ? { ...i, state, error: state === "failed" ? error : undefined } : i));
}

export function removeItem(list: OutboxItem[], id: string): OutboxItem[] {
  return list.filter((i) => i.id !== id);
}

/** The bubble's pending messages not yet in `messages` (sent ones arrive by id), oldest first. */
export function pendingFor(list: OutboxItem[], bubbleId: string, messages: { id: string }[] = []): OutboxItem[] {
  const sent = new Set(messages.map((m) => m.id));
  return list
    .filter((i) => i.bubble_id === bubbleId && !sent.has(i.id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** What survives a reload: text messages, as "Not sent" (the user decides; no surprise sends). */
export function toPersisted(list: OutboxItem[]): OutboxItem[] {
  return list.filter((i) => !i.image_path).map((i) => ({ ...i, error: undefined, state: "failed" as const }));
}

export function restore(raw: string | null): OutboxItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((i): i is OutboxItem => !!i && typeof i.id === "string" && typeof i.bubble_id === "string" && typeof i.content === "string")
      .map((i) => ({ ...i, image_path: null, state: "failed" as const }));
  } catch {
    return [];
  }
}

// ---- store ----------------------------------------------------------------------------------

let items: OutboxItem[] = [];
let owner: string | null = null;
const photos = new Map<string, { jpeg: Blob; preview: string }>();
const listeners = new Set<() => void>();
const sentListeners = new Set<(row: ChatMessage) => void>();
let flushing = false;

function storage(): KeyValueStore | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function commit(next: OutboxItem[]) {
  items = next;
  if (owner) {
    const kept = toPersisted(items);
    try {
      if (kept.length) storage()?.setItem(`${OUTBOX_PREFIX}${owner}`, JSON.stringify(kept));
      else storage()?.removeItem(`${OUTBOX_PREFIX}${owner}`);
    } catch {
      // best effort
    }
  }
  listeners.forEach((l) => l());
}

/** Loads the signed-in user's saved outbox (setOfflineUser already removed other users'). */
export function setOutboxUser(userId: string) {
  if (owner === userId) return;
  owner = userId;
  dropPhotos();
  commit(restore(storage()?.getItem(`${OUTBOX_PREFIX}${userId}`) ?? null));
}

/** Sign-out and account deletion. */
export function clearOutbox() {
  owner = null;
  dropPhotos();
  items = [];
  listeners.forEach((l) => l());
}

/** Sign-out and account deletion: no cached view or queued message of anyone stays in the tab. */
export function forgetOfflineData() {
  clearOfflineData();
  clearOutbox();
}

function dropPhotos() {
  photos.forEach((p) => URL.revokeObjectURL(p.preview));
  photos.clear();
}

export function useOutbox(): OutboxItem[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => items,
    () => EMPTY,
  );
}
const EMPTY: OutboxItem[] = [];

/** The local preview of a pending photo message. */
export function outboxPreview(id: string) {
  return photos.get(id)?.preview ?? null;
}

/** Called with the server row when a message was sent (the chat view merges it by id). */
export function onOutboxSent(listener: (row: ChatMessage) => void) {
  sentListeners.add(listener);
  return () => void sentListeners.delete(listener);
}

/**
 * Queues a message and sends it now when online; offline it waits for the reconnect flush.
 * `jpeg` is the already prepared photo (lib/image.ts), so pipeline errors surface before queueing.
 */
export function sendMessage(supabase: BoolaaClient, msg: { bubbleId: string; userId: string; content: string; jpeg?: Blob }) {
  const id = crypto.randomUUID();
  const item: OutboxItem = {
    id,
    bubble_id: msg.bubbleId,
    sender_id: msg.userId,
    content: msg.content,
    created_at: new Date().toISOString(),
    state: "sending",
    image_path: msg.jpeg ? `${msg.userId}/${id}.jpg` : null,
  };
  if (msg.jpeg) photos.set(id, { jpeg: msg.jpeg, preview: URL.createObjectURL(msg.jpeg) });
  commit(enqueue(items, item));
  if (getConnectivity().status === "online") void attempt(supabase, id);
  return id;
}

/** Try again on a "Not sent" message. */
export function retryMessage(supabase: BoolaaClient, id: string) {
  commit(setState(items, id, "sending"));
  void attempt(supabase, id);
}

/** "Don't send": forget it, and remove its photo if an earlier attempt uploaded it. */
export function discardMessage(supabase: BoolaaClient, id: string) {
  const item = items.find((i) => i.id === id);
  if (!item) return;
  const photo = photos.get(id);
  if (photo) URL.revokeObjectURL(photo.preview);
  photos.delete(id);
  commit(removeItem(items, id));
  if (item.image_path) void supabase.storage.from(CHAT_BUCKET).remove([item.image_path]).catch(() => undefined);
}

/** Messages found in the chat already (delivered by an earlier attempt): drop them from the outbox. */
export function markDelivered(ids: string[]) {
  const gone = new Set(ids);
  if (!items.some((i) => gone.has(i.id) && !inFlight.has(i.id))) return;
  commit(items.filter((i) => !gone.has(i.id) || inFlight.has(i.id)));
}

/** After a reconnect: sends every waiting ("Sending…") message, in order, one at a time. */
export async function flushOutbox(supabase: BoolaaClient) {
  if (flushing) return;
  flushing = true;
  try {
    for (const item of [...items].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
      if (item.state !== "sending") continue;
      if (getConnectivity().status !== "online") break;
      await attempt(supabase, item.id);
    }
  } finally {
    flushing = false;
  }
}

const inFlight = new Set<string>();

async function attempt(supabase: BoolaaClient, id: string) {
  if (inFlight.has(id)) return;
  const item = items.find((i) => i.id === id);
  if (!item) return;
  inFlight.add(id);
  try {
    if (item.image_path) {
      const photo = photos.get(id);
      if (!photo) throw new Error("photo missing");
      const up = await supabase.storage
        .from(CHAT_BUCKET)
        .upload(item.image_path, photo.jpeg, { contentType: "image/jpeg", upsert: false });
      if (up.error && !isAlreadyUploaded(up.error)) throw up.error;
    }
    const select = `*, sender:users!sender_id(${AUTHOR})`;
    let { data, error } = await supabase
      .from("chat_messages")
      .insert({ id, bubble_id: item.bubble_id, sender_id: item.sender_id, content: item.content, image_path: item.image_path })
      .select(select)
      .single();
    if (error && isUniqueViolation(error)) {
      // An earlier attempt got through (its answer was lost): it is sent. Fetch it to show it.
      ({ data, error } = await supabase.from("chat_messages").select(select).eq("id", id).single());
    }
    if (error) throw error;
    const photo = photos.get(id);
    if (photo) URL.revokeObjectURL(photo.preview);
    photos.delete(id);
    commit(removeItem(items, id));
    if (data) sentListeners.forEach((l) => l(data as unknown as ChatMessage));
  } catch (err) {
    if (!items.some((i) => i.id === id)) return; // discarded meanwhile
    // Lost connection: keep it waiting ("Sending…") for the reconnect flush. Anything else: Not sent.
    const waiting = isNetworkError(err) && getConnectivity().status !== "online";
    commit(setState(items, id, waiting ? "sending" : "failed", err));
  } finally {
    inFlight.delete(id);
  }
}
