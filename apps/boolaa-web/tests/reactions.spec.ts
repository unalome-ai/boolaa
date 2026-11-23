import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { addReaction, removeReaction, summarize, type ReactionRow } from "../src/lib/reactions";
import { SUPABASE_URL, apiUser, deleteUsers, login, selectBubble, serviceRoleKey, throwaway } from "./helpers";

// Reactions and link previews (docs/boolaa-spec.md "Reactions" / "Link previews", migration
// 20261123160000_reactions_link_previews.sql). Throwaway users and bubble only. The preview columns
// are written with the service role here: the local edge runtime only serves the link-preview
// function after a restart, and its fetching is covered by supabase/tests.

const RUN = Date.now().toString(36);
const ANA = throwaway("ReactAna", RUN);
const BEN = throwaway("ReactBen", RUN);
const PHOTO = path.join(__dirname, "fixtures/exif-gps.jpg");

test.afterAll(async () => {
  const key = serviceRoleKey();
  if (key) await deleteUsers(key, [ANA.email, BEN.email]);
});

test("helpers: fixed order, counts, own highlight, hidden (blocked) reactors, merge by id", () => {
  const r = (id: string, reaction: string, user: string, target = "t1"): ReactionRow => ({ id, target_type: "food_post", target_id: target, reaction, user_id: user });
  let rows = [r("1", "thanks", "u1"), r("2", "like", "u2"), r("3", "like", "u1"), r("4", "love", "u3", "t2")];
  expect(summarize(rows, "t1", "u1")).toEqual([
    { reaction: "like", count: 2, mine: true },
    { reaction: "thanks", count: 1, mine: true },
  ]);
  expect(summarize(rows, "t1", "u9", new Set(["u2"]))).toEqual([
    { reaction: "like", count: 1, mine: false },
    { reaction: "thanks", count: 1, mine: false },
  ]);
  expect(addReaction(rows, rows[0]!)).toBe(rows); // the echo of our own toggle changes nothing
  expect(removeReaction(rows, "nope")).toBe(rows); // another bubble's delete
  rows = removeReaction(rows, "2");
  expect(summarize(rows, "t1", "u2")).toEqual([
    { reaction: "like", count: 1, mine: false },
    { reaction: "thanks", count: 1, mine: false },
  ]);
});

const nav = (page: Page, key: string) => page.getByTestId("sidebar").getByTestId(`nav-${key}`).click();

