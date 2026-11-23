import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import type { Database } from "../src/lib/database.types";
import { PASSWORD, SUPABASE_KEY, SUPABASE_URL, bubbleChip, login, newSession, publicUrlOf, selectBubble } from "./helpers";

const RUN = Date.now().toString(36);
const FIXTURE = path.join(__dirname, "fixtures", "item.png");

/** Everything this suite creates carries an "e2e" marker so it can be removed (also leftovers of earlier runs). */
async function cleanup() {
  for (const email of ["alice@boolaa.test", "bob@boolaa.test"]) {
    const sb = createClient<Database>(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
    const { data, error } = await sb.auth.signInWithPassword({ email, password: PASSWORD });
    if (error) throw error;
    const uid = data.user.id;
    await sb.from("chat_messages").delete().eq("sender_id", uid).like("content", "e2e %");
    await sb.from("events").delete().eq("creator_id", uid).like("title", "E2E %");
    await sb.from("shared_links").delete().eq("user_id", uid).like("title", "E2E %");
    const { data: items } = await sb.from("market_items").select("id, image").eq("owner_id", uid).like("title", "E2E %");
    const marker = "/storage/v1/object/public/market.images/";
    const paths = (items ?? []).flatMap((i) => (i.image.includes(marker) ? [i.image.split(marker)[1]!] : []));
    // Owners can read (and so remove) their own objects since the membership_fixes migration.
    if (paths.length) await sb.storage.from("market.images").remove(paths);
    await sb.from("market_items").delete().eq("owner_id", uid).like("title", "E2E %");
    await sb.auth.signOut();
  }
}

test.beforeAll(cleanup);
test.afterAll(cleanup);

test("alice: chat, realtime, bubble switch, events, marketplace, links", async ({ page, browser }) => {
  const nav = (key: string) => page.getByTestId("sidebar").getByTestId(`nav-${key}`).click();

  await login(page, "alice@boolaa.test");
  await expect(page).toHaveURL(/\/home$/);

  // Flatmates with seeded content.
  await selectBubble(page, "Flatmates");
  await expect(page.getByTestId("feed-card").filter({ hasText: "Guilty. Buying more today." })).toBeVisible();

  // Chat: seeded history, send a message.
  await page.getByTestId("chat-fab").click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByTestId("chat-list").getByText("Who took the last oat milk?")).toBeVisible();
  await expect(page.getByTestId("chat-status")).toHaveAttribute("data-live", "true");
  const mine = `e2e hello from alice ${RUN}`;
  await page.getByTestId("chat-input").fill(mine);
  await page.getByTestId("chat-send").click();
  await expect(page.getByTestId("chat-list").getByText(mine)).toBeVisible();
  await expect(page.getByTestId("chat-input")).toHaveValue("");

  // Realtime: Bob sends from a second browser context; Alice sees it without reloading.
  const bob = await newSession(browser, "bob@boolaa.test");
  await expect(bob.page).toHaveURL(/\/home$/);
  await selectBubble(bob.page, "Flatmates");
  await bob.page.goto("/chat");
  await expect(bob.page.getByTestId("chat-list").getByText(mine)).toBeVisible();
  const fromBob = `e2e realtime from bob ${RUN}`;
  await bob.page.getByTestId("chat-input").fill(fromBob);
  await bob.page.getByTestId("chat-send").click();
  await expect(page.getByTestId("chat-list").getByText(fromBob)).toBeVisible();
  await bob.context.close();

  // Switch bubble; selection survives a reload (cookie).
  await selectBubble(page, "Climbing Crew");
  await expect(page.getByTestId("chat-list").getByText("Same time Tuesday?")).toBeVisible();
  await page.reload();
  await expect(bubbleChip(page, "Climbing Crew")).toHaveAttribute("aria-pressed", "true");

  // Events: create + RSVP.
  await nav("events");
  await expect(page.getByTestId("event-card").filter({ hasText: "Bouldering session" })).toBeVisible();
  const eventTitle = `E2E event ${RUN}`;
  await page.getByTestId("new-event").click();
  const evDialog = page.getByRole("dialog");
  await evDialog.locator("#ev-title").fill(eventTitle);
  await evDialog.locator("#ev-when").fill("2030-06-15T18:30");
  await evDialog.locator("#ev-location").fill("The wall");
  await evDialog.locator('button[type="submit"]').click();
  const card = page.getByTestId("event-card").filter({ hasText: eventTitle });
  await expect(card).toBeVisible();
  await expect(card.getByTestId("rsvp-count")).toHaveAttribute("data-count", "0");
  await card.getByTestId("rsvp-button").click();
  await expect(card.getByTestId("rsvp-button")).toHaveAttribute("aria-pressed", "true");
  await expect(card.getByTestId("rsvp-count")).toHaveAttribute("data-count", "1");

  // Marketplace: add an item with an uploaded photo.
  await nav("marketplace");
  const itemTitle = `E2E item ${RUN}`;
  await page.getByTestId("add-item").click();
  const itemDialog = page.getByRole("dialog");
  await itemDialog.locator('input[type="file"]').setInputFiles(FIXTURE);
  await itemDialog.locator("#item-title").fill(itemTitle);
  await itemDialog.locator("#item-desc").fill("Test item from the smoke test");
  await itemDialog.getByTestId("status-trade").click();
  await itemDialog.locator('button[type="submit"]').click();
  const item = page.getByTestId("market-item").filter({ hasText: itemTitle });
  await expect(item).toBeVisible();
  await expect(item.getByTestId("status-badge")).toHaveAttribute("data-status", "trade");
  // While the URL is being signed the photo is a placeholder (role img, no src): wait for the signed <img>.
  const photo = item.getByRole("img", { name: itemTitle });
  await expect(photo).toHaveAttribute("src", /\/storage\/v1\/object\/sign\/market\.images\//);
  const src = await photo.getAttribute("src");
  const img = await page.request.get(src!);
  expect(img.ok()).toBeTruthy();
  // Private bucket: the old public URL of the same photo serves nothing.
  expect((await page.request.get(publicUrlOf(src!))).ok()).toBe(false);
  await page.getByTestId("filter-free").click();
  await expect(item).toHaveCount(0);

  // Links: add, filter by tag.
  await nav("links");
  const linkTitle = `E2E link ${RUN}`;
  await page.getByTestId("add-link").click();
  const linkDialog = page.getByRole("dialog");
  await linkDialog.locator("#link-url").fill(`https://example.com/e2e-${RUN}`);
  await linkDialog.locator("#link-title").fill(linkTitle);
  await linkDialog.locator("#link-tags").fill("E2E, smoke");
  await linkDialog.locator('button[type="submit"]').click();
  await expect(page.getByRole("link", { name: linkTitle })).toBeVisible();
  await page.getByTestId("tag-filter").getByTestId("tag-smoke").click();
  await expect(page.getByTestId("link-card")).toHaveCount(1);
});

test("carol lands on the pending-approval onboarding screen", async ({ page }) => {
  await login(page, "carol@boolaa.test");
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByTestId("pending-list")).toContainText("Flatmates");
  // Main routes stay gated for her.
  await page.goto("/home");
  await expect(page).toHaveURL(/\/onboarding$/);
});

test("signed-out visitors are sent to /login", async ({ page }) => {
  await page.goto("/events");
  await expect(page).toHaveURL(/\/login$/);
});
