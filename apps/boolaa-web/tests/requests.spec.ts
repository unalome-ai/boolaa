import path from "node:path";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, test, type Page } from "@playwright/test";
import {
  customBounds,
  customDefault,
  customValid,
  expiryLabel,
  foodVisible,
  fromLocalInput,
  nextExpiry,
  presetFor,
  presetValue,
  toLocalInput,
  todayDisabled,
} from "../src/lib/food-expiry";
import { cleanNote, ownerRows, pickOf, requesterState, upsertRequest, type ItemRequest } from "../src/lib/requests";
import { errorKey } from "../src/i18n/errors";
import { SUPABASE_URL, apiUser, deleteUsers, login, selectBubble, serviceRoleKey, throwaway } from "./helpers";

// "I want it" requests, owner picks and food expiry (docs/boolaa-spec.md, "Food expiry", "Requests and
// picking"; migration 20261124100000_requests_food_expiry.sql). Throwaway users and bubbles only.

const RUN = Date.now().toString(36);
const ANA = throwaway("ReqAna", RUN);
const BEN = throwaway("ReqBen", RUN);
const CAT = throwaway("ReqCat", RUN);
const FIXTURE = path.join(__dirname, "fixtures", "item.png");

test.afterAll(async () => {
  const key = serviceRoleKey();
  if (key) await deleteUsers(key, [ANA.email, BEN.email, CAT.email]);
});

// ---- Pure logic ---------------------------------------------------------------------------------

test("expiry: presets, custom bounds, edit preselection, card label, visibility", () => {
  const now = new Date(2026, 10, 24, 14, 30); // Tue 24 Nov 2026, 14:30 local
  expect(presetValue("today", now)).toEqual(new Date(2026, 10, 24, 23, 59));
  expect(presetValue("tomorrow", now)).toEqual(new Date(2026, 10, 25, 23, 59));
  expect(presetValue("in3days", now)).toEqual(new Date(2026, 10, 27, 23, 59));
  expect(todayDisabled(now)).toBe(false);
  expect(todayDisabled(new Date(2026, 10, 24, 23, 0))).toBe(true);
  // Custom: now + 15 min … now + 14 days − 5 min, default tomorrow 18:00.
  const b = customBounds(now);
  expect(b.min).toEqual(new Date(2026, 10, 24, 14, 45));
  expect(b.max).toEqual(new Date(2026, 11, 8, 14, 25));
  expect(customDefault(now)).toEqual(new Date(2026, 10, 25, 18, 0));
  expect(customValid(new Date(2026, 10, 24, 14, 40), now)).toBe(false);
  expect(customValid(new Date(2026, 10, 30, 9, 0), now)).toBe(true);
  expect(customValid(new Date(2026, 11, 9, 9, 0), now)).toBe(false);
  expect(customValid(null, now)).toBe(false);
  expect(fromLocalInput(toLocalInput(new Date(2026, 0, 2, 3, 4)))).toEqual(new Date(2026, 0, 2, 3, 4));
  expect(fromLocalInput("")).toBeNull();
  // Editing preselects the segment equal to the minute, else Custom.
  expect(presetFor(new Date(2026, 10, 25, 23, 59, 30), now)).toBe("tomorrow");
  expect(presetFor(new Date(2026, 10, 27, 23, 59), now)).toBe("in3days");
  expect(presetFor(new Date(2026, 10, 25, 18, 0), now)).toBe("custom");
  // Label: < 1 h minutes (at least 1), < 6 h hours (rounded down), then today / tomorrow / weekday / date.
  const at = (h: number, m = 0, d = 24) => new Date(2026, 10, d, h, m);
  expect(expiryLabel(at(14, 30, 24), now)).toBeNull();
  expect(expiryLabel(new Date(now.getTime() + 20_000), now)).toEqual({ kind: "minutes", count: 1 });
  expect(expiryLabel(at(15, 10), now)).toEqual({ kind: "minutes", count: 40 });
  expect(expiryLabel(at(20, 29), now)).toEqual({ kind: "hours", count: 5 });
  expect(expiryLabel(at(23, 0), now)?.kind).toBe("today");
  expect(expiryLabel(at(18, 0, 25), now)?.kind).toBe("tomorrow");
  expect(expiryLabel(at(18, 0, 30), now)?.kind).toBe("day");
  expect(expiryLabel(at(18, 0, 31), now)?.kind).toBe("date");
  // Never shown: taken, or expired.
  const t0 = now.getTime();
  expect(foodVisible({ availability: "available", expires_at: new Date(t0 + 1000).toISOString() }, t0)).toBe(true);
  expect(foodVisible({ availability: "reserved", expires_at: new Date(t0 + 1000).toISOString() }, t0)).toBe(true);
  expect(foodVisible({ availability: "taken", expires_at: new Date(t0 + 1000).toISOString() }, t0)).toBe(false);
  expect(foodVisible({ availability: "available", expires_at: new Date(t0).toISOString() }, t0)).toBe(false);
  expect(
    nextExpiry(
      [
        { availability: "available", expires_at: new Date(t0 + 5000).toISOString() },
        { availability: "available", expires_at: new Date(t0 + 2000).toISOString() },
        { availability: "available", expires_at: new Date(t0 - 2000).toISOString() },
      ],
      t0,
    ),
  ).toBe(t0 + 2000);
});