test("react, count, highlight and toggle live on food, chat and links; link preview cards", async ({ browser }) => {
  test.setTimeout(150_000);
  const key = serviceRoleKey();
  test.skip(!key, "needs the local service-role key");
  const admin = createClient(SUPABASE_URL, key!, { auth: { persistSession: false } });

  const ana = await apiUser(ANA);
  const ben = await apiUser(BEN);
  const { data: bubble, error } = await ana.sb.rpc("create_bubble", { p_name: `React ${RUN}` });
  expect(error).toBeNull();
  const { data: req } = await ben.sb.rpc("request_to_join", { p_invite_code: bubble!.invite_code });
  expect((await ana.sb.rpc("approve_join_request", { p_request_id: req!.id })).data).toBe(true);

  const image = `${SUPABASE_URL}/storage/v1/object/public/food.images/${ana.id}/e2e-react.png`;
  const food = await ana.sb.from("food_posts").insert({ bubble_id: bubble!.id, user_id: ana.id, image, description: `Soup ${RUN}` }).select("id").single();
  expect(food.error).toBeNull();
  const msg = await ana.sb.from("chat_messages").insert({ bubble_id: bubble!.id, sender_id: ana.id, content: `Hello ${RUN}` }).select("id").single();
  expect(msg.error).toBeNull();
  const link = await ana.sb.from("shared_links").insert({ bubble_id: bubble!.id, user_id: ana.id, url: `https://www.example.org/bread-${RUN}`, title: `Bread ${RUN}` }).select("id, preview_status").single();
  expect(link.error).toBeNull();
  expect(link.data!.preview_status).toBe("pending");

  const anaCtx = await browser.newContext();
  const benCtx = await browser.newContext();
  const anaPage = await anaCtx.newPage();
  const benPage = await benCtx.newPage();
  await login(anaPage, ANA.email);
  await login(benPage, BEN.email);
  await selectBubble(anaPage, bubble!.name);
  await selectBubble(benPage, bubble!.name);

  // --- Food: Ben reacts through the picker, Ana sees it live and adds hers, Ben toggles his off.
  await nav(anaPage, "food");
  await nav(benPage, "food");
  const anaCard = anaPage.getByTestId("food-card").filter({ hasText: `Soup ${RUN}` });
  const benCard = benPage.getByTestId("food-card").filter({ hasText: `Soup ${RUN}` });
  await expect(benCard).toBeVisible();
  await expect(anaCard).toBeVisible();
  await benCard.getByTestId("reaction-add").click();
  await expect(benCard.getByTestId("reaction-picker")).toBeVisible();
  await benCard.getByRole("menuitem", { name: "Love" }).click();
  const benLove = benCard.getByTestId("reaction-love");
  await expect(benLove).toHaveAttribute("data-count", "1");
  await expect(benLove).toHaveAttribute("aria-pressed", "true");
  await expect(benLove).toHaveAttribute("aria-label", "Love: 1 reaction, You reacted");

  const anaLove = anaCard.getByTestId("reaction-love");
  await expect(anaLove).toHaveAttribute("data-count", "1"); // live INSERT
  await expect(anaLove).toHaveAttribute("aria-pressed", "false");
  await anaLove.click();
  await expect(anaLove).toHaveAttribute("data-count", "2");
  await expect(anaLove).toHaveAttribute("aria-pressed", "true");
  await expect(benLove).toHaveAttribute("data-count", "2");
  await benLove.click();
  await expect(benLove).toHaveAttribute("data-count", "1");
  await expect(benLove).toHaveAttribute("aria-pressed", "false");
  await expect(anaLove).toHaveAttribute("data-count", "1"); // live DELETE (by id)
  await expect(anaLove).toHaveAttribute("aria-pressed", "true");

  // --- Chat: right-click a message opens the picker; deleting the message drops its reactions live.
  await nav(anaPage, "chat");
  await nav(benPage, "chat");
  const benMsg = benPage.getByTestId("chat-message").filter({ hasText: `Hello ${RUN}` });
  const anaMsg = anaPage.getByTestId("chat-message").filter({ hasText: `Hello ${RUN}` });
  await expect(benMsg).toBeVisible();
  await expect(anaPage.getByTestId("chat-status")).toHaveAttribute("data-live", "true");
  await benMsg.getByText(`Hello ${RUN}`).click({ button: "right" });
  await benMsg.getByTestId("react-laugh").click();
  await expect(benMsg.getByTestId("reaction-laugh")).toHaveAttribute("data-count", "1");
  await expect(anaMsg.getByTestId("reaction-laugh")).toHaveAttribute("data-count", "1");
  expect((await ana.sb.rpc("delete_chat_message", { p_message_id: msg.data!.id })).error).toBeNull();
  await expect(benMsg).toHaveCount(0); // now a placeholder without the text
  await expect(benPage.getByTestId("chat-message").filter({ has: benPage.getByTestId("chat-deleted") }).getByTestId("reaction-laugh")).toHaveCount(0);

  // --- Links: pending shows the loading line; the server's result arrives live as a card.
  // When the local edge runtime has `link-preview` loaded, the real fetch of this made-up URL finishes
  // (usually `failed`) within seconds. Wait for it, then put the row back to `pending` so the test
  // controls what the server "returns" below. An admin update doesn't queue another fetch.
  await expect
    .poll(async () => (await admin.from("shared_links").select("preview_status").eq("id", link.data!.id).single()).data?.preview_status, { timeout: 20_000 })
    .not.toMatch(/^(pending|fetching)$/)
    .catch(() => {}); // runtime without the function: the row simply stays pending
  expect((await admin.from("shared_links").update({ preview_status: "pending", preview_title: null, preview_description: null, preview_site_name: null, preview_image_path: null }).eq("id", link.data!.id)).error).toBeNull();
  await nav(anaPage, "links");
  await nav(benPage, "links");
  const benLink = benPage.getByTestId("link-card").filter({ hasText: `Bread ${RUN}` });
  await expect(benLink.getByTestId("link-preview-loading")).toBeVisible();
  const imgPath = `${link.data!.id}/${crypto.randomUUID()}.jpg`;
  const up = await admin.storage.from("link.previews").upload(imgPath, readFileSync(PHOTO), { contentType: "image/jpeg" });
  expect(up.error).toBeNull();
  try {
    const stored = await admin
      .from("shared_links")
      .update({
        preview_status: "ready",
        preview_title: `Sourdough ${RUN}`,
        preview_description: "Bake it slow.",
        preview_site_name: "Bread Weekly",
        preview_image_path: imgPath,
      })
      .eq("id", link.data!.id);
    expect(stored.error).toBeNull();
    const card = benLink.getByTestId("link-preview");
    await expect(card).toBeVisible();
    await expect(benLink.getByTestId("link-preview-loading")).toHaveCount(0);
    await expect(card.getByTestId("link-preview-title")).toHaveText(`Sourdough ${RUN}`);
    await expect(card.getByTestId("link-preview-domain")).toHaveText("example.org · Bread Weekly");
    await expect(card).toHaveAttribute("href", `https://www.example.org/bread-${RUN}`);
    const img = card.getByTestId("link-preview-image");
    await expect(img).toHaveAttribute("src", new RegExp(`/storage/v1/object/sign/link\\.previews/${imgPath}\\?token=`));
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);

    // Links take reactions too.
    await benLink.getByTestId("reaction-add").click();
    await benLink.getByRole("menuitem", { name: "Thanks" }).click();
    await expect(anaPage.getByTestId("link-card").filter({ hasText: `Bread ${RUN}` }).getByTestId("reaction-thanks")).toHaveAttribute("data-count", "1");
  } finally {
    await admin.storage.from("link.previews").remove([imgPath]);
  }

  await anaCtx.close();
  await benCtx.close();
});
