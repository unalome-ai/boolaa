import path from "node:path";
import { devices, expect, test } from "@playwright/test";
import { login } from "./helpers";

// "Take photo" next to "Choose from gallery" (docs/boolaa-spec.md, Images → Camera): only on touch
// devices, where `<input capture>` opens the camera; desktop keeps a single chooser. Read-only: nothing
// is posted (the forms are opened and closed).

const FIXTURE = path.join(__dirname, "fixtures", "item.png");

test("touch device: camera buttons with capture inputs on every photo field", async ({ browser }) => {
  test.setTimeout(90_000);
  const ctx = await browser.newContext({ ...devices["Pixel 7"], locale: "en-US" });
  const page = await ctx.newPage();
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
  await login(page, "alice@boolaa.test");

  // Food form (shared ImagePicker): both buttons; the camera input asks for the back camera and feeds the
  // same preview as the gallery.
  await page.goto("/food");
  await page.locator("main").getByTestId("share-food").filter({ visible: true }).click();
  const form = page.getByRole("dialog").filter({ visible: true });
  await expect(form.getByTestId("photo-take")).toBeVisible();
  await expect(form.getByTestId("photo-gallery")).toBeVisible();
  // 44 px touch target (measured once the sheet's entrance animation has settled).
  await expect.poll(async () => (await form.getByTestId("photo-take").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  const camera = form.locator('input[type="file"][capture]');
  await expect(camera).toHaveAttribute("capture", "environment");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), form.getByTestId("photo-take").click()]);
  expect(chooser.element()).toBeTruthy();
  await chooser.setFiles(FIXTURE);
  await expect(form.locator("img")).toBeVisible(); // the preview
  await page.keyboard.press("Escape");

  // Chat: a camera button next to the gallery button.
  await page.goto("/chat");
  const chat = page.locator("main").filter({ visible: true });
  await expect(chat.getByTestId("chat-take-photo")).toBeVisible();
  await expect(chat.getByTestId("chat-camera-input")).toHaveAttribute("capture", "environment");

  // Profile: the avatar uses the front camera.
  await page.getByTestId("profile-button").filter({ visible: true }).click();
  const profile = page.getByRole("dialog").filter({ visible: true });
  await expect(profile.getByTestId("photo-take")).toBeVisible();
  await expect(profile.locator('input[type="file"][capture]')).toHaveAttribute("capture", "user");
  await ctx.close();
});

test("desktop: one photo chooser, no camera button", async ({ browser }) => {
  test.setTimeout(60_000);
  const ctx = await browser.newContext({ locale: "en-US" });
  const page = await ctx.newPage();
  await login(page, "alice@boolaa.test");
  await page.goto("/food");
  await page.locator("main").getByTestId("share-food").filter({ visible: true }).click();
  const form = page.getByRole("dialog").filter({ visible: true });
  await expect(form.locator('input[type="file"]')).toHaveCount(1);
  await expect(form.getByTestId("photo-take")).toHaveCount(0);
  await ctx.close();
});