test("requests: note cleaning, owner order, requester states, merges, error mapping", () => {
  expect(cleanNote("  hi \n\n there  ")).toBe("hi there");
  expect(cleanNote("   ")).toBeNull();
  expect(cleanNote("x".repeat(250))).toHaveLength(200);
  const r = (id: string, requester_id: string, status: string, created_at: string, item_id = "i1") =>
    ({ id, requester_id, status, created_at, item_id, requester: null }) as unknown as ItemRequest;
  const rows = [r("a", "u1", "pending", "2026-11-24T10:00:00Z"), r("b", "u2", "picked", "2026-11-24T11:00:00Z"), r("c", "u3", "pending", "2026-11-24T09:00:00Z"), r("d", "u4", "pending", "2026-11-24T08:00:00Z", "i2")];
  // Oldest first, the pick pinned on top; other items' rows out.
  expect(ownerRows(rows, "i1").map((x) => x.id)).toEqual(["b", "c", "a"]);
  expect(pickOf(rows, "i1")?.id).toBe("b");
  expect(pickOf(rows, "i2")).toBeNull();
  // An UPDATE keeps the joined requester.
  const withName = { ...rows[0], requester: { id: "u1", name: "Ana", avatar: null } };
  const merged = upsertRequest([withName], { ...rows[0], status: "missed", requester: undefined } as never);
  expect(merged[0]).toMatchObject({ status: "missed", requester: { name: "Ana" } });
  expect(upsertRequest([withName], withName)).toEqual([withName]);
  // What the requester sees.
  expect(requesterState("available", null)).toBe("ask");
  expect(requesterState("sold", null)).toBe("ask"); // unknown reads as available
  expect(requesterState("reserved", null)).toBe("none");
  expect(requesterState("available", { status: "pending" })).toBe("pending");
  expect(requesterState("reserved", { status: "pending" })).toBe("onList");
  expect(requesterState("reserved", { status: "picked" })).toBe("picked");
  expect(requesterState("taken", { status: "received" })).toBe("received");
  expect(requesterState("taken", { status: "missed" })).toBe("missed");
  expect(requesterState("taken", null)).toBe("none");
  // Backend texts → glossary keys, before the generic fallback.
  const k = (message: string) => errorKey({ message, code: "P0001" });
  expect(k("item not found")).toBe("itemGone");
  expect(k("item not available")).toBe("itemNotAvailable");
  expect(k("already requested")).toBe("alreadyRequested");
  expect(k("cannot request own item")).toBe("cannotRequestOwn");
  expect(k("request note too long")).toBe("requestNoteTooLong");
  expect(k("item request gone")).toBe("requestGone");
  expect(k("request already decided")).toBe("requestDecided");
  expect(k("nothing picked")).toBe("nothingPicked");
  expect(k("invalid expiry")).toBe("invalidExpiry");
  expect(k("not your item")).toBe("generic");
  expect(k("invalid item kind")).toBe("generic");
  expect(k("request not found")).toBe("requestNotFound"); // older mapping unchanged
});

