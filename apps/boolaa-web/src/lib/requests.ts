/**
 * "I want it" requests on food posts and market items (docs/boolaa-spec.md, "Requests and picking"):
 * row types, merging and what each person sees. Pure; the hook lives in components/requests.tsx.
 */
import { AUTHOR, type Author, type Row } from "@/lib/types";

export type ItemKind = "food" | "market";
export type RequestStatus = "pending" | "picked" | "received" | "missed";
export type ItemRequest = Row<"item_requests"> & { requester: Author | null };

export const REQUEST_SELECT = `*, requester:users!requester_id(${AUTHOR})`;
export const NOTE_MAX = 200;

/** Trimmed, whitespace collapsed, at most 200 characters; null when empty (the server does the same). */
export function cleanNote(note: string): string | null {
  const s = note.replace(/\s+/g, " ").trim().slice(0, NOTE_MAX);
  return s || null;
}

/** Inserts or replaces by id, keeping the joined requester when the change payload lacks it. */
export function upsertRequest(rows: ItemRequest[], row: Row<"item_requests"> & { requester?: Author | null }): ItemRequest[] {
  const i = rows.findIndex((r) => r.id === row.id);
  if (i < 0) return [...rows, { requester: null, ...row }];
  const merged = { ...rows[i], ...row, requester: row.requester ?? rows[i].requester };
  if (JSON.stringify(merged) === JSON.stringify(rows[i])) return rows;
  const next = rows.slice();
  next[i] = merged;
  return next;
}

export function removeRequest(rows: ItemRequest[], id: string): ItemRequest[] {
  return rows.some((r) => r.id === id) ? rows.filter((r) => r.id !== id) : rows;
}

const byOldest = (a: ItemRequest, b: ItemRequest) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

/** The current pick (or winner, once handed over) of an item. */
export const pickOf = (rows: readonly ItemRequest[], itemId: string) =>
  rows.find((r) => r.item_id === itemId && (r.status === "picked" || r.status === "received")) ?? null;

/** The owner's sheet: open requests oldest first (first come, first served), the pick pinned on top. */
export function ownerRows(rows: readonly ItemRequest[], itemId: string): ItemRequest[] {
  const open = rows.filter((r) => r.item_id === itemId && (r.status === "pending" || r.status === "picked")).sort(byOldest);
  const pick = open.find((r) => r.status === "picked");
  return pick ? [pick, ...open.filter((r) => r !== pick)] : open;
}

export const myRequest = (rows: readonly ItemRequest[], itemId: string, userId: string) =>
  rows.find((r) => r.item_id === itemId && r.requester_id === userId) ?? null;

/**
 * What a member who isn't the owner sees in the card's action row:
 * - `ask`: "I want it"; `none`: nothing (reserved for someone else, no request of mine)
 * - `pending` / `onList`: "Requested" (or "Reserved · you're on the list") + "Withdraw request"
 * - `picked`: "Reserved for you" + "Withdraw request" (with a confirmation)
 * - `received`: "It's yours"; `missed`: "Someone else got it"
 */
export type RequesterState = "ask" | "none" | "pending" | "onList" | "picked" | "received" | "missed";

export function requesterState(availability: string, mine: Pick<ItemRequest, "status"> | null): RequesterState {
  if (mine?.status === "received") return "received";
  if (mine?.status === "missed") return "missed";
  if (availability === "taken") return "none";
  if (mine?.status === "picked") return "picked";
  if (mine?.status === "pending") return availability === "reserved" ? "onList" : "pending";
  return availability === "reserved" ? "none" : "ask"; // unknown values read as available
}
