import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { badgeText, dividerIndex, mergeMessages } from "../src/lib/chat";
import { SUPABASE_URL, apiUser, bubbleChip, deleteUsers, login, selectBubble, serviceRoleKey, throwaway } from "./helpers";

// Chat (docs/boolaa-spec.md "Chat", migration 20261123120000_chat_improvements.sql): older pages,
// deleting your own message (live for others), photos in the private chat.images bucket, unread
// badges and the "New messages" divider. Throwaway users and bubbles only.

const RUN = Date.now().toString(36);
const ANA = throwaway("ChatAna", RUN);
const BEN = throwaway("ChatBen", RUN);
const PHOTO = path.join(__dirname, "fixtures/exif-gps.jpg");

test.afterAll(async () => {
  const key = serviceRoleKey();
  if (key) await deleteUsers(key, [ANA.email, BEN.email]);
});

test("helpers: merge by id keeps order and sender, divider and badge rules", () => {
  type M = { id: string; created_at: string; sender_id: string; sender: { name: string } | null; deleted_at: string | null };
  const a: M = { id: "b", created_at: "2026-11-22T10:00:00.000002+00:00", sender_id: "u1", sender: { name: "Ana" }, deleted_at: null };
  const b: M = { id: "a", created_at: "2026-11-22T10:00:00.000002+00:00", sender_id: "u2", sender: null, deleted_at: null };
  const c: M = { id: "c", created_at: "2026-11-22T10:00:00.000001+00:00", sender_id: "u2", sender: null, deleted_at: null };
  const list = mergeMessages([a], [b, c]);
  expect(list.map((m) => m.id)).toEqual(["c", "a", "b"]); // microseconds, then id
  const upd = mergeMessages(list, [{ ...a, sender: null, deleted_at: "2026-11-22T11:00:00Z" }]);
  expect(upd.find((m) => m.id === "b")).toMatchObject({ deleted_at: "2026-11-22T11:00:00Z", sender: { name: "Ana" } });
  expect(mergeMessages(upd, [upd[0]!])).toBe(upd); // unchanged -> same array
  expect(dividerIndex(list, "2026-11-22T09:00:00Z", "u2")).toBe(2); // first message from someone else
  expect(dividerIndex(list, null, "u2")).toBe(-1);
  expect([badgeText(0), badgeText(7), badgeText(99), badgeText(100)]).toEqual([null, "7", "99", "99+"]);
});

