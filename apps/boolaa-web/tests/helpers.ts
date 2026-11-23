import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/database.types";
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

/** Seeded logins (alice, bob, carol) send the pre-trusted local test device id (docs/auth-security.md §2). */
export const TEST_DEVICE_ID = "boolaa-test-device";
const SEEDED = /^(alice|bob|carol)@boolaa\.test$/;

export async function setDeviceId(page: Page, id: string) {
  await page.addInitScript((value) => window.localStorage.setItem("boolaa_device_id", value), id);
}

export async function login(page: Page, email: string) {
  if (SEEDED.test(email)) await setDeviceId(page, TEST_DEVICE_ID);
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
  if (process.env.RT_DEBUG)
    page.on("console", (m) => m.text().startsWith("[rt]") && console.log(`${Date.now() % 100000} ${who.name}: ${m.text()}`));
  await page.goto("/register");
  await page.locator("#name").fill(who.name);
  await page.locator("#email").fill(who.email);
  await page.locator("#password").fill(PASSWORD);
  await page.locator("#age-confirm").check();
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

/** True while a (signed) storage URL still serves the object. */
export async function objectExists(request: APIRequestContext, url: string) {
  const res = await request.get(url, { headers: { "cache-control": "no-cache" } });
  return res.ok();
}

/**
 * `<bucket>/<path>` of a signed (or stored public-form) storage URL. Photos are private
 * (20261123210000_private_photos.sql): each viewer gets their own signed URL, so tests compare paths.
 */
export function storageKey(url: string) {
  const m = /\/storage\/v1\/object\/(?:public|sign)\/([^?#]+)/.exec(url);
  if (!m) throw new Error(`not a storage URL: ${url}`);
  return decodeURIComponent(m[1]);
}

/** The old public URL of the object behind a signed URL (must no longer serve anything). */
export function publicUrlOf(url: string) {
  return `${SUPABASE_URL}/storage/v1/object/public/${storageKey(url)}`;
}

/** A matcher for any signed URL of the same object. */
export function sameObject(url: string) {
  const key = storageKey(url).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("/storage/v1/object/sign/" + key + "\\?token=");
}

/** Signs up (or signs in) a throwaway user through the API and returns their Supabase client. */
export async function apiUser(who: TestUser) {
  const sb = createClient<Database>(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  const up = await sb.auth.signUp({ email: who.email, password: PASSWORD, options: { data: { name: who.name } } });
  if (up.error) {
    const { error } = await sb.auth.signInWithPassword({ email: who.email, password: PASSWORD });
    if (error) throw error;
  }
  const { data } = await sb.auth.getUser();
  return { sb, id: data.user!.id };
}

// ---- Auth security helpers (local stack only) ----------------------------------------------------

export const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:55324";

/** Emails already handed to a test, so a quick second code never returns the previous email. */
const seenMail = new Set<string>();

type MailSummary = { ID: string; Created: string; Subject: string; To: { Address: string }[] };

/** Newest email to `to` created after `since` (ms), polled from Mailpit's API. */
export async function waitForEmail(to: string, since: number, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=20`);
    if (res.ok) {
      const { messages } = (await res.json()) as { messages: MailSummary[] };
      const hit = messages
        .filter((m) => !seenMail.has(m.ID) && new Date(m.Created).getTime() >= since - 1000)
        .sort((a, b) => new Date(b.Created).getTime() - new Date(a.Created).getTime())[0];
      if (hit) {
        seenMail.add(hit.ID);
        const full = await (await fetch(`${MAILPIT}/api/v1/message/${hit.ID}`)).json();
        return { subject: hit.Subject as string, text: String(full.Text ?? ""), html: String(full.HTML ?? "") };
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`no email to ${to} since ${new Date(since).toISOString()}`);
}

/** The 6-digit code from the newest email to `to` sent after `since`. */
export async function emailCode(to: string, since: number) {
  return codeIn(await waitForEmail(to, since));
}

export function codeIn(mail: { subject: string; text: string }) {
  const code = /:\s*(\d{6})\b/.exec(mail.text)?.[1] ?? /\b(\d{6})\b/.exec(mail.text)?.[1];
  if (!code) throw new Error(`no code in "${mail.subject}"`);
  return code;
}

/** Types a code into the six-box input (the first box takes the whole code, like autofill). */
export async function typeCode(page: Page, code: string) {
  const first = page.getByTestId("code-digit").first();
  await first.click();
  await page.keyboard.type(code);
}

export function adminClient(key: string) {
  return createClient<Database>(SUPABASE_URL, key, { auth: { persistSession: false } });
}

export type Flags = { device_verification_enforced: boolean; age_confirmation_required: boolean };

/** Reads and sets the rollout flags (public.app_settings, one row). Tests restore what they read. */
export async function getFlags(key: string): Promise<Flags> {
  const { data, error } = await adminClient(key).from("app_settings").select("device_verification_enforced, age_confirmation_required").eq("id", true).single();
  if (error) throw error;
  return data;
}
export async function setFlags(key: string, flags: Partial<Flags>) {
  const { error } = await adminClient(key).from("app_settings").update({ ...flags, updated_at: new Date().toISOString() }).eq("id", true);
  if (error) throw error;
}
