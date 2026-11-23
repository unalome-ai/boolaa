import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { PASSWORD, SUPABASE_URL, login, serviceRoleKey } from "./helpers";

/**
 * Moderation admin view (/admin) and the suspended screen. Uses the seeded admin mod@boolaa.test
 * and the seeded report by Erin about Dave's message in "Book Club" (supabase/seed.sql). Restores
 * Dave and the report afterwards so the suite can run again.
 */
const KEY = serviceRoleKey();
const DAVE = "55555555-5555-5555-5555-555555555555";
const REPORT = "dddddddd-0000-0000-0000-000000000001";

async function restore() {
  if (!KEY) return;
  const admin = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });
  await admin.from("users").update({ status: "active", status_reason: null, status_until: null }).eq("id", DAVE);
  await admin.auth.admin.updateUserById(DAVE, { ban_duration: "none" });
  await admin.from("reports").update({ status: "open", handled_at: null, handled_note: null }).eq("id", REPORT);
}

test.describe("moderation", () => {
  test.skip(!KEY, "SUPABASE_SERVICE_ROLE_KEY not available for cleanup");
  test.beforeAll(restore);
  test.afterAll(restore);

  test("/admin is a 404 for signed-out visitors and non-admins", async ({ page }) => {
    const anon = await page.goto("/admin");
    expect(anon?.status()).toBe(404);
    await expect(page.getByTestId("admin-report")).toHaveCount(0);

    await login(page, "alice@boolaa.test");
    const res = await page.goto(`/admin?report=${REPORT}`);
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Moderation" })).toHaveCount(0);

    const sitemap = await page.request.get("/sitemap.xml");
    expect(await sitemap.text()).not.toContain("/admin");
  });

  test("admin suspends a reported user, who then sees the suspended screen", async ({ page, browser }) => {
    // Dave is signed in before the suspension (an access token stays valid for up to an hour).
    const daveCtx = await browser.newContext();
    const dave = await daveCtx.newPage();
    await login(dave, "dave@boolaa.test");

    await login(page, "mod@boolaa.test");
    const res = await page.goto(`/admin?report=${REPORT}`);
    expect(res?.status()).toBe(200);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

    // The linked report opens first, with its chat context; it's over 20 h old, so flagged.
    const card = page.locator(`[data-testid="admin-report"][data-report-id="${REPORT}"]`).first();
    await expect(card).toContainText("Nobody cares what you think, Erin");
    await expect(card).toContainText("Book Club");
    await expect(card.getByTestId("admin-report-age")).toHaveAttribute("data-late", "true");
    await expect(card.getByTestId("admin-open-count")).toContainText("2 open reports");
    await expect(card.getByTestId("admin-context")).toContainText("That is not ok.");

    await card.getByTestId("admin-note").fill("e2e: first warning");
    await card.getByTestId("admin-action-suspend-7").click();
    const confirm = page.getByTestId("admin-confirm");
    await expect(confirm).toContainText("Suspend Dave for 7 days?");
    await confirm.getByTestId("admin-confirm-go").click();
    await expect(page.getByTestId("admin-notice")).toContainText("User suspended.");
    await page.getByTestId("admin-queue-actioned").click();
    await expect(page.locator(`[data-testid="admin-report"][data-report-id="${REPORT}"]`).first()).toContainText("e2e: first warning");

    // Already signed in: the next page load lands on /suspended with the reason and end date.
    await dave.goto("/home");
    await expect(dave).toHaveURL(/\/suspended$/);
    await expect(dave.getByTestId("suspended")).toHaveAttribute("data-state", "suspended");
    await expect(dave.getByTestId("suspended-until")).toBeVisible();
    await expect(dave.getByTestId("suspended-reason")).toBeVisible();
    await expect(dave.locator('a[href="mailto:privacy@boolaa.ro"]')).toBeVisible();
    await dave.getByTestId("suspended-sign-out").click();
    await expect(dave).toHaveURL(/\/login$/);

    // Signing in again is refused by GoTrue (banned_until): the suspended screen explains it.
    // The form can still be hydrating after the client-side redirect: a value typed too early shows in
    // the field but not in React's state, so the request goes out without an email ("Something went
    // wrong"). Fill and submit again until the refused sign-in lands on /suspended.
    await expect(async () => {
      if (!/\/suspended$/.test(dave.url())) {
        await dave.locator("#email").fill("dave@boolaa.test");
        await dave.locator("#password").fill(PASSWORD);
        await dave.locator('form button[type="submit"]').click();
      }
      await expect(dave).toHaveURL(/\/suspended$/, { timeout: 3_000 });
    }).toPass({ timeout: 20_000 });
    await expect(dave).toHaveURL(/\/suspended$/);
    await expect(dave.getByTestId("suspended")).toHaveAttribute("data-state", "signedOut");
    await expect(dave.locator('a[href="mailto:privacy@boolaa.ro"]')).toBeVisible();

    // Users tab: find Dave and lift the suspension; he can sign in again.
    await page.getByTestId("admin-tab-users").click();
    await page.getByTestId("admin-user-search").fill("Dave");
    const row = page.locator(`[data-testid="admin-user-row"][data-user-id="${DAVE}"]`);
    await expect(row.getByTestId("admin-user-status")).toContainText("Suspended");
    await row.getByTestId("admin-unsuspend").click();
    await page.getByTestId("admin-confirm").getByTestId("admin-confirm-go").click();
    await expect(page.getByTestId("admin-notice")).toContainText("Access restored.");
    await expect(row.getByTestId("admin-user-status")).toContainText("Active");

    await login(dave, "dave@boolaa.test");
    await expect(dave).toHaveURL(/\/home$/);
    await daveCtx.close();
  });
});
