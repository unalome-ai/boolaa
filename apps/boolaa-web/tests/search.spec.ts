import { expect, test, type Page } from "@playwright/test";
import { aroundWindow, foldChar, highlightParts, highlightRanges, hitHref, parseHits } from "../src/lib/search";
import { apiUser, deleteUsers, login, selectBubble, serviceRoleKey, throwaway } from "./helpers";

// Search inside a bubble (docs/boolaa-spec.md "Search", migration 20261123180000_bubble_search.sql).
// Throwaway users and bubble only; visibility rules (blocks, deleted messages, other bubbles) are
// covered by supabase/tests/bubble_search.test.ts.

const RUN = Date.now().toString(36);
const ANA = throwaway("SearchAna", RUN);
const BEN = throwaway("SearchBen", RUN);

test.afterAll(async () => {
  const key = serviceRoleKey();
  if (key) await deleteUsers(key, [ANA.email, BEN.email]);
});

test("helpers: folding, highlight ranges, hrefs, chat window", () => {
  expect(foldChar("Ș")).toBe("s");
  expect(foldChar("ş")).toBe("s");
  expect(foldChar("Œ")).toBe("oe");
  expect(highlightRanges("Sărmăluțe la bunica", ["sarma"])).toEqual([[0, 5]]);
  expect(highlightRanges("Crème brûlée, CRÈME!", ["creme", "brulee"])).toEqual([[0, 5], [6, 12], [14, 19]]);
  expect(highlightRanges("cœur", ["coeur"])).toEqual([[0, 4]]);
  expect(highlightRanges("abcabc", ["abc", "bca"])).toEqual([[0, 6]]); // overlaps merge
  expect(highlightRanges("😀 pizza", ["pizza"])).toEqual([[3, 8]]); // UTF-16 offsets around astral chars
  expect(highlightRanges("pizza", [])).toEqual([]);
  expect(highlightRanges("pizza", null)).toEqual([]);
  expect(highlightParts("Big <b>pizza</b>", ["pizza"])).toEqual([
    { text: "Big <b>", hit: false },
    { text: "pizza", hit: true },
    { text: "</b>", hit: false },
  ]);
  expect(hitHref({ kind: "shared_link", id: "a b" })).toBe("/links?link=a%20b");
  expect(hitHref({ kind: "chat_message", id: "x" })).toBe("/chat?message=x");
  expect(parseHits([{ kind: "event", id: "1" }, { kind: "poll", id: "2" }, null]).map((h) => h.id)).toEqual(["1"]);
  const rows = Array.from({ length: 40 }, (_, i) => ({ id: `m${39 - i}` })); // newest first
  expect(aroundWindow(rows, "m10")).toEqual({ found: true, startReached: true });
  expect(aroundWindow(rows, "m30")).toEqual({ found: true, startReached: false });
  expect(aroundWindow(rows, "nope")).toEqual({ found: false, startReached: false });
});

async function openSearch(page: Page) {
  await page.getByTestId("search-button").click();
  const input = page.getByTestId("search-input");
  await expect(input).toBeFocused();
  return input;
}