test("service worker: request pushes open the item, owner-side ones with the Requests sheet", () => {
  const code = readFileSync(path.join(__dirname, "..", "public", "sw.js"), "utf8");
  const self: Record<string, unknown> = { addEventListener: () => undefined, location: { origin: "http://x" } };
  vm.runInNewContext(code, { self, URL, console });
  const { targetUrl } = self.boolaaPush as { targetUrl: (d: object) => string };
  const d = (type: string, item_kind: string, url?: string) => ({ type, item_kind, bubble_id: "b1", target_id: "i1", url });
  expect(targetUrl(d("item_request", "food", "/food?bubble=b1&post=i1"))).toBe("/food?bubble=b1&post=i1&requests=i1");
  expect(targetUrl(d("item_request_withdrawn", "market"))).toBe("/marketplace?bubble=b1&item=i1&requests=i1");
  expect(targetUrl(d("item_picked", "market"))).toBe("/marketplace?bubble=b1&item=i1");
  expect(targetUrl(d("item_missed", "food"))).toBe("/food?bubble=b1&post=i1");
  expect(targetUrl(d("food", "", "/food?bubble=b1&post=i1"))).toBe("/food?bubble=b1&post=i1");
});

// ---- Flows against the local stack ----------------------------------------------------------------

const nav = (page: Page, key: string) => page.getByTestId("sidebar").getByTestId(`nav-${key}`).click();
const visible = (page: Page, testId: string) => page.locator("main").getByTestId(testId).filter({ visible: true });
const dialog = (page: Page) => page.getByRole("dialog").filter({ visible: true });

/** Ana owns a bubble with Ben and Cat as members. */
async function threeMembers(label: string) {
  const ana = await apiUser(ANA);
  const ben = await apiUser(BEN);
  const cat = await apiUser(CAT);
  const { data: bubble, error } = await ana.sb.rpc("create_bubble", { p_name: `${label} ${RUN}` });
  expect(error).toBeNull();
  const join = async (who: typeof ben, approvers: (typeof ana)[]) => {
    const { data: req, error } = await who.sb.rpc("request_to_join", { p_invite_code: bubble!.invite_code });
    expect(error).toBeNull();
    for (const a of approvers) await a.sb.rpc("approve_join_request", { p_request_id: req!.id });
  };
  await join(ben, [ana]);
  await join(cat, [ana, ben]);
  const { data: members } = await ana.sb.from("bubble_members").select("user_id").eq("bubble_id", bubble!.id).eq("approved", true);
  expect(members?.length).toBe(3);
  return { ana, ben, cat, bubble: bubble! };
}

