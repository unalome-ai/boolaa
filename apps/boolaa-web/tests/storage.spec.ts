import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import EN from "../messages/en.json";
import { jpegInfo } from "../src/lib/image";
import { deleteUsers, objectExists, register, serviceRoleKey, throwaway } from "./helpers";

/**
 * Deleting a food post / market item and replacing a photo removes the old file from storage
 * (owners can SELECT their own objects since the membership_fixes migration, so remove() works).
 * Uses a throwaway user with its own bubble; the service-role key is only used to delete that user.
 */
const KEY = serviceRoleKey();
const RUN = Date.now().toString(36);
const user = throwaway("Storage", RUN);
const FIXTURE = path.join(__dirname, "fixtures", "item.png");
/** 2400x1600 JPEG with EXIF Orientation 6, GPS and camera tags (see images.spec.ts). */
const EXIF_FIXTURE = path.join(__dirname, "fixtures", "exif-gps.jpg");

/** The stored object is a clean JPEG of the expected (upright) size: no EXIF, GPS, XMP or IPTC. */
async function expectCleanJpeg(page: Page, url: string, width: number, height: number) {
  expect(url).toMatch(/\.jpg$/);
  const res = await page.request.get(url);
  expect(res.headers()["content-type"]).toBe("image/jpeg");
  const bytes = await res.body();
  expect(jpegInfo(bytes)).toMatchObject({ width, height, exif: false, gps: false, orientation: false, xmp: false, iptc: false });
  expect(bytes.includes("BoolaaTestCam")).toBe(false);
}

test.skip(!KEY, "SUPABASE_SERVICE_ROLE_KEY not available for cleanup");
test.afterAll(async () => {
  if (KEY) await deleteUsers(KEY, [user.email]);
});

const gone = (page: Page, url: string) => expect.poll(() => objectExists(page.request, url)).toBe(false);

test("old files are removed on delete and on photo replacement", async ({ browser }) => {
  const page = await register(browser, user);
  page.on("dialog", (d) => void d.accept()); // confirm() before deleting
  await page.locator("#bubble-name").fill(`E2E storage ${RUN}`);
  await page.locator('form:has(#bubble-name) button[type="submit"]').click();
  await expect(page).toHaveURL(/\/home$/);

  // Avatar: replacing it deletes the previous upload.
  const avatar = page.getByTestId("profile-button").locator("img");
  await page.getByTestId("profile-button").click();
  // A file the browser can't decode is refused before upload, with the translated error.
  await page
    .getByRole("dialog")
    .locator('input[type="file"]')
    .setInputFiles({ name: "photo.jpg", mimeType: "image/jpeg", buffer: Buffer.from("not really a jpeg") });
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(EN.errors.imageUnsupported);
  await page.getByRole("dialog").locator('input[type="file"]').setInputFiles(FIXTURE);
  await expect(avatar).toHaveAttribute("src", /\/avatars\//);
  const avatar1 = (await avatar.getAttribute("src"))!;
  await page.getByRole("dialog").locator('input[type="file"]').setInputFiles(EXIF_FIXTURE);
  await expect(avatar).not.toHaveAttribute("src", avatar1);
  const avatar2 = (await avatar.getAttribute("src"))!;
  await expectCleanJpeg(page, avatar2, 341, 512); // avatars: long edge 512, upright
  await gone(page, avatar1);
  expect(await objectExists(page.request, avatar2)).toBe(true);
  await page.keyboard.press("Escape");

  // Food post: new photo on edit removes the old one; deleting the post removes the current one.
  await page.goto("/food");
  await page.getByTestId("share-food").click();
  await page.getByRole("dialog").locator('input[type="file"]').setInputFiles(EXIF_FIXTURE);
  await page.locator("#food-desc").fill(`E2E food ${RUN}`);
  await page.getByRole("dialog").locator('button[type="submit"]').click();
  const card = page.getByTestId("food-card").filter({ hasText: `E2E food ${RUN}` });
  const food1 = (await card.locator("img").first().getAttribute("src"))!;
  expect(food1).toContain("/food.images/");
  await expectCleanJpeg(page, food1, 1067, 1600); // long edge 1600, upright
  await card.getByTestId("edit-post").click();
  await page.getByRole("dialog").locator('input[type="file"]').setInputFiles(FIXTURE);
  await page.getByRole("dialog").locator('button[type="submit"]').click();
  await expect(card.locator("img").first()).not.toHaveAttribute("src", food1);
  const food2 = (await card.locator("img").first().getAttribute("src"))!;
  await gone(page, food1);
  await card.getByTestId("delete-post").click();
  await expect(card).toHaveCount(0);
  await gone(page, food2);

  // Market item: deleting it removes its photo.
  await page.goto("/marketplace");
  await page.getByTestId("add-item").click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[type="file"]').setInputFiles(FIXTURE);
  await dialog.locator("#item-title").fill(`E2E item ${RUN}`);
  await dialog.locator('button[type="submit"]').click();
  const item = page.getByTestId("market-item").filter({ hasText: `E2E item ${RUN}` });
  const market = (await item.getByRole("img", { name: `E2E item ${RUN}` }).getAttribute("src"))!;
  expect(await objectExists(page.request, market)).toBe(true);
  await expectCleanJpeg(page, market, 32, 32); // a PNG pick is re-encoded as JPEG, never upscaled
  await item.getByTestId("delete-item").click();
  await expect(item).toHaveCount(0);
  await gone(page, market);
});
