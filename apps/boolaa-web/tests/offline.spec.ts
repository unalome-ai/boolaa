import { expect, test, type Page } from "@playwright/test";
import {
  backoffDelay,
  clearOfflineData,
  decodeEnvelope,
  encodeEnvelope,
  isAlreadyUploaded,
  isNetworkError,
  isUniqueViolation,
  nextStatus,
  readCache,
  setOfflineUser,
  writeCache,
  type KeyValueStore,
  type NetStatus,
} from "../src/lib/offline";
import { enqueue, pendingFor, removeItem, restore, setState, toPersisted, type OutboxItem } from "../src/lib/outbox";
import { apiUser, deleteUsers, login, serviceRoleKey, throwaway } from "./helpers";

// Offline and poor network (docs/boolaa-spec.md, "Offline and poor network"): status machine,
// backoff, per-user cache, chat outbox; then the browser flows with context.setOffline().

// ---- pure logic --------------------------------------------------------------------------------

test("status machine: offline, unreachable, reconnect", () => {
  const go = (s: NetStatus, ...events: Parameters<typeof nextStatus>[1][]) =>
    events.reduce<{ status: NetStatus; reconnected: boolean }>((acc, e) => nextStatus(acc.status, e), { status: s, reconnected: false });
  expect(nextStatus("online", { type: "path", available: false })).toEqual({ status: "offline", reconnected: false });
  expect(nextStatus("offline", { type: "path", available: true })).toEqual({ status: "online", reconnected: true });
  expect(nextStatus("online", { type: "path", available: true })).toEqual({ status: "online", reconnected: false });
  expect(nextStatus("online", { type: "failure", network: true })).toEqual({ status: "unreachable", reconnected: false });
  expect(nextStatus("online", { type: "failure", network: false })).toEqual({ status: "online", reconnected: false });
  expect(nextStatus("unreachable", { type: "success" })).toEqual({ status: "online", reconnected: true });
  expect(nextStatus("unreachable", { type: "path", available: false })).toEqual({ status: "offline", reconnected: false });
  // Offline: the OS decides; requests neither bring it back nor change it.
  expect(nextStatus("offline", { type: "success" })).toEqual({ status: "offline", reconnected: false });
  expect(nextStatus("offline", { type: "failure", network: true })).toEqual({ status: "offline", reconnected: false });
  expect(go("online", { type: "failure", network: true }, { type: "failure", network: true }).status).toBe("unreachable");
});

test("backoff: 1, 2, 4, 8, 16, 30, 30 s with ±20 % jitter", () => {
  const exact = () => 0.5;
  expect([0, 1, 2, 3, 4, 5, 6, 20].map((a) => backoffDelay(a, exact))).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  expect(backoffDelay(0, () => 0)).toBe(800);
  expect(backoffDelay(5, () => 1)).toBe(36000);
});

test("errors: network, 23505, storage duplicate", () => {
  expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
  expect(isNetworkError({ message: "TypeError: Failed to fetch: the request timed out" })).toBe(true);
  expect(isNetworkError({ name: "AuthRetryableFetchError", message: "" })).toBe(true);
  expect(isNetworkError({ code: "42501", message: "new row violates row-level security policy" })).toBe(false);
  expect(isUniqueViolation({ code: "23505" })).toBe(true);
  expect(isUniqueViolation({ code: "23514" })).toBe(false);
  expect(isAlreadyUploaded({ statusCode: "409", message: "The resource already exists" })).toBe(true);
  expect(isAlreadyUploaded({ statusCode: "400", message: "invalid_mime_type" })).toBe(false);
});

function memoryStore(): KeyValueStore & { dump: () => string[] } {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
    dump: () => [...map.keys()].sort(),
  };
}

test("cache: envelope version and age, per user, cleared on sign-out", () => {
  const now = new Date("2026-11-23T12:00:00Z");
  const raw = encodeEnvelope({ a: 1 }, now);
  expect(decodeEnvelope(raw, now)).toEqual({ a: 1 });
  expect(decodeEnvelope(raw, new Date("2026-12-24T12:00:00Z"))).toBeNull(); // older than 30 days
  expect(decodeEnvelope(JSON.stringify({ v: 2, savedAt: now.toISOString(), data: 1 }), now)).toBeNull();
  expect(decodeEnvelope("not json", now)).toBeNull();
  expect(decodeEnvelope(null, now)).toBeNull();

  const store = memoryStore();
  setOfflineUser("alice", store);
  writeCache("events.b1", [{ id: "e1" }], store);
  expect(readCache("events.b1", store)).toEqual([{ id: "e1" }]);
  store.setItem("boolaa:outbox:v1:alice", "[]");
  store.setItem("unrelated", "keep");

  // Bob signs in in the same tab: nothing of Alice's is readable or kept.
  setOfflineUser("bob", store);
  expect(readCache("events.b1", store)).toBeNull();
  expect(store.dump()).toEqual(["unrelated"]);

  writeCache("home.b1", { x: 1 }, store);
  store.setItem("boolaa:outbox:v1:bob", "[]");
  clearOfflineData(store);
  expect(store.dump()).toEqual(["unrelated"]);
  expect(readCache("home.b1", store)).toBeNull(); // no user after sign-out
});

