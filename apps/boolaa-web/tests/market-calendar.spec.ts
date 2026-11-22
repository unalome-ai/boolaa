import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { availabilityOf, canAskOwner, visibleItems } from "../src/lib/market";
import { SUPABASE_URL, apiUser, deleteUsers, login, selectBubble, serviceRoleKey, throwaway } from "./helpers";

// Marketplace availability + "Ask in chat", and "Add to calendar" for events
// (migration 20261123170000_market_status_calendar.sql, docs/boolaa-spec.md). Throwaway users and
// a throwaway bubble only.

const RUN = Date.now().toString(36);
const ANA = throwaway("MktAna", RUN);
const BEN = throwaway("MktBen", RUN);

test.afterAll(async () => {
  const key = serviceRoleKey();
  if (key) await deleteUsers(key, [ANA.email, BEN.email]);
});

test("helpers: taken items sink, can be hidden, and are never asked about; own items never", () => {
  const it = (id: string, created_at: string, availability: string, status = "free", owner_id = "u1") => ({ id, created_at, availability, status, owner_id });
  const items = [
    it("a", "2026-11-01T00:00:00Z", "taken"),
    it("b", "2026-11-03T00:00:00Z", "available"),
    it("c", "2026-11-02T00:00:00Z", "reserved", "trade"),
    it("d", "2026-11-04T00:00:00Z", "taken", "trade", "u2"),
    it("e", "2026-11-05T00:00:00Z", "available", "free", "blocked"),
  ];
  expect(visibleItems(items, { filter: "all", hideTaken: false, blocked: new Set(["blocked"]) }).map((i) => i.id)).toEqual(["b", "c", "d", "a"]);
  expect(visibleItems(items, { filter: "all", hideTaken: true }).map((i) => i.id)).toEqual(["e", "b", "c"]);
  expect(visibleItems(items, { filter: "trade", hideTaken: false }).map((i) => i.id)).toEqual(["c", "d"]);
  expect(availabilityOf({ availability: "sold" })).toBe("available");
  expect(canAskOwner(items[1], "u2")).toBe(true); // someone else's, available
  expect(canAskOwner(items[2], "u2")).toBe(true); // reserved: you can still ask
  expect(canAskOwner(items[0], "u2")).toBe(false); // taken
  expect(canAskOwner(items[1], "u1")).toBe(false); // your own
});

const nav = (page: Page, key: string) => page.getByTestId("sidebar").getByTestId(`nav-${key}`).click();

