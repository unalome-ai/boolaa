import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page, type Route } from "@playwright/test";
import { SUPABASE_KEY, SUPABASE_URL, apiUser, deleteUsers, emailCode, login, serviceRoleKey, throwaway, typeCode, waitForEmail } from "./helpers";

/**
 * "Download my data" (docs/boolaa-spec.md "Data export") and the light/dark theme setting.
 *
 * The `data-export` Edge Function is not loaded by the local edge runtime (functions register at
 * stack start, and the shared stack may not be restarted). The browser's call to it is therefore
 * routed here to the real RPC `export_my_data()` with the browser's own JWT, which is what the
 * function does first: the emailed code (real `device-code` + Mailpit), the session-bound proof and
 * the hourly limit are all the server's. The function's own logic is covered in
 * supabase/tests/data_export.test.ts.
 */
const KEY = serviceRoleKey();
const RUN = Date.now().toString(36);
const created: string[] = [];

test.afterAll(async () => {
  if (KEY) await deleteUsers(KEY, created);
});

async function routeExportToRpc(page: Page) {
  await page.route("**/functions/v1/data-export", async (route: Route) => {
    const auth = route.request().headers()["authorization"] ?? "";
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: auth } } });
    const { data, error } = await sb.rpc("export_my_data");
    const msg = error?.message ?? "";
    const fail = (status: number, body: Record<string, unknown>) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (msg.includes("reauthentication required")) return fail(403, { error: "reauthentication_required" });
    if (msg.includes("export rate limited")) return fail(429, { error: "export_rate_limited", retry_after: Number(error?.details) });
    if (error) return fail(500, { error: "server_error" });
    await route.fulfill({
      status: 200,
      contentType: "application/json; charset=utf-8",
      headers: { "content-disposition": `attachment; filename="boolaa-data-${new Date().toISOString().slice(0, 10)}.json"` },
      body: JSON.stringify(data, null, 2),
    });
  });
}

test("download my data: emailed code, JSON file download, then the hourly limit", async ({ page }) => {
  test.skip(!KEY, "SUPABASE_SERVICE_ROLE_KEY not available for cleanup");
  const who = throwaway("Exporter", `${RUN}${test.info().repeatEachIndex}`);
  created.push(who.email);
  const u = await apiUser(who);
  const { data: bubble } = await u.sb.rpc("create_bubble", { p_name: `E2E export ${RUN}`, p_description: "", p_max_size: 12 });
  const secret = `e2e export message ${RUN}`;
  await u.sb.from("chat_messages").insert({ bubble_id: bubble!.id, sender_id: u.id, content: secret });

  await routeExportToRpc(page);
  await login(page, who.email);
  await page.getByTestId("profile-button").click();
  await page.getByTestId("export-data").click();
  const panel = page.getByTestId("export-panel");
  await expect(panel).toContainText("JSON");

  let since = Date.now();
  await panel.getByTestId("export-send").click();
  await expect(panel.getByTestId("export-code-sent")).toBeVisible();
  const download = page.waitForEvent("download");
  await typeCode(page, await emailCode(who.email, since));
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^boolaa-data-\d{4}-\d{2}-\d{2}\.json$/);
  const doc = JSON.parse(await (await file.createReadStream()).toArray().then((c) => Buffer.concat(c).toString("utf8")));
  expect(doc.user_id).toBe(u.id);
  expect(doc.account.email).toBe(who.email);
  expect(doc.chat_messages.map((m: { content: string }) => m.content)).toContain(secret);
  await expect(panel.getByTestId("export-done")).toBeVisible();

  // A second export within the hour: the limit is shown up front, with the time, and no code is emailed.
  await panel.getByRole("button", { name: "Close" }).click();
  since = Date.now();
  await page.getByTestId("export-data").click();
  const again = page.getByTestId("export-panel");
  await expect(again.getByTestId("export-limited")).toContainText(/You can download your data once an hour\. Try again after \d{1,2}:\d{2}/);
  await expect(again.getByTestId("export-send")).toBeDisabled();
  if (process.env.SHOT_DIR) await again.screenshot({ path: `${process.env.SHOT_DIR}/web-export-limited.png` });
  // (The device-code send step refuses an export_data code too: supabase/tests/data_export.test.ts.)
  await page.waitForTimeout(1000);
  await expect(waitForEmail(who.email, since, 1500)).rejects.toThrow();
});

