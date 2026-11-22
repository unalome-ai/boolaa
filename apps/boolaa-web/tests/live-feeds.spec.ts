import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import type { Database } from "../src/lib/database.types";
import { PASSWORD, SUPABASE_KEY, SUPABASE_URL, newSession, selectBubble } from "./helpers";

// Live feeds (supabase/migrations/20261123110000_realtime_feeds.sql): what Alice creates, edits
// and deletes shows up in Bob's open tabs without a reload. Bob visits every feed page first, so
// the later checks also cover routes that stay mounted but hidden.

const RUN = Date.now().toString(36);
const FLATMATES = "aaaaaaaa-0000-0000-0000-000000000001";
const MARK = `E2E live ${RUN}`;

async function signedIn(email: string) {
  const sb = createClient<Database>(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return { sb, uid: data.user.id };
}

async function cleanup() {
  const { sb, uid } = await signedIn("alice@boolaa.test");
  await sb.from("events").delete().eq("creator_id", uid).like("title", "E2E live %");
  await sb.from("shared_links").delete().eq("user_id", uid).like("title", "E2E live %");
  await sb.from("food_posts").delete().eq("user_id", uid).like("description", "E2E live %");
  await sb.from("market_items").delete().eq("owner_id", uid).like("title", "E2E live %");
  await sb.auth.signOut();
}

test.beforeAll(cleanup);
test.afterAll(cleanup);

const nav = (page: Page, key: string) => page.getByTestId("sidebar").getByTestId(`nav-${key}`).click();

test("feeds update live across two browser contexts (insert, edit, RSVP, delete)", async ({ browser }) => {
  const alice = await newSession(browser, "alice@boolaa.test");
  const bob = await newSession(browser, "bob@boolaa.test");
  await selectBubble(alice.page, "Flatmates");
  await selectBubble(bob.page, "Flatmates");

  // Bob opens every feed once (they stay mounted), seeded content proves each loaded.
  await nav(bob.page, "events");
  await expect(bob.page.getByTestId("event-card").filter({ hasText: "Flat dinner" })).toBeVisible();
  await nav(bob.page, "food");
  await expect(bob.page.getByTestId("food-card").filter({ hasText: "Leftover salad" })).toBeVisible();
  await nav(bob.page, "marketplace");
  await expect(bob.page.getByTestId("market-item").filter({ hasText: "Old sofa" })).toBeVisible();
  await nav(bob.page, "links");
  await expect(bob.page.getByTestId("link-card").filter({ hasText: "Budget recipes" })).toBeVisible();

  // Alice: an event and a link through the UI ...
  await nav(alice.page, "events");
  await alice.page.getByTestId("new-event").click();
  const evDialog = alice.page.getByRole("dialog");
  await evDialog.locator("#ev-title").fill(`${MARK} event`);
  await evDialog.locator("#ev-when").fill("2030-06-15T18:30");
  await evDialog.locator('button[type="submit"]').click();
  await expect(alice.page.getByTestId("event-card").filter({ hasText: `${MARK} event` })).toBeVisible();

  await nav(alice.page, "links");
  await alice.page.getByTestId("add-link").click();
  const linkDialog = alice.page.getByRole("dialog");
  await linkDialog.locator("#link-url").fill(`https://example.com/live-${RUN}`);
  await linkDialog.locator("#link-title").fill(`${MARK} link`);
  await linkDialog.locator('button[type="submit"]').click();
  await expect(alice.page.getByRole("link", { name: `${MARK} link` })).toBeVisible();

  // ... food and market rows through her API session (photo upload is covered by smoke/storage).
  const { sb, uid } = await signedIn("alice@boolaa.test");
  const image = `${SUPABASE_URL}/storage/v1/object/public/food.images/${uid}/e2e-live.png`;
  const food = await sb.from("food_posts").insert({ bubble_id: FLATMATES, user_id: uid, image, description: `${MARK} food` }).select("id").single();
  expect(food.error).toBeNull();
  const item = await sb
    .from("market_items")
    .insert({ bubble_id: FLATMATES, owner_id: uid, image: image.replace("food.images", "market.images"), title: `${MARK} item` })
    .select("id")
    .single();
  expect(item.error).toBeNull();

  // Bob sees all four appear (links page is the visible one; others are checked on navigation).
  const bobLink = bob.page.getByTestId("link-card").filter({ hasText: `${MARK} link` });
  await expect(bobLink).toBeVisible();
  await nav(bob.page, "marketplace");
  const bobItem = bob.page.getByTestId("market-item").filter({ hasText: `${MARK} item` });
  await expect(bobItem).toBeVisible();
  await nav(bob.page, "food");
  const bobFood = bob.page.getByTestId("food-card").filter({ hasText: `${MARK} food` });
  await expect(bobFood).toBeVisible();
  await nav(bob.page, "events");
  const bobEvent = bob.page.getByTestId("event-card").filter({ hasText: `${MARK} event` });
  await expect(bobEvent).toBeVisible();
  await expect(bobEvent.getByTestId("rsvp-count")).toHaveAttribute("data-count", "0");

  // RSVP from Alice's tab updates Bob's count; Bob's RSVP updates Alice's.
  await nav(alice.page, "events");
  const aliceEvent = alice.page.getByTestId("event-card").filter({ hasText: `${MARK} event` });
  await aliceEvent.getByTestId("rsvp-button").click();
  await expect(bobEvent.getByTestId("rsvp-count")).toHaveAttribute("data-count", "1");
  await bobEvent.getByTestId("rsvp-button").click();
  await expect(aliceEvent.getByTestId("rsvp-count")).toHaveAttribute("data-count", "2");

  // Edits stream in, with the author still shown.
  expect((await sb.from("food_posts").update({ description: `${MARK} food edited` }).eq("id", food.data!.id)).error).toBeNull();
  expect((await sb.from("events").update({ title: `${MARK} event edited` }).eq("creator_id", uid).eq("title", `${MARK} event`)).error).toBeNull();
  const edited = bob.page.getByTestId("event-card").filter({ hasText: `${MARK} event edited` });
  await expect(edited).toBeVisible();
  await expect(edited).toContainText("Alice");
  await nav(bob.page, "food");
  await expect(bob.page.getByTestId("food-card").filter({ hasText: `${MARK} food edited` })).toBeVisible();

  // Deletes disappear from every open feed.
  expect((await sb.from("food_posts").delete().eq("id", food.data!.id)).error).toBeNull();
  expect((await sb.from("market_items").delete().eq("id", item.data!.id)).error).toBeNull();
  expect((await sb.from("shared_links").delete().eq("user_id", uid).eq("title", `${MARK} link`)).error).toBeNull();
  expect((await sb.from("events").delete().eq("creator_id", uid).like("title", `${MARK} event%`)).error).toBeNull();
  await expect(bob.page.getByTestId("food-card").filter({ hasText: MARK })).toHaveCount(0);
  await nav(bob.page, "marketplace");
  await expect(bob.page.getByTestId("market-item").filter({ hasText: MARK })).toHaveCount(0);
  await nav(bob.page, "links");
  await expect(bob.page.getByTestId("link-card").filter({ hasText: MARK })).toHaveCount(0);
  await nav(bob.page, "events");
  await expect(bob.page.getByTestId("event-card").filter({ hasText: MARK })).toHaveCount(0);
  await expect(bob.page.getByTestId("event-card").filter({ hasText: "Flat dinner" })).toBeVisible();

  await sb.auth.signOut();
  await alice.context.close();
  await bob.context.close();
});
