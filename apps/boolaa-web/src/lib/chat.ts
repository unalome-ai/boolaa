/**
 * Chat helpers shared by the chat view, the shell's unread badges and the tests
 * (docs/boolaa-spec.md, "Chat"; migration 20261123120000_chat_improvements.sql).
 */
import { prepareImage } from "@/lib/image";
import type { BoolaaClient } from "@/lib/supabase/client";

export const CHAT_PAGE = 50;
export const CHAT_BUCKET = "chat.images" as const;
/** Signed URLs for chat photos (private bucket) live this long; they are cached a bit less. */
export { SIGNED_URL_TTL_S } from "@/lib/storage-url";

type Keyed = { id: string; created_at: string };

/** Chronological order with the id as tie-breaker, the same keyset the server pages on. */
export function compareMessages(a: Keyed, b: Keyed) {
  const t = Date.parse(a.created_at) - Date.parse(b.created_at);
  if (t !== 0) return t;
  // Postgres timestamps carry microseconds that Date drops: compare the raw strings next.
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Merges messages by id into a chronological list. An incoming row replaces the one with the same
 * id (an UPDATE, e.g. a deletion placeholder) but keeps the embedded sender the list already had.
 * Returns the same array when nothing changed.
 */
export function mergeMessages<T extends Keyed & { sender?: unknown }>(list: T[], incoming: T[]): T[] {
  if (incoming.length === 0) return list;
  const byId = new Map(list.map((m) => [m.id, m]));
  let changed = false;
  for (const m of incoming) {
    const cur = byId.get(m.id);
    if (cur && JSON.stringify({ ...cur, sender: null }) === JSON.stringify({ ...m, sender: null })) continue;
    byId.set(m.id, cur ? { ...cur, ...m, sender: m.sender ?? cur.sender } : m);
    changed = true;
  }
  return changed ? [...byId.values()].sort(compareMessages) : list;
}

/**
 * Index of the message the "New messages" divider goes above: the first message from someone else
 * newer than the marker that isn't deleted. -1 when there is none (or no marker).
 */
export function dividerIndex(
  list: (Keyed & { sender_id: string; deleted_at?: string | null })[],
  lastReadAt: string | null | undefined,
  userId: string,
) {
  if (!lastReadAt) return -1;
  const mark = Date.parse(lastReadAt);
  return list.findIndex((m) => m.sender_id !== userId && !m.deleted_at && Date.parse(m.created_at) > mark);
}

/** Badge text: nothing for 0, the number up to 99, then "99+" (the server caps the count at 100). */
export function badgeText(count: number | null | undefined) {
  if (!count || count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}

/** Pipeline (lib/image.ts) + upload to the private chat bucket. Returns the object path. */
export async function uploadChatImage(supabase: BoolaaClient, userId: string, file: Blob) {
  const jpeg = await prepareImage(file, CHAT_BUCKET);
  const path = `${userId}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from(CHAT_BUCKET).upload(path, jpeg, { contentType: "image/jpeg", upsert: false });
  if (error) throw error;
  return path;
}

/** Best-effort removal of a chat photo (after deleting its message, or a failed send). */
export async function removeChatImage(supabase: BoolaaClient, path: string | null | undefined) {
  if (!path) return;
  await supabase.storage.from(CHAT_BUCKET).remove([path]);
}
