import type { MarketItem } from "@/lib/types";

/** market_items.availability (migration 20261123170000). Who an item is reserved for is not stored. */
export const AVAILABILITIES = ["available", "reserved", "taken"] as const;
export type Availability = (typeof AVAILABILITIES)[number];

type Item = Pick<MarketItem, "id" | "owner_id" | "status" | "availability" | "created_at">;

/** Unknown or missing values (older rows, newer servers) read as "available". */
export const availabilityOf = (item: Pick<Item, "availability">): Availability =>
  (AVAILABILITIES as readonly string[]).includes(item.availability) ? (item.availability as Availability) : "available";

/** Taken items sink to the bottom; otherwise newest first (same tie-break as the live feed). */
export function byAvailabilityThenNewest(a: Item, b: Item) {
  const ta = availabilityOf(a) === "taken" ? 1 : 0;
  const tb = availabilityOf(b) === "taken" ? 1 : 0;
  if (ta !== tb) return ta - tb;
  return b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);
}

/** What the grid shows: Free/Trade filter, optional "Hide taken", blocked owners out, taken last. */
export function visibleItems<T extends Item>(
  items: T[],
  opts: { filter: "all" | "free" | "trade"; hideTaken: boolean; blocked?: Set<string> },
): T[] {
  return items
    .filter((i) => (opts.filter === "all" || i.status === opts.filter) && !(opts.hideTaken && availabilityOf(i) === "taken") && !opts.blocked?.has(i.owner_id))
    .sort(byAvailabilityThenNewest);
}

/** "Ask in chat" is offered on other members' items that aren't taken; never on your own. */
export const canAskOwner = (item: Pick<Item, "owner_id" | "availability">, userId: string) =>
  item.owner_id !== userId && availabilityOf(item) !== "taken";
