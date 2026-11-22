import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  PASSWORD,
  SUPABASE_KEY,
  SUPABASE_URL,
  TEST_DEVICE_ID,
  adminClient,
  apiUser,
  codeIn,
  deleteUsers,
  emailCode,
  login,
  register,
  serviceRoleKey,
  setDeviceId,
  setFlags,
  throwaway,
  typeCode,
  waitForEmail,
  type Flags,
} from "./helpers";
import { createClient } from "@supabase/supabase-js";

/**
 * Auth security client flows (docs/auth-security.md): sign-up age, forgot password, device codes,
 * trusted devices, revoke, change password with reauthentication, OAuth buttons + callback, and the
 * 16+ screen. Codes are read from the local Mailpit. Flags are switched on per test and restored.
 * Throwaway users only; selectors avoid UI text so the suite works in every locale.
 */
const KEY = serviceRoleKey();
const RUN = Date.now().toString(36);
const created: string[] = [];
const user = (role: string) => {
  const u = throwaway(role, `${RUN}${test.info().repeatEachIndex}`);
  created.push(u.email);
  return u;
};

test.skip(!KEY, "SUPABASE_SERVICE_ROLE_KEY not available (flags, cleanup)");

/**
 * Every test starts from explicit flags and always ends with both OFF, the local default (not
 * "whatever was read": a parallel run of this file could have had them on at that moment).
 */
const OFF: Flags = { device_verification_enforced: false, age_confirmation_required: false };
const flags = (f: Partial<Flags> = {}) => setFlags(KEY!, { ...OFF, ...f });
test.beforeEach(async () => {
  await flags();
});
test.afterEach(async () => {
  await flags();
});
test.afterAll(async () => {
  await flags();
  await deleteUsers(KEY!, created);
});

/** A fresh browser profile (= a new device) with its own device id. */
async function device(browser: Browser, id = `e2e-device-${crypto.randomUUID()}`) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await setDeviceId(page, id);
  return { context, page, id };
}

async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.locator('form button[type="submit"]').click();
}

/** Throwaway user with one bubble, created while the flags are still off. */
async function userWithBubble(role: string) {
  const who = user(role);
  const { sb, id } = await apiUser(who);
  const { error } = await sb.rpc("create_bubble", { p_name: `E2E ${role} ${RUN}` });
  if (error) throw error;
  return { ...who, id };
}

test("sign-up records the age, the terms version and the language", async ({ browser }) => {
  const who = user("Ager");
  const page = await register(browser, who);
  await page.context().close();
  const admin = adminClient(KEY!);
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const u = list.users.find((x) => x.email === who.email)!;
  expect(u.user_metadata).toMatchObject({ name: who.name, locale: "en", age_confirmed: true, terms_version: "2026-11-22" });
  const { data: row } = await admin.from("users").select("age_confirmed_at, terms_version").eq("id", u.id).single();
  expect(row?.age_confirmed_at).toBeTruthy();
  expect(row?.terms_version).toBe("2026-11-22");
});

test("forgot password: email, wrong then right code, new password, signed in", async ({ page }) => {
  const who = user("Forgetful");
  await apiUser(who);
  await page.goto("/login");
  await page.getByTestId("forgot-password").click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await page.locator("#email").fill(who.email);
  const sentAt = Date.now();
  await page.getByTestId("reset-email").locator('button[type="submit"]').click();

  await expect(page.getByTestId("reset-code")).toBeVisible();
  await expect(page.getByTestId("resend-code")).toBeDisabled(); // 60 s cooldown
  await expect(page.locator("#reset-code-input")).toHaveAttribute("autocomplete", "one-time-code");
  await expect(page.locator("#reset-code-input")).toHaveAttribute("inputmode", "numeric");
  const code = await emailCode(who.email, sentAt);

  // Wrong code: shake + clear message, the boxes are emptied for another try.
  const wrong = code === "000000" ? "111111" : "000000";
  await typeCode(page, wrong);
  await expect(page.getByTestId("reset-code").getByRole("alert")).toBeVisible();
  await expect(page.getByTestId("code-digit").first()).toHaveValue("");

  // Paste the right one: fills all six boxes and auto-submits.
  await page.getByTestId("code-digit").nth(2).focus();
  await page.evaluate(async (c) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", ` ${c.slice(0, 3)}-${c.slice(3)} `);
    document.activeElement!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, code);

  await expect(page.getByTestId("reset-password")).toBeVisible();
  const newPassword = `New-${RUN}-pw`;
  await page.locator("#new-password").fill(newPassword);
  await page.getByTestId("reset-password").locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/onboarding$/);

  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  expect((await sb.auth.signInWithPassword({ email: who.email, password: newPassword })).error).toBeNull();
  expect((await sb.auth.signInWithPassword({ email: who.email, password: PASSWORD })).error).not.toBeNull();
});

