import { expect, test } from "@playwright/test";
import { byCreatedDesc, byDatetimeAsc, removeRow, upsertRow } from "../src/lib/live-feed";

// Pure merge rules for live feeds (same cases as the iOS and Android unit tests).
type R = { id: string; created_at: string; title: string; author?: { name: string } | null };
const a: R = { id: "a", created_at: "2026-01-03T00:00:00Z", title: "A", author: { name: "Alice" } };
const b: R = { id: "b", created_at: "2026-01-01T00:00:00Z", title: "B", author: { name: "Bob" } };

test("insert keeps newest-first order; null list (still loading) stays null", () => {
  const c: R = { id: "c", created_at: "2026-01-02T00:00:00Z", title: "C" };
  expect(upsertRow([a, b], c, byCreatedDesc)!.map((r) => r.id)).toEqual(["a", "c", "b"]);
  expect(upsertRow(null, c, byCreatedDesc)).toBeNull();
});

test("echo of our own write is a no-op (same array, no re-render)", () => {
  const rows = [a, b];
  expect(upsertRow(rows, { ...a }, byCreatedDesc)).toBe(rows);
  expect(upsertRow(rows, { id: "a", created_at: a.created_at, title: "A" } as R, byCreatedDesc)).toBe(rows);
});

test("update replaces fields but keeps the joined author", () => {
  const out = upsertRow([a, b], { id: "b", created_at: b.created_at, title: "B2" } as R, byCreatedDesc)!;
  expect(out[1]).toEqual({ ...b, title: "B2" });
});

test("update re-sorts events by datetime", () => {
  const e1 = { id: "1", datetime: "2026-05-01T10:00:00+00:00" };
  const e2 = { id: "2", datetime: "2026-05-02T10:00:00.000Z" };
  expect(upsertRow([e1, e2], { id: "1", datetime: "2026-05-03T10:00:00+00:00" }, byDatetimeAsc)!.map((e) => e.id)).toEqual(["2", "1"]);
});

test("delete by id; unknown ids (other bubbles) leave the list untouched", () => {
  const rows = [a, b];
  expect(removeRow(rows, "a")).toEqual([b]);
  expect(removeRow(rows, "zzz")).toBe(rows);
  expect(removeRow(null, "a")).toBeNull();
});
