import { expect, test } from "@playwright/test";
import { bubbleChip, deleteUsers, register, serviceRoleKey, throwaway } from "./helpers";

/**
 * Register -> create bubble -> join request -> approval -> leave, with two throwaway users.
 * Needs the local service-role key to delete those auth users afterwards; skipped without it.
 */
const KEY = serviceRoleKey();
const RUN = Date.now().toString(36);
const owner = throwaway("Owner", RUN);
const joiner = throwaway("Joiner", RUN);

test.skip(!KEY, "SUPABASE_SERVICE_ROLE_KEY not available for cleanup");

test.afterAll(async () => {
  if (KEY) await deleteUsers(KEY, [owner.email, joiner.email]);
});

test("register, create bubble, request to join, approve, leave", async ({ browser }) => {
  const bubbleName = `E2E bubble ${RUN}`;

  // Owner creates a bubble and lands in it.
  const a = await register(browser, owner);
  await a.locator("#bubble-name").fill(bubbleName);
  await a.locator("#bubble-desc").fill("Created by the flows test");
  await a.locator('form:has(#bubble-name) button[type="submit"]').click();
  await expect(a).toHaveURL(/\/home$/);
  await expect(bubbleChip(a, bubbleName)).toHaveAttribute("aria-pressed", "true");
  await a.getByTestId("sidebar").getByTestId("nav-settings").click();
  await expect(a.getByTestId("settings")).toHaveAttribute("data-live", "true");
  const code = (await a.getByTestId("invite-code").textContent())!.trim();
  expect(code).toMatch(/^[2-9A-HJKMNP-Z]{10}$/); // generate_invite_code (20261123140000)

  // Profile sheet: rename.
  await a.getByTestId("profile-button").click();
  const sheet = a.getByRole("dialog");
  await expect(sheet.locator("#profile-email")).toHaveValue(owner.email);
  await sheet.locator("#profile-name").fill("E2E Owner Renamed");
  await sheet.locator('button[type="submit"]').click();
  await expect(a.getByRole("dialog")).toHaveCount(0);

  // Joiner asks to join and sees the pending screen.
  const b = await register(browser, joiner);
  await expect(b.getByTestId("onboarding")).toHaveAttribute("data-live", "true");
  await b.getByTestId("tab-join").click();
  await b.locator("#invite-code").fill(code);
  await b.locator('form:has(#invite-code) button[type="submit"]').click();
  await expect(b.getByTestId("pending-list")).toContainText(bubbleName);

  // Owner approves (1 of 1 members -> majority); the request shows up live and the joiner's pending
  // screen lets them in through realtime, without reloading.
  const req = a.getByTestId("join-request").filter({ hasText: joiner.name });
  await expect(req).toContainText("0 of 1 approval");
  await req.getByTestId("approve").click();
  await expect(a.getByTestId("notice")).toContainText(joiner.name);
  await expect(b).toHaveURL(/\/home$/, { timeout: 20_000 });

  // Joiner leaves (confirmation step) and is sent back to onboarding.
  await b.goto("/settings");
  await b.getByTestId("leave-bubble").click();
  await b.getByTestId("leave-confirm").click();
  await expect(b).toHaveURL(/\/onboarding$/);
});
