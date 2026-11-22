import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { expect, type APIRequestContext, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
export const PASSWORD = "password123";

/**
 * Local service-role key, used only to delete throwaway auth users after a test (never printed).
 * From SUPABASE_SERVICE_ROLE_KEY or `supabase status`.
 */
export function serviceRoleKey(): string | undefined {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const out = execSync("supabase status -o env", {
      cwd: path.join(__dirname, "../../.."),
      stdio: ["ignore", "pipe", "ignore"],
    });
    return /^SERVICE_ROLE_KEY="?([^"\n]+)"?$/m.exec(out.toString())?.[1];
  } catch {
    return undefined;
  }
}

// Selectors avoid UI text (ids, test ids, roles with user-content names) so the same tests work in
// every locale.

export async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/\/(home|onboarding)$/);
}

export function bubbleChip(page: Page, name: string) {
  return page.getByTestId("bubble-switcher").getByRole("button", { name, exact: true });
}

export async function selectBubble(page: Page, name: string) {
  const chip = bubbleChip(page, name);
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
}

export async function newSession(browser: Browser, email: string, options: BrowserContextOptions = {}) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await login(page, email);
  return { context, page };
}

export type TestUser = { name: string; email: string };

/** Throwaway users get unique names/emails per run: other clients test against the same database. */
export function throwaway(role: string, run: string): TestUser {
  return { name: `E2E ${role} ${run}`, email: `e2e-${role.toLowerCase()}-${run}@boolaa.test` };
}

export async function register(browser: Browser, who: TestUser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/register");
  await page.locator("#name").fill(who.name);
  await page.locator("#email").fill(who.email);
  await page.locator("#password").fill(PASSWORD);
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/onboarding$/);
  return page;
}

/** Deletes exactly these throwaway users (and bubbles they created) with the service-role key. */
export async function deleteUsers(key: string, emails: string[]) {
  const admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const u of data?.users ?? []) {
    if (!u.email || !emails.includes(u.email)) continue;
    await admin.from("bubbles").delete().eq("created_by", u.id);
    await admin.auth.admin.deleteUser(u.id);
  }
}

/** True while a public storage URL still serves the object. */
export async function objectExists(request: APIRequestContext, url: string) {
  const res = await request.get(url, { headers: { "cache-control": "no-cache" } });
  return res.ok();
}