test("market: I want it, owner picks in the sheet, withdraw with confirmation, hand over, Mark as keeps the pick consistent", async ({ browser }) => {
  test.setTimeout(180_000);
  test.skip(!serviceRoleKey(), "needs the local service-role key");
  const { ana, ben, cat, bubble } = await threeMembers("Req market");
  const img = (uid: string) => `${SUPABASE_URL}/storage/v1/object/public/market.images/${uid}/e2e-${RUN}.png`;
  const add = async (title: string) => {
    const r = await ana.sb.from("market_items").insert({ bubble_id: bubble.id, owner_id: ana.id, image: img(ana.id), title }).select("id").single();
    expect(r.error).toBeNull();
    return r.data!.id;
  };
  const sofa = await add(`Sofa ${RUN}`);
  const chair = await add(`Chair ${RUN}`);

  const benCtx = await browser.newContext();
  const benPage = await benCtx.newPage();
  await login(benPage, BEN.email);
  await selectBubble(benPage, bubble.name);
  await nav(benPage, "marketplace");
  const benCard = (title: string) => visible(benPage, "market-item").filter({ hasText: title });

  // Ben asks for the sofa with a note: the card switches at once, a toast confirms, Ana gets the row.
  await benCard(`Sofa ${RUN}`).getByTestId("i-want-it").click();
  await expect(dialog(benPage).getByTestId("request-note")).toBeFocused();
  await dialog(benPage).getByTestId("request-note").fill("Can pick up tonight");
  await expect(dialog(benPage)).toContainText("19/200");
  await dialog(benPage).getByTestId("send-request").click();
  await expect(benCard(`Sofa ${RUN}`).getByTestId("my-request")).toHaveAttribute("data-state", "pending");
  await expect(benPage.getByTestId("cheer")).toContainText(ANA.name);
  // The count arrives through the item feed: "1 request" for everyone.
  await expect(benCard(`Sofa ${RUN}`).getByTestId("request-count")).toHaveText(/1 request\b/);
  // Cat asks too (API).
  expect((await cat.sb.rpc("request_item", { p_kind: "market", p_item_id: sofa })).error).toBeNull();

  const anaCtx = await browser.newContext();
  const anaPage = await anaCtx.newPage();
  await login(anaPage, ANA.email);
  await selectBubble(anaPage, bubble.name);
  await nav(anaPage, "marketplace");
  const anaCard = (title: string) => visible(anaPage, "market-item").filter({ hasText: title });
  await expect(anaCard(`Sofa ${RUN}`).getByTestId("request-count")).toHaveText(/2 requests/);
  await expect(anaCard(`Chair ${RUN}`).getByTestId("no-requests")).toBeVisible();
  await anaCard(`Sofa ${RUN}`).getByTestId("open-requests").click();
  const rows = dialog(anaPage).getByTestId("request-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText(BEN.name); // first come, first served
  await expect(rows.first()).toContainText("Can pick up tonight");

  // Ana picks Ben: pinned on top with "Your pick"; Ben sees "Reserved for you" live; others see "Reserved".
  await rows.filter({ hasText: BEN.name }).getByTestId("pick").click();
  await expect(rows.first()).toHaveAttribute("data-status", "picked");
  await expect(rows.first().getByTestId("your-pick")).toBeVisible();
  await expect(rows.nth(1).getByTestId("pick")).toHaveText(/Pick instead/);
  await expect(anaPage.getByTestId("cheer")).toContainText(BEN.name);
  await anaPage.keyboard.press("Escape");
  await expect(anaCard(`Sofa ${RUN}`).getByTestId("availability-badge")).toContainText(BEN.name);
  await expect(benCard(`Sofa ${RUN}`).getByTestId("availability-badge")).toHaveText(/Reserved for you/i);
  expect((await cat.sb.from("item_requests").select("status, requester_id").eq("item_id", sofa)).data).toEqual([{ status: "pending", requester_id: cat.id }]);

  // Ben withdraws: asked first, then the sofa is available again for everyone.
  await benCard(`Sofa ${RUN}`).getByTestId("withdraw-request").click();
  await expect(dialog(benPage)).toContainText(ANA.name);
  await dialog(benPage).getByTestId("confirm-yes").click();
  await expect(benCard(`Sofa ${RUN}`).getByTestId("i-want-it")).toBeVisible();
  await expect(anaCard(`Sofa ${RUN}`).getByTestId("availability-badge")).toHaveCount(0);
  await expect(anaCard(`Sofa ${RUN}`).getByTestId("request-count")).toHaveText(/1 request\b/);

  // Ben asks again (no note); Ana picks Cat and hands over: Ben hears "Someone else got it" live.
  await benCard(`Sofa ${RUN}`).getByTestId("i-want-it").click();
  await dialog(benPage).getByTestId("send-request").click();
  await expect(benCard(`Sofa ${RUN}`).getByTestId("my-request")).toHaveAttribute("data-state", "pending");
  await expect(anaCard(`Sofa ${RUN}`).getByTestId("request-count")).toHaveText(/2 requests/);
  await anaCard(`Sofa ${RUN}`).getByTestId("request-count").click(); // the owner's pill opens the sheet too
  await rows.filter({ hasText: CAT.name }).getByTestId("pick").click();
  await expect(rows.first()).toContainText(CAT.name);
  await expect(benCard(`Sofa ${RUN}`).getByTestId("my-request")).toHaveAttribute("data-state", "onList");
  await rows.first().getByTestId("handover").click();
  await expect(dialog(anaPage).getByTestId("handover-confirm")).toContainText(`Sofa ${RUN}`);
  await dialog(anaPage).getByTestId("handover-yes").click();
  await expect(dialog(anaPage)).toHaveCount(0);
  await expect(anaCard(`Sofa ${RUN}`)).toHaveAttribute("data-availability", "taken");
  await expect(benCard(`Sofa ${RUN}`).getByTestId("my-request")).toHaveAttribute("data-state", "missed");
  await expect(benCard(`Sofa ${RUN}`).getByTestId("request-count")).toHaveCount(0);
  expect((await cat.sb.from("item_requests").select("status").eq("item_id", sofa).single()).data?.status).toBe("received");

  // Chair: Ben asks, Ana picks (API); "Mark as → Available" asks first and clears the pick only.
  const { data: chairReq } = await ben.sb.rpc("request_item", { p_kind: "market", p_item_id: chair });
  expect((await ana.sb.rpc("pick_item_request", { p_request_id: chairReq!.id })).error).toBeNull();
  await expect(benCard(`Chair ${RUN}`).getByTestId("availability-badge")).toHaveText(/Reserved for you/i);
  await expect(anaCard(`Chair ${RUN}`).getByTestId("availability-badge")).toContainText(BEN.name);
  await anaCard(`Chair ${RUN}`).getByTestId("availability-select").selectOption("available");
  await expect(dialog(anaPage)).toContainText(BEN.name);
  await dialog(anaPage).getByTestId("confirm-yes").click();
  await expect(benCard(`Chair ${RUN}`).getByTestId("my-request")).toHaveAttribute("data-state", "pending");
  await expect.poll(async () => (await ben.sb.from("item_requests").select("status").eq("id", chairReq!.id).single()).data?.status).toBe("pending");

  // Errors map to the glossary: asking twice.
  const again = await ben.sb.rpc("request_item", { p_kind: "market", p_item_id: chair });
  expect(errorKey(again.error)).toBe("alreadyRequested");
  await benCtx.close();
  await anaCtx.close();
});

test("food: Good until on create and edit, expiry label, second post opens empty, I want it, hand-over and expiry remove it live", async ({ browser }) => {
  test.setTimeout(240_000);
  test.skip(!serviceRoleKey(), "needs the local service-role key");
  const { ana, bubble } = await threeMembers("Req food");

  const anaCtx = await browser.newContext();
  const anaPage = await anaCtx.newPage();
  await login(anaPage, ANA.email);
  await selectBubble(anaPage, bubble.name);
  await nav(anaPage, "food");

  // Create with "In 3 days": stored as 23:59 local three days ahead.
  await visible(anaPage, "share-food").click();
  let form = dialog(anaPage);
  await expect(form.getByTestId("expiry-tomorrow")).toBeChecked(); // default
  await form.locator('input[type="file"]').first().setInputFiles(FIXTURE);
  await form.locator("#food-desc").fill(`Soup ${RUN}`);
  await form.getByText("In 3 days").click();
  await form.locator('button[type="submit"]').click();
  await expect(form).toHaveCount(0);
  const soup = (await ana.sb.from("food_posts").select("id, expires_at").eq("bubble_id", bubble.id).eq("description", `Soup ${RUN}`).single()).data!;
  const expected = presetValue("in3days", new Date());
  expect(new Date(soup.expires_at).getTime()).toBe(expected.getTime());
  const anaCard = (text: string) => visible(anaPage, "food-card").filter({ hasText: text });
  await expect(anaCard(`Soup ${RUN}`).getByTestId("food-expiry")).toHaveAttribute("data-kind", "day");
  await expect(anaCard(`Soup ${RUN}`).getByTestId("no-requests")).toBeVisible();

  // A second "Share food" opens an empty editor (same bug class as the iOS report), back on Tomorrow.
  await visible(anaPage, "share-food").click();
  form = dialog(anaPage);
  await expect(form.locator("#food-desc")).toHaveValue("");
  await expect(form.getByTestId("expiry-tomorrow")).toBeChecked();
  await expect(form.locator("img")).toHaveCount(0);
  await form.locator('input[type="file"]').first().setInputFiles(FIXTURE);
  await form.locator("#food-desc").fill(`Bread ${RUN}`);
  await form.locator('button[type="submit"]').click();
  await expect(form).toHaveCount(0);
  await expect(anaCard(`Bread ${RUN}`).getByTestId("food-expiry")).toHaveAttribute("data-kind", "tomorrow");

  // Edit preselects the stored value; leaving it alone doesn't send expires_at; Custom sends it.
  await anaCard(`Soup ${RUN}`).getByTestId("edit-post").click();
  form = dialog(anaPage);
  await expect(form.locator("#food-desc")).toHaveValue(`Soup ${RUN}`);
  await expect(form.getByTestId("expiry-in3days")).toBeChecked();
  await form.getByText("Custom").click();
  const custom = new Date(Date.now() + 2 * 3_600_000);
  custom.setSeconds(0, 0);
  await form.getByTestId("expiry-custom-input").fill(toLocalInput(custom));
  await form.locator('button[type="submit"]').click();
  await expect(form).toHaveCount(0);
  await expect.poll(async () => (await ana.sb.from("food_posts").select("expires_at").eq("id", soup.id).single()).data?.expires_at).toBe(custom.toISOString().replace(".000Z", "+00:00"));
  await expect(anaCard(`Soup ${RUN}`).getByTestId("food-expiry")).toHaveAttribute("data-kind", "hours");

  // Ben asks for the soup; Ana gets the count live; the push deep link opens her Requests sheet.
  const benCtx = await browser.newContext();
  const benPage = await benCtx.newPage();
  await login(benPage, BEN.email);
  await selectBubble(benPage, bubble.name);
  await nav(benPage, "food");
  const benCard = (text: string) => visible(benPage, "food-card").filter({ hasText: text });
  await benCard(`Soup ${RUN}`).getByTestId("i-want-it").click();
  await dialog(benPage).getByTestId("send-request").click();
  await expect(benCard(`Soup ${RUN}`).getByTestId("my-request")).toHaveAttribute("data-state", "pending");
  await expect(anaCard(`Soup ${RUN}`).getByTestId("open-requests")).toHaveText(/Requests · 1/);
  await anaPage.goto(`/food?bubble=${bubble.id}&post=${soup.id}&requests=${soup.id}`);
  await expect(dialog(anaPage).getByTestId("request-row")).toContainText(BEN.name);
  await expect(anaPage).not.toHaveURL(/requests=/);
  await dialog(anaPage).getByTestId("pick").click();
  await expect(benCard(`Soup ${RUN}`).getByTestId("availability-badge")).toHaveText(/Reserved for you/i);
  // Hand over: the post leaves both lists.
  await dialog(anaPage).getByTestId("handover").click();
  await expect(dialog(anaPage).getByTestId("handover-confirm")).toContainText(BEN.name);
  await dialog(anaPage).getByTestId("handover-yes").click();
  await expect(anaCard(`Soup ${RUN}`)).toHaveCount(0);
  await expect(benCard(`Soup ${RUN}`)).toHaveCount(0);
  await expect(benCard(`Bread ${RUN}`)).toBeVisible();

  // Expiry: a post expiring in ~70 s shows the urgent label, then leaves the open screen by itself.
  const soon = new Date(Date.now() + 70_000).toISOString();
  const { error } = await ana.sb
    .from("food_posts")
    .insert({ bubble_id: bubble.id, user_id: ana.id, image: `${SUPABASE_URL}/storage/v1/object/public/food.images/${ana.id}/e2e-${RUN}.png`, description: `Melon ${RUN}`, expires_at: soon });
  expect(error).toBeNull();
  await expect(benCard(`Melon ${RUN}`).getByTestId("food-expiry")).toHaveAttribute("data-kind", "minutes");
  await expect(benCard(`Melon ${RUN}`)).toHaveCount(0, { timeout: 100_000 });
  // An expiry beyond 14 days is refused with the glossary message.
  const far = await ana.sb.from("food_posts").update({ expires_at: new Date(Date.now() + 15 * 86_400_000).toISOString() }).eq("description", `Bread ${RUN}`);
  expect(errorKey(far.error)).toBe("invalidExpiry");
  await benCtx.close();
  await anaCtx.close();
});

test("market: a second New item opens an empty editor", async ({ browser }) => {
  test.setTimeout(90_000);
  test.skip(!serviceRoleKey(), "needs the local service-role key");
  const ana = await apiUser(ANA);
  const { data: bubble } = await ana.sb.rpc("create_bubble", { p_name: `Req new ${RUN}` });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, ANA.email);
  await selectBubble(page, bubble!.name);
  await nav(page, "marketplace");
  await visible(page, "add-item").click();
  let form = dialog(page);
  await form.locator('input[type="file"]').first().setInputFiles(FIXTURE);
  await form.locator("#item-title").fill(`Lamp ${RUN}`);
  await form.locator("#item-desc").fill("Works");
  await form.getByTestId("status-trade").click();
  await form.locator('button[type="submit"]').click();
  await expect(form).toHaveCount(0);
  await expect(visible(page, "market-item").filter({ hasText: `Lamp ${RUN}` })).toBeVisible();
  await visible(page, "add-item").click();
  form = dialog(page);
  await expect(form.locator("#item-title")).toHaveValue("");
  await expect(form.locator("#item-desc")).toHaveValue("");
  await expect(form.getByTestId("status-free")).toHaveAttribute("aria-pressed", "true");
  await expect(form.locator("img")).toHaveCount(0);
  await ctx.close();
});

test("notification settings list the two request switches", async ({ browser }) => {
  test.setTimeout(60_000);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, "alice@boolaa.test");
  await page.goto("/settings");
  const settings = page.getByTestId("notification-settings");
  await expect(settings).toHaveAttribute("data-loaded", "true");
  await expect(settings.getByTestId("pref-item_requests")).toHaveAttribute("aria-checked", "true");
  await expect(settings.getByTestId("pref-request_updates")).toHaveAttribute("aria-checked", "true");
  await expect(settings.getByRole("switch")).toHaveCount(12); // master + 10 types + previews
  // Mentions sits right after Chat messages, with its hint.
  const ids = await settings.getByRole("switch").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
  expect(ids.indexOf("pref-mentions")).toBe(ids.indexOf("pref-chat") + 1);
  await expect(settings.getByText("When someone @mentions you, even if chat messages are off.")).toBeVisible();
  await ctx.close();
});