test("the reset link in the email works too, through /auth/callback", async ({ page }) => {
  const who = user("Linker");
  await apiUser(who);
  await page.goto("/forgot-password");
  await page.locator("#email").fill(who.email);
  const sentAt = Date.now();
  await page.getByTestId("reset-email").locator('button[type="submit"]').click();
  await expect(page.getByTestId("reset-code")).toBeVisible();
  const mail = await waitForEmail(who.email, sentAt);
  const link = /(http:\/\/[^\s]+\/auth\/v1\/verify\?[^\s]+)/.exec(mail.text)?.[1];
  expect(link).toBeTruthy();
  await page.goto(link!);
  await expect(page).toHaveURL(/\/forgot-password\?step=password$/);
  await expect(page.getByTestId("reset-password")).toBeVisible();
});

test("new device: code required when enforcement is on; the trusted device then skips it", async ({ browser }) => {
  const who = await userWithBubble("Traveller");
  await flags({ device_verification_enforced: true });

  const a = await device(browser);
  const sentAt = Date.now();
  await signIn(a.page, who.email);
  await expect(a.page).toHaveURL(/\/verify\?next=%2Fhome$/);
  await expect(a.page.getByTestId("device-code")).toBeVisible();
  await expect(a.page.getByTestId("resend-code")).toBeDisabled();
  const code = await emailCode(who.email, sentAt);

  // An unverified session sees nothing and is kept on the gate.
  await a.page.goto("/home");
  await expect(a.page).toHaveURL(/\/verify\?next=%2Fhome$/);
  // Reload doesn't send a second code within 60 s.
  await expect(a.page.getByTestId("resend-code")).toBeDisabled();

  const wrong = code === "000000" ? "111111" : "000000";
  await typeCode(a.page, wrong);
  await expect(a.page.getByTestId("device-code").getByRole("alert")).toContainText("4");
  await typeCode(a.page, code);
  await expect(a.page).toHaveURL(/\/home$/);
  await expect(a.page.getByTestId("bubble-switcher")).toBeVisible();

  // Same browser profile, new session: trusted, no code.
  await a.context.clearCookies();
  await signIn(a.page, who.email);
  await expect(a.page).toHaveURL(/\/home$/);
  await a.context.close();

  // Seeded logins use the pre-trusted test device and pass straight through.
  const s = await browser.newContext();
  const sp = await s.newPage();
  await login(sp, "alice@boolaa.test");
  await expect(sp).toHaveURL(/\/home$/);
  await s.close();
});