test("older pages, live deletion, photos, unread badges and the new-messages divider", async ({ browser }) => {
  test.setTimeout(120_000);
  const key = serviceRoleKey();
  test.skip(!key, "needs the local service-role key");
  const admin = createClient(SUPABASE_URL, key!, { auth: { persistSession: false } });

  // Ana owns two bubbles; Ben joins both (Ana's approval is the majority).
  const ana = await apiUser(ANA);
  const ben = await apiUser(BEN);
  const mk = async (name: string) => {
    const { data: bubble, error } = await ana.sb.rpc("create_bubble", { p_name: name });
    expect(error).toBeNull();
    const { data: req } = await ben.sb.rpc("request_to_join", { p_invite_code: bubble!.invite_code });
    expect((await ana.sb.rpc("approve_join_request", { p_request_id: req!.id })).data).toBe(true);
    return bubble!;
  };
  const main = await mk(`Chat ${RUN}`);
  const other = await mk(`Side ${RUN}`);

  // 70 messages: more than one page (50). Sent one by one so the order is unambiguous.
  for (let i = 1; i <= 70; i++) {
    const { error } = await ana.sb.from("chat_messages").insert({ bubble_id: main.id, sender_id: ana.id, content: `old ${i}` });
    expect(error).toBeNull();
  }

  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, BEN.email);
  await selectBubble(page, main.name);

  // Unread: 70 in the current bubble, shown on the sidebar's chat entry ("70").
  const chatNav = page.getByTestId("sidebar").getByTestId("nav-chat");
  await expect(chatNav.getByTestId("unread-badge")).toHaveText("70");

  await chatNav.click();
  const list = page.getByTestId("chat-list");
  await expect(list.getByTestId("chat-message").filter({ hasText: "old 70" })).toBeVisible();
  // All are new to Ben: the divider sits above the oldest unread message loaded.
  await expect(list.getByTestId("chat-new-divider")).toBeVisible();
  // Opening the chat marks it read.
  await expect
    .poll(async () => (await ben.sb.rpc("chat_unread_counts")).data?.find((r) => r.bubble_id === main.id)?.unread_count)
    .toBe(0);

  // Load older: scroll to the top, the first message appears and the view doesn't jump to it.
  await expect(list.getByTestId("chat-message")).toHaveCount(50);
  await list.evaluate((el) => (el.scrollTop = 0));
  await expect(list.getByTestId("chat-start")).toBeAttached();
  await expect(list.getByTestId("chat-message")).toHaveCount(70);
  const { data: first } = await ana.sb.from("chat_messages").select("id").eq("bubble_id", main.id).eq("content", "old 1").single();
  await expect(list.locator(`[data-id="${first!.id}"]`)).toBeAttached();
  expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(200); // anchored, not at the very top

  // Ana deletes one of hers: Ben sees the placeholder live.
  const { data: victim } = await ana.sb.from("chat_messages").select("id").eq("bubble_id", main.id).eq("content", "old 69").single();
  expect((await ana.sb.rpc("delete_chat_message", { p_message_id: victim!.id })).error).toBeNull();
  const placeholder = list.locator(`[data-id="${victim!.id}"]`);
  await expect(placeholder).toHaveAttribute("data-deleted", "true");
  await expect(placeholder.getByTestId("chat-deleted")).toBeVisible();
  await expect(list.getByTestId("chat-message").filter({ hasText: "old 69" })).toHaveCount(0);

  // Ben sends a photo with a caption (pipeline + private bucket, shown through a signed URL).
  await page.getByTestId("chat-photo-input").setInputFiles(PHOTO);
  await expect(page.getByTestId("chat-photo-preview")).toBeVisible();
  await page.getByTestId("chat-input").fill(`look ${RUN}`);
  await page.getByTestId("chat-send").click();
  const mine = list.getByTestId("chat-message").filter({ hasText: `look ${RUN}` });
  const img = mine.getByTestId("chat-photo");
  await expect(img).toBeVisible();
  await expect(img).toHaveAttribute("src", /\/storage\/v1\/object\/sign\/chat\.images\//);
  expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  const { data: sent } = await ben.sb.from("chat_messages").select("id, image_path").eq("content", `look ${RUN}`).single();
  expect(sent!.image_path).toMatch(new RegExp(`^${ben.id}/[0-9a-f-]+\\.jpg$`));
  // Ana (a member) can read it; it has no public URL.
  expect((await ana.sb.storage.from("chat.images").createSignedUrl(sent!.image_path!, 60)).error).toBeNull();
  const pub = await page.request.get(`${SUPABASE_URL}/storage/v1/object/public/chat.images/${sent!.image_path}`);
  expect(pub.ok()).toBe(false);

  // Ben deletes it: placeholder, the object is removed from Storage.
  await mine.hover();
  await mine.getByTestId("chat-delete").click();
  await page.getByTestId("chat-delete-confirm").click();
  await expect(list.locator(`[data-id="${sent!.id}"]`)).toHaveAttribute("data-deleted", "true");
  await expect
    .poll(async () => (await admin.storage.from("chat.images").list(ben.id)).data?.length ?? 0)
    .toBe(0);
  const { data: row } = await ana.sb.from("chat_messages").select("content, image_path, deleted_at").eq("id", sent!.id).single();
  expect(row).toMatchObject({ content: "", image_path: null });
  expect(row!.deleted_at).toBeTruthy();

  // A message in Ben's other bubble shows up as a badge on that bubble's chip, live.
  await ana.sb.from("chat_messages").insert({ bubble_id: other.id, sender_id: ana.id, content: `psst ${RUN}` });
  await expect(bubbleChip(page, other.name).getByTestId("unread-badge")).toHaveText("1");
  await bubbleChip(page, other.name).click();
  // The current bubble's count moves to the chat entry; opening its chat clears it.
  await expect(page.getByTestId("chat-list").getByTestId("chat-message").filter({ hasText: `psst ${RUN}` })).toBeVisible();
  await expect
    .poll(async () => (await ben.sb.rpc("chat_unread_counts")).data?.find((r) => r.bubble_id === other.id)?.unread_count)
    .toBe(0);
  await context.close();
});
