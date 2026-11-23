import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import type { Database } from "../src/lib/database.types";
import { PASSWORD, SUPABASE_KEY, SUPABASE_URL, login, selectBubble } from "./helpers";
import { splitLinks } from "../src/lib/linkify";

// QA follow-ups (docs/boolaa-spec.md "Chat", "Events", "Push notifications", "Invite links"):
// tappable links in chat, past events in their own section without RSVP, the notification preview
// hint naming the current bubble, and the invalid-invite button label.

const RUN = Date.now().toString(36);
const FLATMATES = "aaaaaaaa-0000-0000-0000-000000000001";
/** Optional: where to save screenshots of the fixed screens (QA evidence). */
const SHOTS = process.env.SHOT_DIR;

async function alice() {
  const sb = createClient<Database>(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email: "alice@boolaa.test", password: PASSWORD });
  if (error) throw error;
  return { sb, id: data.user.id };
}

async function cleanup() {
  const { sb, id } = await alice();
  await sb.from("chat_messages").delete().eq("sender_id", id).like("content", "e2e link %");
  await sb.from("events").delete().eq("creator_id", id).like("title", "E2E past %");
  await sb.from("events").delete().eq("creator_id", id).like("title", "E2E soon %");
}
test.beforeAll(cleanup);
test.afterAll(cleanup);

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

test("linkify: http(s) and www. links, trailing punctuation stays text", () => {
  const parts = splitLinks("See https://example.com/a_(b), www.boolaa.ro. and http://x.y/z?q=1! not ftp://no or wwwx.com");
  expect(parts.filter((p) => p.href).map((p) => [p.text, p.href])).toEqual([
    ["https://example.com/a_(b)", "https://example.com/a_(b)"],
    ["www.boolaa.ro", "https://www.boolaa.ro"],
    ["http://x.y/z?q=1", "http://x.y/z?q=1"],
  ]);
  expect(parts.map((p) => p.text).join("")).toBe("See https://example.com/a_(b), www.boolaa.ro. and http://x.y/z?q=1! not ftp://no or wwwx.com");
  expect(splitLinks("(see https://a.com)").find((p) => p.href)?.text).toBe("https://a.com");
  expect(splitLinks("https://").some((p) => p.href)).toBe(false);
});

test("chat: links in messages open in a new tab, long URLs still wrap", async ({ page }) => {
  await login(page, "alice@boolaa.test");
  await selectBubble(page, "Flatmates");
  await page.goto("/chat");
  const long = `https://example.com/${"very-long-path-segment-".repeat(8)}end?ref=${RUN}`;
  const text = `e2e link ${RUN} see ${long} or www.boolaa.ro.`;
  await page.getByTestId("chat-input").fill(text);
  await page.getByTestId("chat-send").click();
  const msg = page.getByTestId("chat-list").getByTestId("chat-message").filter({ hasText: `e2e link ${RUN}` });
  const links = msg.getByTestId("chat-link");
  await expect(links).toHaveCount(2);
  await expect(links.nth(0)).toHaveAttribute("href", long);
  await expect(links.nth(1)).toHaveAttribute("href", "https://www.boolaa.ro");
  await expect(links.nth(1)).toHaveText("www.boolaa.ro");
  for (const i of [0, 1]) {
    await expect(links.nth(i)).toHaveAttribute("target", "_blank");
    await expect(links.nth(i)).toHaveAttribute("rel", "noopener noreferrer nofollow");
  }
  // The whole text is still there (the trailing "." stays text) and nothing overflows the bubble.
  await expect(msg).toContainText(text);
  const fits = await msg.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  expect(fits).toBe(true);
  await msg.scrollIntoViewIfNeeded();
  await shot(page, "web-chat-links");
});

test("events: past events sit in a collapsed Past section without RSVP", async ({ page }) => {
  const { sb, id } = await alice();
  const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
  const { error } = await sb.from("events").insert([
    { bubble_id: FLATMATES, creator_id: id, title: `E2E past dinner ${RUN}`, datetime: ago(48), location: "Kitchen" },
    { bubble_id: FLATMATES, creator_id: id, title: `E2E past movie ${RUN}`, datetime: ago(2) },
    // Started 30 minutes ago: still on (an event lasts 1 hour), so still upcoming with RSVP.
    { bubble_id: FLATMATES, creator_id: id, title: `E2E soon ${RUN}`, datetime: ago(0.5) },
  ]);
  expect(error).toBeNull();

  await login(page, "alice@boolaa.test");
  await selectBubble(page, "Flatmates");
  await page.goto("/events");
  const past = page.getByTestId("past-events");
  await expect(past).toBeVisible();
  await expect(past).not.toHaveAttribute("open", "");
  await expect(past.getByTestId("past-count")).toHaveText("2");

  // Upcoming first: the still-running event has RSVP; past ones aren't visible until expanded.
  const soon = page.getByTestId("event-card").filter({ hasText: `E2E soon ${RUN}` });
  await expect(soon.getByTestId("rsvp-button")).toBeVisible();
  const dinner = past.getByTestId("event-card").filter({ hasText: `E2E past dinner ${RUN}` });
  await expect(dinner).toBeHidden();

  await past.locator("summary").click();
  await expect(dinner).toBeVisible();
  await expect(dinner).toHaveAttribute("data-past", "true");
  await expect(dinner.getByTestId("rsvp-button")).toHaveCount(0);
  await expect(dinner.getByTestId("rsvp-ended")).toHaveText("Ended");
  await expect(dinner.getByTestId("rsvp-count")).toHaveText("Nobody went");
  // Most recent past event first.
  await expect(past.getByTestId("event-card").first()).toContainText(`E2E past movie ${RUN}`);
  // The Past section comes after every upcoming card.
  const order = await page.getByTestId("event-card").evaluateAll((els) => els.map((e) => e.getAttribute("data-past")));
  expect(order.lastIndexOf("false")).toBeLessThan(order.indexOf("true"));
  await past.scrollIntoViewIfNeeded();
  await shot(page, "web-past-events");

  // The server refuses an RSVP to an ended event too (toggle_rsvp: 'event has ended').
  const { data: row } = await sb.from("events").select("id").eq("title", `E2E past dinner ${RUN}`).single();
  const r = await sb.rpc("toggle_rsvp", { p_event_id: row!.id });
  expect(r.error?.message).toContain("event has ended");
});

test("notifications: the preview hint names the current bubble", async ({ page }) => {
  await login(page, "alice@boolaa.test");
  await selectBubble(page, "Climbing Crew");
  await page.goto("/settings");
  const settings = page.getByTestId("notification-settings");
  await expect(settings).toHaveAttribute("data-loaded", "true");
  await expect(settings).toContainText('only say "New message in Climbing Crew"');
  await expect(settings).not.toContainText("Flatmates");
  await settings.getByText("New message in Climbing Crew").scrollIntoViewIfNeeded();
  await shot(page, "web-preview-hint");
});

test("invite: the invalid-link page has a labelled way back", async ({ page }) => {
  await login(page, "alice@boolaa.test");
  await page.goto("/join/ZZZZZZZZZZ");
  await expect(page.getByTestId("join-invalid")).toBeVisible();
  const home = page.getByTestId("join-invalid-home");
  await expect(home).toHaveText("Go to Boolaa");
  await shot(page, "web-invalid-invite");
  await home.click();
  await expect(page).not.toHaveURL(/\/join\//);
});