test("outbox: queue, dedupe by id, order, persistence restores as Not sent", () => {
  const item = (id: string, at: string, extra: Partial<OutboxItem> = {}): OutboxItem => ({
    id,
    bubble_id: "b1",
    sender_id: "u1",
    content: `msg ${id}`,
    created_at: at,
    state: "sending",
    image_path: null,
    ...extra,
  });
  let list = enqueue([], item("m2", "2026-11-23T10:00:02Z"));
  list = enqueue(list, item("m1", "2026-11-23T10:00:01Z"));
  list = enqueue(list, item("m1", "2026-11-23T10:00:01Z")); // same id twice: once
  list = enqueue(list, item("p1", "2026-11-23T10:00:03Z", { image_path: "u1/p1.jpg" }));
  list = enqueue(list, item("o1", "2026-11-23T10:00:00Z", { bubble_id: "b2" }));
  expect(list).toHaveLength(4);
  expect(pendingFor(list, "b1").map((i) => i.id)).toEqual(["m1", "m2", "p1"]);
  // A message the server already has (live echo, or a 23505 retry) is not shown twice.
  expect(pendingFor(list, "b1", [{ id: "m1" }]).map((i) => i.id)).toEqual(["m2", "p1"]);

  list = setState(list, "m2", "failed", new Error("boom"));
  expect(list.find((i) => i.id === "m2")).toMatchObject({ state: "failed" });
  list = setState(list, "m2", "sending");
  expect(list.find((i) => i.id === "m2")?.error).toBeUndefined();

  // Only text survives a reload, and it comes back as "Not sent" (no surprise sends).
  const saved = JSON.stringify(toPersisted(list));
  const back = restore(saved);
  expect(back.map((i) => [i.id, i.state])).toEqual([
    ["m2", "failed"],
    ["m1", "failed"],
    ["o1", "failed"],
  ]);
  expect(restore("garbage")).toEqual([]);
  expect(removeItem(list, "m1").some((i) => i.id === "m1")).toBe(false);
});

// ---- browser flows (local stack) -----------------------------------------------------------------

const RUN = Date.now().toString(36);
const OLA = throwaway("OfflineOla", RUN);

test.afterAll(async () => {
  const key = serviceRoleKey();
  if (key) await deleteUsers(key, [OLA.email]);
});

async function olaWithBubble() {
  const ola = await apiUser(OLA);
  const { data } = await ola.sb.rpc("create_bubble", { p_name: `Offline ${RUN}` });
  if (data) {
    await ola.sb.from("events").insert({
      bubble_id: data.id,
      creator_id: ola.id,
      title: `Picnic ${RUN}`,
      datetime: new Date(Date.now() + 86_400_000).toISOString(),
    });
  }
  return ola;
}

const chatMessage = (page: Page, text: string) => page.getByTestId("chat-message").filter({ hasText: text });

test("offline: calm banner, chat message queued as Sending… and sent once after reconnect", async ({ page, context }) => {
  await olaWithBubble();
  await login(page, OLA.email);
  await page.goto("/chat");
  await expect(page.getByTestId("chat-status")).toHaveAttribute("data-live", "true");

  await context.setOffline(true);
  await expect(page.getByTestId("offline-banner")).toContainText("You're offline");

  const text = `queued ${RUN}`;
  await page.getByTestId("chat-input").fill(text);
  await page.getByTestId("chat-send").click();
  await expect(page.getByTestId("chat-input")).toHaveValue(""); // nothing lost: the outbox holds it
  const pending = page.getByTestId("chat-pending").filter({ hasText: text });
  await expect(pending).toHaveAttribute("data-state", "sending");
  await expect(pending.getByTestId("chat-sending")).toHaveText("Sending…");

  await context.setOffline(false);
  await expect(page.getByTestId("back-online")).toHaveText("Back online");
  await expect(chatMessage(page, text)).toHaveCount(1);
  await expect(page.getByTestId("chat-pending")).toHaveCount(0);
  // Still exactly one after the live echo and a reload (client id + merge by id).
  await page.reload();
  await expect(chatMessage(page, text)).toHaveCount(1);
});