test("theme: the server render carries the chosen theme on every kind of page (no flash)", async ({ browser, baseURL }) => {
  for (const theme of ["dark", "light"] as const) {
    // JavaScript off: what the server sent is what the user sees first.
    const context = await browser.newContext({ javaScriptEnabled: false, colorScheme: theme === "dark" ? "light" : "dark" });
    await context.addCookies([{ name: "boolaa_theme", value: theme, url: baseURL! }]);
    const page = await context.newPage();
    for (const path of ["/", "/login", "/register", "/forgot-password", "/privacy", "/terms", "/join/NOPE2345"]) {
      const res = await page.goto(path);
      const html = (await res!.text()).slice(0, 4000);
      expect(html, path).toMatch(new RegExp(`<html[^>]*data-theme="${theme}"`));
      // The OS says the opposite; the choice wins.
      const bg = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--app-bg").trim() ||
        getComputedStyle(document.documentElement).getPropertyValue("--app-bg").trim());
      expect(bg, `${path} background`).toBe(theme === "dark" ? "#15111f" : "#fbf8ff");
    }
    await context.close();
  }
  // No cookie ("System"): no attribute, the OS decides.
  const context = await browser.newContext({ javaScriptEnabled: false, colorScheme: "dark" });
  const page = await context.newPage();
  const res = await page.goto("/login");
  expect((await res!.text()).slice(0, 4000)).not.toMatch(/<html[^>]*data-theme=/);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--app-bg").trim())).toBe("#15111f");
  await context.close();
});

test("theme: Settings → Appearance applies at once, persists, and System follows the OS", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "light" });
  const page = await context.newPage();
  await login(page, "bob@boolaa.test"); // only reads Settings; posts nothing
  await page.goto("/settings");
  const picker = page.locator("main:visible").getByTestId("theme-picker");
  const bg = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--app-bg").trim());

  await expect(picker.getByRole("radio", { name: "System" })).toHaveAttribute("aria-checked", "true");
  expect(await bg()).toBe("#fbf8ff");

  await picker.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await bg()).toBe("#15111f");
  expect((await context.cookies()).find((c) => c.name === "boolaa_theme")?.value).toBe("dark");

  // Persisted: a reload renders dark straight from the server.
  const res = await page.reload();
  expect((await res!.text()).slice(0, 4000)).toMatch(/<html[^>]*data-theme="dark"/);
  await expect(picker.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");

  await picker.getByRole("radio", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await bg()).toBe("#fbf8ff");

  // System: cookie gone, attribute gone, the OS (dark now) decides.
  await picker.getByRole("radio", { name: "System" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
  expect((await context.cookies()).find((c) => c.name === "boolaa_theme")).toBeUndefined();
  expect(await bg()).toBe("#15111f");
  await context.close();
});

test("theme: the admin view (moderator) renders in the chosen theme", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ colorScheme: "light" });
  await context.addCookies([{ name: "boolaa_theme", value: "dark", url: baseURL! }]);
  const page = await context.newPage();
  await page.addInitScript(() => window.localStorage.setItem("boolaa_device_id", "boolaa-test-device"));
  await login(page, "mod@boolaa.test");
  const res = await page.goto("/admin");
  expect(res!.status()).toBe(200);
  expect((await res!.text()).slice(0, 4000)).toMatch(/<html[^>]*data-theme="dark"/);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--app-bg").trim())).toBe("#15111f");
  await context.close();
});
