import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { deleteUsers, login, register, selectBubble, serviceRoleKey, throwaway } from "./helpers";

/**
 * Accessibility (docs/boolaa-spec.md, "Accessibility"): axe scans of the main routes in light and dark
 * (fails on serious and critical violations, WCAG 2.2 A/AA rules), plus keyboard checks: the skip link,
 * focus trapping and restore in dialogs, live regions in chat, and reflow at 320 CSS px.
 *
 * The scans use "System" theme with an emulated colour scheme, which is the path most people get.
 */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const KEY = serviceRoleKey();
const RUN = Date.now().toString(36);
const created: string[] = [];

test.afterAll(async () => {
  if (KEY && created.length) await deleteUsers(KEY, created);
});

async function scan(page: Page, where: string, include?: string) {
  // Entrance animations settle first, so colours are measured at their final opacity.
  await page.waitForTimeout(700);
  const builder = new AxeBuilder({ page }).withTags(TAGS);
  if (include) builder.include(include);
  const result = await builder.analyze();
  const bad = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const report = bad.map((v) => `${v.id} (${v.impact}): ${v.help}\n${v.nodes.map((n) => `    ${n.target.join(" ")} ${n.failureSummary?.split("\n")[1] ?? ""}`).join("\n")}`);
  expect.soft(report, `${where}\n${report.join("\n")}`).toEqual([]);
}

/** The visible main page (visited routes stay mounted but hidden). */
const main = (page: Page) => page.locator("main:visible");

for (const scheme of ["light", "dark"] as const) {
  test.describe(`axe, ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    test("signed-out pages", async ({ page }) => {
      for (const path of ["/login", "/register", "/forgot-password", "/privacy"]) {
        await page.goto(path);
        await expect(page.locator("h1").first()).toBeVisible();
        await scan(page, `${scheme} ${path}`);
      }
    });

    test("main routes, profile sheet and a dialog", async ({ page }) => {
      await login(page, "alice@boolaa.test");
      await selectBubble(page, "Flatmates");
      for (const path of ["/home", "/chat", "/events", "/food", "/marketplace", "/links", "/settings"]) {
        await page.goto(path);
        await expect(main(page)).toBeVisible();
        await page.waitForLoadState("networkidle").catch(() => {});
        await scan(page, `${scheme} ${path}`);
      }
      await page.goto("/home");
      await page.getByTestId("profile-button").click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await scan(page, `${scheme} profile sheet`, "[role=dialog]");
      await page.keyboard.press("Escape");
      await page.goto("/events");
      await page.getByTestId("new-event").click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await scan(page, `${scheme} new event dialog`, "[role=dialog]");
    });

    test("onboarding", async ({ browser }) => {
      test.skip(!KEY, "SUPABASE_SERVICE_ROLE_KEY not available for cleanup");
      const who = throwaway(`A11y${scheme}`, RUN);
      created.push(who.email);
      const page = await register(browser, who);
      await page.emulateMedia({ colorScheme: scheme });
      await scan(page, `${scheme} /onboarding`);
      await page.context().close();
    });
  });
}

test("skip link moves focus to the main content", async ({ page }) => {
  await login(page, "alice@boolaa.test");
  await page.goto("/events");
  await expect(main(page)).toBeVisible();
  await page.keyboard.press("Tab");
  const skip = page.getByTestId("skip-link");
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
});

test("dialogs trap focus, close on Escape and give focus back", async ({ page }) => {
  await login(page, "alice@boolaa.test");
  await page.goto("/events");
  const opener = page.getByTestId("new-event");
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // Focus starts inside and never leaves while tabbing forwards or backwards.
  await expect.poll(() => dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  // The page behind is inert while the dialog is open.
  await expect(page.getByTestId("tab-bar").locator("xpath=ancestor-or-self::*[@inert]").first()).toBeAttached();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await expect(page.locator("[inert]")).toHaveCount(0);
});

test("chat: messages read as one unit and new messages are announced", async ({ page }) => {
  await login(page, "alice@boolaa.test");
  await selectBubble(page, "Flatmates");
  await page.goto("/chat");
  const log = page.getByRole("log");
  await expect(log).toBeVisible();
  const first = log.getByTestId("chat-message").first();
  await expect(first).toBeVisible();
  // One labelled group per message: sender, text and time in the name.
  await expect(first).toHaveAttribute("aria-label", /\S+, .+/);
  await expect(page.getByTestId("chat-announcer")).toHaveAttribute("aria-live", "polite");
});

test("reflow at 320 CSS px: no horizontal page scroll on the main routes", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 640 } });
  const page = await context.newPage();
  await login(page, "alice@boolaa.test");
  for (const path of ["/home", "/chat", "/events", "/food", "/marketplace", "/links", "/settings"]) {
    await page.goto(path);
    await expect(main(page)).toBeVisible();
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(0);
  }
  await context.close();
});
