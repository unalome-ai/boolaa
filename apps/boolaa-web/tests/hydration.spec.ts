import { expect, test } from "@playwright/test";
import { PASSWORD, setDeviceId, TEST_DEVICE_ID } from "./helpers";

/**
 * Text typed into the server-rendered auth forms before React hydrates must not be lost
 * (src/lib/form.ts): the scripts are held back until the fields are filled, then released.
 */
async function holdScripts(page: import("@playwright/test").Page) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/_next\/static\/.*\.js(\?.*)?$/, async (route) => {
    await gate;
    await route.continue();
  });
  return release;
}

async function waitForHydration(page: import("@playwright/test").Page, selector: string) {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return !!el && Object.keys(el).some((k) => k.startsWith("__react"));
  }, selector);
}

test("login keeps an email and password typed before hydration", async ({ page }) => {
  await setDeviceId(page, TEST_DEVICE_ID);
  const release = await holdScripts(page);
  await page.goto("/login", { waitUntil: "commit" });
  await page.locator("#email").fill("alice@boolaa.test");
  await page.locator("#password").fill(PASSWORD);
  release();
  await waitForHydration(page, "#email");
  await expect(page.locator("#email")).toHaveValue("alice@boolaa.test");
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/\/(home|onboarding)$/);
});

test("forgot password keeps an email typed before hydration", async ({ page }) => {
  const release = await holdScripts(page);
  await page.goto("/forgot-password", { waitUntil: "commit" });
  await page.locator("#email").fill("nobody-hydration@boolaa.test");
  release();
  await waitForHydration(page, "#email");
  await page.locator('form button[type="submit"]').click();
  // The code step names the address, so the typed value reached the request.
  await expect(page.getByTestId("reset-code")).toBeVisible();
});