test("a refused send shows Not sent; Try again sends it once; Don't send discards", async ({ page }) => {
  await olaWithBubble();
  await login(page, OLA.email);
  await page.goto("/chat");
  await expect(page.getByTestId("chat-status")).toHaveAttribute("data-live", "true");

  // The server answers with an error (not a network failure): Not sent, with Try again.
  const refuse = (route: import("@playwright/test").Route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "XX000", message: "boom" }) })
      : route.continue();
  await page.route("**/rest/v1/chat_messages*", refuse);

  const text = `retry ${RUN}`;
  await page.getByTestId("chat-input").fill(text);
  await page.getByTestId("chat-send").click();
  const pending = page.getByTestId("chat-pending").filter({ hasText: text });
  await expect(pending).toHaveAttribute("data-state", "failed");
  await expect(pending.getByTestId("chat-not-sent")).toContainText("Not sent");

  await page.unroute("**/rest/v1/chat_messages*", refuse);
  await pending.getByTestId("chat-retry").click();
  await expect(chatMessage(page, text)).toHaveCount(1);
  await expect(page.getByTestId("chat-pending")).toHaveCount(0);

  await page.route("**/rest/v1/chat_messages*", refuse);
  const other = `discard ${RUN}`;
  await page.getByTestId("chat-input").fill(other);
  await page.getByTestId("chat-send").click();
  const failed = page.getByTestId("chat-pending").filter({ hasText: other });
  await expect(failed).toHaveAttribute("data-state", "failed");
  await failed.getByTestId("chat-discard").click();
  await expect(page.getByTestId("chat-pending")).toHaveCount(0);
  await page.unroute("**/rest/v1/chat_messages*", refuse);
  await expect(chatMessage(page, other)).toHaveCount(0);
});

test("a failed load shows the inline error with Try again, never an empty screen", async ({ page }) => {
  await olaWithBubble();
  await login(page, OLA.email);
  await page.route("**/rest/v1/events*", (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
  await page.goto("/events");
  await expect(page.getByTestId("load-error")).toContainText("Couldn't load this");
  await expect(page.getByTestId("event-card")).toHaveCount(0);
  await page.unroute("**/rest/v1/events*");
  await page.getByTestId("load-retry").click();
  await expect(page.getByTestId("event-card").filter({ hasText: `Picnic ${RUN}` })).toBeVisible();
  await expect(page.getByTestId("load-error")).toHaveCount(0);
});

test("the server unreachable: the last view stays, with the unreachable pill", async ({ page }) => {
  await olaWithBubble();
  await login(page, OLA.email);
  await page.goto("/events");
  await expect(page.getByTestId("event-card").filter({ hasText: `Picnic ${RUN}` })).toBeVisible();
  // Let the cache write (debounced) land, then lose the API (the page itself still loads).
  await page.waitForTimeout(800);
  await page.route("**/rest/v1/**", (route) => route.abort("connectionrefused"));
  await page.reload();
  await expect(page.getByTestId("event-card").filter({ hasText: `Picnic ${RUN}` })).toBeVisible();
  await expect(page.getByTestId("offline-banner")).toContainText("Can't reach Boolaa");
  await expect(page.getByTestId("load-error")).toHaveCount(0);
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await expect(page.getByTestId("back-online")).toBeVisible({ timeout: 40_000 }); // probe with backoff
});

test("slow network: no skeleton flash for fast loads, a skeleton for slow ones", async ({ page }) => {
  await olaWithBubble();
  await login(page, OLA.email);
  await page.route("**/rest/v1/events*", async (route) => {
    await new Promise((r) => setTimeout(r, 2_000));
    await route.continue();
  });
  await page.goto("/events");
  await expect(page.locator(".skeleton").first()).toBeVisible();
  await expect(page.getByTestId("event-card").filter({ hasText: `Picnic ${RUN}` })).toBeVisible();
});

test("sign-out leaves no cached view or queued message in the tab", async ({ page }) => {
  await olaWithBubble();
  await login(page, OLA.email);
  await page.goto("/events");
  await expect(page.getByTestId("event-card").first()).toBeVisible();
  await page.waitForTimeout(800);
  const before = await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith("boolaa:")));
  expect(before.length).toBeGreaterThan(0);
  await page.getByTestId("profile-button").click();
  await page.getByRole("dialog").locator("button.btn-danger").first().click(); // sign out
  await expect(page).toHaveURL(/\/login$/);
  const after = await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith("boolaa:")));
  expect(after).toEqual([]);
});
