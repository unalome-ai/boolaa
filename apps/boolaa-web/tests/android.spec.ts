import { readFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { ANDROID_CERT_SHA256 } from "../src/lib/app-links";
import { login } from "./helpers";

/**
 * /android (APK download page) and /android/latest.json (the update manifest the Android app polls;
 * its keys are a fixed contract with apps/boolaa-android). The page must show the same values as
 * the file.
 */
const latest = JSON.parse(readFileSync(path.join(__dirname, "..", "public", "android", "latest.json"), "utf8")) as Record<string, unknown>;
const CONTRACT = { versionCode: "number", versionName: "string", minSupported: "number", url: "string", sha256: "string", size: "number", certSha256: "string", released: "string" };

test("/android/latest.json: 200 JSON with the contract keys, short cache, no redirect, no session needed", async ({ request }) => {
  const res = await request.get("/android/latest.json", { maxRedirects: 0 });
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toMatch(/^application\/json/);
  expect(res.headers()["cache-control"]).toBe("public, max-age=300");
  const body = (await res.json()) as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(Object.keys(CONTRACT).sort());
  for (const [key, type] of Object.entries(CONTRACT)) expect(typeof body[key], key).toBe(type);
  expect(body.url).toMatch(/^https:\/\/.+\.apk$/);
  expect(body.released).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(body.minSupported as number).toBeLessThanOrEqual(body.versionCode as number);
  // Same release certificate as the App Links file (assetlinks.json).
  expect(ANDROID_CERT_SHA256).toContain(body.certSha256);
});

test("signed out: /android shows the download, version, requirements and both fingerprints", async ({ page }) => {
  await page.goto("/android?lang=en");
  await expect(page).toHaveURL(/\/android\?lang=en$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Boolaa for Android");
  await expect(page).toHaveTitle("Download Boolaa for Android");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://boolaa.ro/android?lang=en");

  await expect(page.getByTestId("android-download")).toHaveAttribute("href", latest.url as string);
  await expect(page.getByTestId("android-download")).toHaveText("Download for Android");
  await expect(page.getByTestId("android-version")).toContainText(`Version ${latest.versionName}`);
  await expect(page.getByTestId("android-requires")).toHaveText("Requires Android 8.0 or newer");
  if (latest.size === 0) await expect(page.getByTestId("android-size")).toHaveCount(0);
  else await expect(page.getByTestId("android-size")).toContainText("MB");

  await expect(page.getByTestId("android-apk-sha256")).toHaveText(latest.sha256 as string);
  await expect(page.getByTestId("android-cert-sha256")).toHaveText(latest.certSha256 as string);
  await expect(page.getByTestId("android-steps").locator("li")).toHaveCount(3);
  await expect(page.getByTestId("android-download-ios")).toContainText("Coming soon");

  // Copy puts the exact value on the clipboard.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByTestId("android-cert-sha256-copy").click();
  await expect(page.getByTestId("android-cert-sha256-copy")).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(latest.certSha256);
});

test("signed in: /android stays open (no redirect into the app)", async ({ page }) => {
  await login(page, "alice@boolaa.test");
  await page.goto("/android");
  await expect(page).toHaveURL(/\/android$/);
  await expect(page.getByTestId("android-download")).toBeVisible();
});

test("/android in every language, with no English left", async ({ page }) => {
  const titles = { ro: "Boolaa pentru Android", fr: "Boolaa pour Android", es: "Boolaa para Android", it: "Boolaa per Android" };
  for (const [lang, title] of Object.entries(titles)) {
    await page.goto(`/android?lang=${lang}`);
    await expect(page.locator("html")).toHaveAttribute("lang", lang);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    const text = await page.locator("main").innerText();
    for (const en of ["Download for Android", "How to install", "Requires Android", "Copy", "Why not Google Play", "On iPhone"])
      expect(text, `${lang}: "${en}"`).not.toContain(en);
  }
});

test("landing and invite download buttons link to /android; it is in the sitemap", async ({ page, request }) => {
  await page.goto("/?lang=en");
  await expect(page.getByTestId("download-android")).toHaveAttribute("href", "/android");
  await page.goto("/join/FLAT2026?lang=en");
  await expect(page.getByTestId("join-download-android")).toHaveAttribute("href", "/android");
  expect(await (await request.get("/sitemap.xml")).text()).toContain("https://boolaa.ro/android</loc>");
});

for (const scheme of ["light", "dark"] as const) {
  test(`/android is axe-clean and reflows at 320 px, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/android?lang=en");
    await expect(page.getByTestId("android-download")).toBeVisible();
    await page.waitForTimeout(700); // entrance animations settle first
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const bad = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });
}