test("search the bubble, highlight matches, open each kind in context", async ({ browser }) => {
  test.setTimeout(150_000);
  const ana = await apiUser(ANA);
  const ben = await apiUser(BEN);
  const { data: bubble, error } = await ana.sb.rpc("create_bubble", { p_name: `Search ${RUN}` });
  expect(error).toBeNull();
  const { data: req } = await ben.sb.rpc("request_to_join", { p_invite_code: bubble!.invite_code });
  expect((await ana.sb.rpc("approve_join_request", { p_request_id: req!.id })).data).toBe(true);
  const b = bubble!.id;

  // An old message, buried under 70 newer ones (beyond the first page of 50), plus an HTML-ish one.
  const old = await ana.sb.from("chat_messages").insert({ bubble_id: b, sender_id: ana.id, content: `Sărmăluțe la bunica ${RUN}` }).select("id").single();
  expect(old.error).toBeNull();
  const xss = await ana.sb.from("chat_messages").insert({ bubble_id: b, sender_id: ana.id, content: `<img src=x onerror="window.__xss=1"> hacked${RUN}` }).select("id").single();
  expect(xss.error).toBeNull();
  for (let i = 0; i < 70; i++) {
    const { error: e } = await ana.sb.from("chat_messages").insert({ bubble_id: b, sender_id: ana.id, content: `filler ${i}` });
    expect(e).toBeNull();
  }
  const ev = await ana.sb.from("events").insert({ bubble_id: b, creator_id: ana.id, title: `Climbing ${RUN}`, location: "Café Crème", datetime: new Date(Date.now() + 86400_000).toISOString() }).select("id").single();
  const food1 = await ana.sb.from("food_posts").insert({ bubble_id: b, user_id: ana.id, image: "https://example.com/a.jpg", description: `Crème brûlée ${RUN}` }).select("id").single();
  const food2 = await ana.sb.from("food_posts").insert({ bubble_id: b, user_id: ana.id, image: "https://example.com/b.jpg", description: `Lasagne ${RUN}` }).select("id").single();
  const item = await ana.sb.from("market_items").insert({ bubble_id: b, owner_id: ana.id, image: "https://example.com/c.jpg", title: `Ñandú lamp ${RUN}`, status: "free" }).select("id").single();
  const link = await ana.sb.from("shared_links").insert({ bubble_id: b, user_id: ana.id, url: `https://example.org/recipes-${RUN}`, title: `Recipes ${RUN}` }).select("id").single();
  for (const r of [ev, food1, food2, item, link]) expect(r.error).toBeNull();

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, BEN.email);
  await selectBubble(page, bubble!.name);

  // Idle hint, minimum length, no results.
  let input = await openSearch(page);
  await expect(page.getByTestId("search-hint")).toBeVisible();
  await input.fill("s");
  await expect(page.getByTestId("search-min")).toBeVisible();
  await input.fill(`nothing${RUN}`);
  await expect(page.getByTestId("search-empty")).toBeVisible();
  await expect(page.getByTestId("search-status")).toContainText(`nothing${RUN}`);

  // Accent-free query finds the accented message; the match is highlighted in the original text.
  await input.fill("sarmalute bunica");
  const chatHit = page.locator(`[data-testid="search-hit"][data-id="${old.data!.id}"]`);
  await expect(chatHit).toBeVisible();
  await expect(chatHit).toHaveAttribute("data-kind", "chat_message");
  await expect(chatHit.getByTestId("search-mark").first()).toHaveText("Sărmăluțe");
  await expect(chatHit.getByTestId("search-mark").nth(1)).toHaveText("bunica");
  await expect(page.getByTestId("search-status")).toHaveText("1 result");

  // Opening it jumps the chat to the old message (not in the newest page) and highlights it.
  await chatHit.click();
  await expect(page).toHaveURL(/\/chat/);
  const target = page.locator(`[data-testid="chat-message"][data-id="${old.data!.id}"]`);
  await expect(target).toBeVisible();
  await expect(target).toHaveAttribute("data-highlight", "true");
  await expect(target).toBeInViewport();
  // The newest message is still there: the window is contiguous with the live end.
  await expect(page.locator('[data-testid="chat-message"]').filter({ hasText: "filler 69" })).toHaveCount(1);
  await expect(page.getByTestId("chat-start")).toBeVisible(); // the window reached the first message

  // HTML in user content is shown as text, never run.
  input = await openSearch(page);
  await input.fill(`hacked${RUN}`);
  const xssHit = page.locator(`[data-testid="search-hit"][data-id="${xss.data!.id}"]`);
  await expect(xssHit.getByTestId("search-snippet")).toContainText('<img src=x onerror="window.__xss=1">');
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  await expect(xssHit.locator("img")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("search-input")).toHaveCount(0);

  // Event, food, market item and link: open their screen and highlight the card.
  const openKind = async (q: string, id: string, path: RegExp, kind: string) => {
    const box = await openSearch(page);
    await box.fill(q);
    const hit = page.locator(`[data-testid="search-hit"][data-id="${id}"]`);
    await expect(hit).toHaveAttribute("data-kind", kind);
    await hit.click();
    await expect(page).toHaveURL(path);
    const card = page.locator(`[data-item-id="${id}"]`).filter({ visible: true });
    await expect(card).toHaveAttribute("data-highlight", "true");
  };
  await openKind("climb", ev.data!.id, /\/events/, "event");
  await openKind("creme brulee", food1.data!.id, /\/food/, "food_post");
  await openKind(`lasagne ${RUN}`, food2.data!.id, /\/food/, "food_post"); // same route: still highlights
  await openKind("nandu", item.data!.id, /\/marketplace/, "market_item");
  await openKind(`recipes-${RUN}`, link.data!.id, /\/links/, "shared_link");

  // Clear button empties the query.
  input = await openSearch(page);
  await input.fill("climb");
  await page.getByTestId("search-clear").click();
  await expect(input).toHaveValue("");
  await expect(page.getByTestId("search-hint")).toBeVisible();
  await ctx.close();
});