test("revoke a device from 'Your devices': the other device needs a code again", async ({ browser }) => {
  const who = await userWithBubble("Revoker");
  await flags({ device_verification_enforced: true });

  const verifyOn = async (d: Awaited<ReturnType<typeof device>>) => {
    const sentAt = Date.now();
    await signIn(d.page, who.email);
    await expect(d.page.getByTestId("device-code")).toBeVisible();
    await typeCode(d.page, await emailCode(who.email, sentAt));
    await expect(d.page).toHaveURL(/\/home$/);
  };
  const a = await device(browser);
  await verifyOn(a);
  const b = await device(browser);
  await verifyOn(b);

  await a.page.reload();
  await a.page.getByTestId("profile-button").click();
  const rows = a.page.getByTestId("device-row");
  await expect(rows).toHaveCount(2);
  const mine = a.page.locator('[data-testid="device-row"][data-current="true"]');
  await expect(mine.getByTestId("this-device")).toBeVisible();
  await expect(mine.getByTestId("revoke-device")).toHaveCount(0);
  const other = a.page.locator('[data-testid="device-row"]:not([data-current])');
  await other.getByTestId("revoke-device").click();
  await other.getByTestId("revoke-confirm").click();
  await expect(rows).toHaveCount(1);

  // B is not signed out, but sees nothing until it verifies again.
  await b.page.goto("/home");
  await expect(b.page).toHaveURL(/\/verify/);
  await expect(b.page.getByTestId("device-code")).toBeVisible();
  await a.context.close();
  await b.context.close();
});

test("delete account with an emailed code while enforcement is on", async ({ browser }) => {
  const who = await userWithBubble("Deleter");
  await flags({ device_verification_enforced: true });
  const d = await device(browser);
  const signedAt = Date.now();
  await signIn(d.page, who.email);
  await typeCode(d.page, await emailCode(who.email, signedAt));
  await expect(d.page).toHaveURL(/\/home$/);

  await d.page.getByTestId("profile-button").click();
  await d.page.getByTestId("delete-account").click();
  await d.page.getByTestId("delete-word").fill("DELETE");
  const sentAt = Date.now() + 1;
  await d.page.getByTestId("delete-confirm").click();
  await expect(d.page.getByTestId("delete-code-sent")).toBeVisible();
  const code = await emailCode(who.email, sentAt);
  await typeCode(d.page, code === "000000" ? "111111" : "000000");
  await expect(d.page.getByTestId("delete-panel").getByRole("alert")).toBeVisible();
  await typeCode(d.page, code);
  await expect(d.page).toHaveURL(/\/$/);
  const { data } = await adminClient(KEY!).auth.admin.getUserById(who.id);
  expect(data.user).toBeNull();
  await d.context.close();
});

test("change password: reauthenticate, emailed code, new password", async ({ browser }) => {
  const who = await userWithBubble("Rekeyer");
  const d = await device(browser);
  await signIn(d.page, who.email);
  await expect(d.page).toHaveURL(/\/home$/);
  await d.page.getByTestId("profile-button").click();
  await d.page.getByTestId("change-password").click();
  const newPassword = `Changed-${RUN}`;
  await d.page.locator("#new-password").fill(newPassword);
  const sentAt = Date.now();
  await d.page.getByTestId("password-send-code").click();
  const mail = await waitForEmail(who.email, sentAt);
  expect(mail.subject).toMatch(/confirmation code/i);
  await typeCode(d.page, codeIn(mail));
  await expect(d.page.getByTestId("password-changed")).toBeVisible();

  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  expect((await sb.auth.signInWithPassword({ email: who.email, password: newPassword })).error).toBeNull();
  await d.context.close();
});

test("'Your devices' lists this browser as This device (seeded login, flags off)", async ({ page }) => {
  await login(page, "bob@boolaa.test");
  await page.getByTestId("profile-button").click();
  const mine = page.locator('[data-testid="device-row"][data-current="true"]');
  await expect(mine).toHaveCount(1);
  await expect(mine.getByTestId("revoke-device")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("boolaa_device_id"))).toBe(TEST_DEVICE_ID);
});

test("a new browser gets a 32-byte device id, kept across sign-out", async ({ page }) => {
  const who = await userWithBubble("Keeper");
  await signIn(page, who.email);
  await expect(page).toHaveURL(/\/home$/);
  const id = await page.evaluate(() => localStorage.getItem("boolaa_device_id"));
  expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
  await page.getByTestId("profile-button").click();
  await page.getByRole("dialog").locator("button.btn-danger").first().click(); // sign out
  await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate(() => localStorage.getItem("boolaa_device_id"))).toBe(id);
});