test("availability badges arrive live, taken sinks and hides, Ask in chat prefills, owner changes status", async ({ browser }) => {
  test.setTimeout(120_000);
  test.skip(!serviceRoleKey(), "needs the local service-role key");
  const ana = await apiUser(ANA);
  const ben = await apiUser(BEN);
  const { data: bubble, error } = await ana.sb.rpc("create_bubble", { p_name: `Market ${RUN}` });
  expect(error).toBeNull();
  const { data: req } = await ben.sb.rpc("request_to_join", { p_invite_code: bubble!.invite_code });
  expect((await ana.sb.rpc("approve_join_request", { p_request_id: req!.id })).data).toBe(true);

  const img = (uid: string) => `${SUPABASE_URL}/storage/v1/object/public/market.images/${uid}/e2e-${RUN}.png`;
  const add = async (who: typeof ana, title: string) => {
    const r = await who.sb.from("market_items").insert({ bubble_id: bubble!.id, owner_id: who.id, image: img(who.id), title }).select("id").single();
    expect(r.error).toBeNull();
    return r.data!.id;
  };
  const lamp = await add(ana, `Lamp ${RUN}`);
  const bike = await add(ana, `Bike ${RUN}`); // newest
  await add(ben, `Kettle ${RUN}`);

  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, BEN.email);
  await selectBubble(page, bubble!.name);
  await nav(page, "marketplace");
  const grid = page.locator("main").getByTestId("market-item").filter({ visible: true });
  const card = (title: string) => grid.filter({ hasText: title });
  await expect(card(`Lamp ${RUN}`)).toBeVisible();
  await expect(card(`Lamp ${RUN}`).getByTestId("availability-badge")).toHaveCount(0);
  await expect(card(`Lamp ${RUN}`).getByTestId("ask-owner")).toBeVisible();
  // Own item: a status picker, no "Ask in chat".
  await expect(card(`Kettle ${RUN}`).getByTestId("ask-owner")).toHaveCount(0);
  await expect(card(`Kettle ${RUN}`).getByTestId("availability-select")).toBeVisible();
  // Ana's items: no picker for Ben.
  await expect(card(`Bike ${RUN}`).getByTestId("availability-select")).toHaveCount(0);

  // Ana reserves the lamp and gives the bike away: both arrive live.
  expect((await ana.sb.from("market_items").update({ availability: "reserved" }).eq("id", lamp)).error).toBeNull();
  expect((await ana.sb.from("market_items").update({ availability: "taken" }).eq("id", bike)).error).toBeNull();
  await expect(card(`Lamp ${RUN}`).getByTestId("availability-badge")).toHaveAttribute("data-availability", "reserved");
  await expect(card(`Bike ${RUN}`).getByTestId("availability-badge")).toHaveAttribute("data-availability", "taken");
  await expect(card(`Bike ${RUN}`).getByTestId("ask-owner")).toHaveCount(0);
  await expect(card(`Lamp ${RUN}`).getByTestId("ask-owner")).toBeVisible(); // reserved: still askable
  // Taken sinks to the bottom even though it's the newest.
  await expect(grid.last()).toContainText(`Bike ${RUN}`);
  await page.getByTestId("filter-hide-taken").click();
  await expect(card(`Bike ${RUN}`)).toHaveCount(0);
  await expect(card(`Lamp ${RUN}`)).toBeVisible();
  await page.getByTestId("filter-hide-taken").click();
  await expect(card(`Bike ${RUN}`)).toBeVisible();

  // Ben marks his own kettle as taken through the UI; the server has it.
  await card(`Kettle ${RUN}`).getByTestId("availability-select").selectOption("taken");
  await expect(card(`Kettle ${RUN}`).getByTestId("availability-badge")).toHaveAttribute("data-availability", "taken");
  await expect
    .poll(async () => (await ben.sb.from("market_items").select("availability").eq("title", `Kettle ${RUN}`).single()).data?.availability)
    .toBe("taken");
  // A non-owner write changes nothing (RLS).
  await ben.sb.from("market_items").update({ availability: "available" }).eq("id", bike);
  expect((await ana.sb.from("market_items").select("availability").eq("id", bike).single()).data?.availability).toBe("taken");

  // "Ask in chat": the bubble chat opens with an unsent message to Ana about the lamp.
  await card(`Lamp ${RUN}`).getByTestId("ask-owner").click();
  await expect(page).toHaveURL(/\/chat$/);
  const input = page.locator("main").getByTestId("chat-input").filter({ visible: true });
  await expect(input).toHaveValue(`@${ANA.name}, is “Lamp ${RUN}” still available?`);
  await expect(input).toBeFocused();
  // Nothing was sent.
  expect((await ana.sb.from("chat_messages").select("id").eq("bubble_id", bubble!.id)).data).toEqual([]);
  await context.close();
});

test("Add to calendar downloads a valid .ics for the event", async ({ browser }) => {
  test.setTimeout(90_000);
  test.skip(!serviceRoleKey(), "needs the local service-role key");
  const ana = await apiUser(ANA);
  const { data: bubble, error } = await ana.sb.rpc("create_bubble", { p_name: `Cal ${RUN}` });
  expect(error).toBeNull();
  const title = `Board games; pizza, ${RUN}`;
  const ev = await ana.sb
    .from("events")
    .insert({ bubble_id: bubble!.id, creator_id: ana.id, title, datetime: "2030-06-15T16:30:00Z", location: "Str. Lungă 5, Brașov", description: "Bring snacks\nand dice" })
    .select("id")
    .single();
  expect(ev.error).toBeNull();

  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, ANA.email);
  await selectBubble(page, bubble!.name);
  await nav(page, "events");
  const cardEl = page.locator("main").getByTestId("event-card").filter({ visible: true }).filter({ hasText: title });
  const [download] = await Promise.all([page.waitForEvent("download"), cardEl.getByTestId("add-to-calendar").click()]);
  expect(download.suggestedFilename()).toBe(`Board games; pizza, ${RUN}.ics`);
  const ics = readFileSync((await download.path())!, "utf8");
  const lines = ics.replace(/\r\n /g, "").split("\r\n");
  expect(lines[0]).toBe("BEGIN:VCALENDAR");
  expect(lines).toContain(`UID:${ev.data!.id}@boolaa.ro`);
  expect(lines).toContain("DTSTART:20300615T163000Z");
  expect(lines).toContain("DTEND:20300615T173000Z");
  expect(lines).toContain(`SUMMARY:Board games\\; pizza\\, ${RUN}`);
  expect(lines).toContain("LOCATION:Str. Lungă 5\\, Brașov");
  expect(lines).toContain("DESCRIPTION:Bring snacks\\nand dice");
  expect(lines.some((l) => l.startsWith("DTSTAMP:"))).toBe(true);
  await context.close();
});
