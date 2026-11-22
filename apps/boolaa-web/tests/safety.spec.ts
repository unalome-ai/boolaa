import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { SUPABASE_URL, apiUser, deleteUsers, emailCode, login, objectExists, register, serviceRoleKey, throwaway, typeCode } from "./helpers";

/**
 * Report + block + unblock between two throwaway users, and in-app account deletion.
 * Never touches seeded users (other clients test against the same database).
 */
const KEY = serviceRoleKey();
const RUN = Date.now().toString(36);
const created: string[] = [];
/** Unique per test run and per repeat (--repeat-each reuses the module). */
const user = (role: string) => {
  const u = throwaway(role, `${RUN}${test.info().repeatEachIndex}`);
  created.push(u.email);
  return u;
};
const FIXTURE = path.join(__dirname, "fixtures", "item.png");

test.skip(!KEY, "SUPABASE_SERVICE_ROLE_KEY not available for cleanup");
test.afterAll(async () => {
  if (KEY) await deleteUsers(KEY, created);
});

test("report a message, also block, messages disappear; unblock from the profile", async ({ page }) => {
  const reporter = user("Reporter");
  const troll = user("Troll");
  // Setup through the API: reporter owns a bubble, troll joins and posts two messages.
  const a = await apiUser(reporter);
  const b = await apiUser(troll);
  const { data: bubble, error: e1 } = await a.sb.rpc("create_bubble", { p_name: `E2E safety ${RUN}`, p_description: "", p_max_size: 12 });
  expect(e1).toBeNull();
  const { data: req } = await b.sb.rpc("request_to_join", { p_invite_code: bubble!.invite_code });
  await a.sb.rpc("approve_join_request", { p_request_id: req!.id });
  const nasty = `e2e nasty ${RUN}`;
  const { data: msgs } = await b.sb
    .from("chat_messages")
    .insert([
      { bubble_id: bubble!.id, sender_id: b.id, content: nasty },
      { bubble_id: bubble!.id, sender_id: b.id, content: `e2e second ${RUN}` },
    ])
    .select("id");
  await a.sb.from("chat_messages").insert({ bubble_id: bubble!.id, sender_id: a.id, content: `e2e mine ${RUN}` });

  await login(page, reporter.email);
  await page.goto("/chat");
  const fromTroll = page.getByTestId("chat-message").filter({ hasText: `${RUN}` }).filter({ hasNotText: "mine" });
  await expect(fromTroll).toHaveCount(2);
  // No report menu on your own message.
  await expect(page.getByTestId("chat-message").filter({ hasText: "e2e mine" }).getByTestId("safety-menu")).toHaveCount(0);

  const msg = page.getByTestId("chat-message").filter({ hasText: nasty });
  await msg.getByTestId("safety-menu").click();
  await page.getByTestId("report").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("report-submit")).toBeDisabled();
  await dialog.getByTestId("reason-harassment").check();
  await dialog.locator("#report-details").fill("e2e test report");
  await dialog.getByTestId("report-submit").click();
  await expect(dialog.getByTestId("report-sent")).toContainText(troll.name);
  await dialog.getByTestId("also-block").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(fromTroll).toHaveCount(0);
  await expect(page.getByTestId("chat-message").filter({ hasText: "e2e mine" })).toHaveCount(1);

  // The report is stored (the reporter may read their own reports).
  const { data: reports } = await a.sb.from("reports").select("reason, reported_user_id").eq("target_id", msgs![0]!.id);
  expect(reports).toEqual([{ reason: "harassment", reported_user_id: b.id }]);

  // Blocking is enforced by RLS too: still hidden after a reload.
  await page.reload();
  await expect(page.getByTestId("chat-message").filter({ hasText: "e2e mine" })).toHaveCount(1);
  await expect(fromTroll).toHaveCount(0);

  // Unblock from the profile sheet.
  await page.getByTestId("profile-button").click();
  const row = page.getByTestId("blocked-user").filter({ hasText: troll.name });
  await expect(row).toBeVisible();
  await row.getByTestId("unblock").click();
  await expect(page.getByTestId("blocked-users").getByTestId("blocked-user")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(fromTroll).toHaveCount(2);
});

async function uploadedSrc(page: Page, img: ReturnType<Page["locator"]>) {
  await expect(img).toHaveAttribute("src", /\/storage\/v1\/object\/public\//);
  return (await img.getAttribute("src"))!;
}

test("delete account removes the user's images and the auth user", async ({ browser }) => {
  const leaver = user("Leaver");
  const page = await register(browser, leaver);
  page.on("dialog", (d) => void d.accept());
  await page.locator("#bubble-name").fill(`E2E leaving ${RUN}`);
  await page.locator('form:has(#bubble-name) button[type="submit"]').click();
  await expect(page).toHaveURL(/\/home$/);

  // An avatar and a food photo to clean up.
  await page.getByTestId("profile-button").click();
  await page.getByRole("dialog").locator('input[type="file"]').setInputFiles(FIXTURE);
  const avatar = await uploadedSrc(page, page.getByTestId("profile-button").locator("img"));
  await page.keyboard.press("Escape");
  await page.goto("/food");
  await page.getByTestId("share-food").click();
  await page.getByRole("dialog").locator('input[type="file"]').setInputFiles(FIXTURE);
  await page.locator("#food-desc").fill(`E2E bye ${RUN}`);
  await page.getByRole("dialog").locator('button[type="submit"]').click();
  const food = await uploadedSrc(page, page.getByTestId("food-card").locator("img").first());
  expect(await objectExists(page.request, avatar)).toBe(true);
  expect(await objectExists(page.request, food)).toBe(true);

  // Delete: warning + typed confirmation word.
  await page.getByTestId("profile-button").click();
  await page.getByTestId("delete-account").click();
  await expect(page.getByTestId("delete-panel")).toContainText("can't be undone");
  await expect(page.getByTestId("delete-confirm")).toBeDisabled();
  await page.getByTestId("delete-word").fill("nope");
  await expect(page.getByTestId("delete-confirm")).toBeDisabled();
  await page.getByTestId("delete-word").fill("delete");
  // Then an emailed sensitive-action code (always, docs/auth-security.md §2); the right code deletes.
  const sentAt = Date.now();
  await page.getByTestId("delete-confirm").click();
  await expect(page.getByTestId("delete-code-sent")).toBeVisible();
  await typeCode(page, await emailCode(leaver.email, sentAt));
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("landing")).toBeVisible();

  await expect.poll(() => objectExists(page.request, avatar)).toBe(false);
  await expect.poll(() => objectExists(page.request, food)).toBe(false);
  const admin = createClient(SUPABASE_URL, KEY!, { auth: { persistSession: false } });
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  expect(data.users.some((u) => u.email === leaver.email)).toBe(false);
  // And the old session is gone: the app is no longer reachable.
  await page.goto("/home");
  await expect(page).toHaveURL(/\/login$/);
});