for (const provider of ["google", "apple"] as const) {
  for (const path of ["/login", "/register"]) {
    test(`"Continue with ${provider}" on ${path} starts the OAuth redirect`, async ({ page, baseURL }) => {
      await page.route("**/auth/v1/authorize**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<p>provider</p>" }));
      await page.goto(path);
      const button = page.getByTestId(`oauth-${provider}`);
      await expect(button).toBeVisible();
      const request = page.waitForRequest("**/auth/v1/authorize**");
      await button.click();
      const url = new URL((await request).url());
      expect(url.origin).toBe(new URL(SUPABASE_URL).origin);
      expect(url.searchParams.get("provider")).toBe(provider);
      expect(url.searchParams.get("redirect_to")).toBe(`${new URL(baseURL!).origin}/auth/callback`);
      expect(url.searchParams.get("code_challenge")).toBeTruthy(); // PKCE
    });
  }
}

test("/auth/callback without a valid code goes back to sign-in with a message", async ({ page }) => {
  await page.goto("/auth/callback");
  await expect(page).toHaveURL(/\/login\?error=oauth$/);
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  await page.goto("/auth/callback?code=not-a-real-code");
  await expect(page).toHaveURL(/\/login\?error=oauth$/);
  await page.goto("/auth/callback?error=access_denied&error_description=cancelled");
  await expect(page).toHaveURL(/\/login\?error=oauth$/);
  // A suspended / banned account goes to the suspended screen, not back to sign-in.
  await page.goto("/auth/callback?error=access_denied&error_code=user_banned&error_description=User+is+banned");
  await expect(page).toHaveURL(/\/suspended$/);
});

test("16+ screen: an account without age confirmation must confirm before anything else", async ({ browser }) => {
  const who = user("Ageless");
  const admin = adminClient(KEY!);
  // Like an Apple/Google or invited account: no sign-up checkbox, so no age_confirmed_at.
  const { data, error } = await admin.auth.admin.createUser({
    email: who.email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { name: who.name, age_confirmation_deferred: true },
  });
  if (error) throw error;
  await flags({ age_confirmation_required: true });

  const d = await device(browser);
  await signIn(d.page, who.email);
  await expect(d.page.getByTestId("age-screen")).toBeVisible();
  // The proxy keeps the session on the gate.
  await d.page.goto("/onboarding");
  await expect(d.page).toHaveURL(/\/verify\?next=%2Fonboarding$/);
  await expect(d.page.getByTestId("age-screen")).toBeVisible();
  await expect(d.page.getByTestId("age-delete")).toBeVisible();
  const go = d.page.getByTestId("age-continue");
  await expect(go).toBeDisabled();
  await d.page.locator("#age-16").check();
  await expect(go).toBeDisabled();
  await d.page.locator("#age-terms").check();
  await go.click();
  await expect(d.page).toHaveURL(/\/onboarding$/);
  const { data: row } = await admin.from("users").select("age_confirmed_at, terms_version").eq("id", data.user.id).single();
  expect(row?.age_confirmed_at).toBeTruthy();
  expect(row?.terms_version).toBe("2026-11-22");
  await d.context.close();
});

test("16+ screen after a first Google/Apple sign-in, even before the age flag is on", async ({ browser }) => {
  const who = user("Googler");
  const admin = adminClient(KEY!);
  const { data, error } = await admin.auth.admin.createUser({
    email: who.email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { name: who.name, full_name: who.name },
    app_metadata: { provider: "google", providers: ["google"] },
  });
  if (error) throw error;
  const d = await device(browser);
  await signIn(d.page, who.email);
  await expect(d.page.getByTestId("age-screen")).toBeVisible();
  await d.page.locator("#age-16").check();
  await d.page.locator("#age-terms").check();
  await d.page.getByTestId("age-continue").click();
  await expect(d.page).toHaveURL(/\/onboarding$/);
  // Locale stored for emails on the first sign-in.
  const { data: after } = await admin.auth.admin.getUserById(data.user.id);
  expect(after.user?.user_metadata?.locale).toBe("en");
  await d.context.close();
});
