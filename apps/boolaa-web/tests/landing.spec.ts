import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

const LOCALES = ["en", "ro", "fr", "es", "it"] as const;
type Doc = { title: string; sections: { id: string; title: string }[] };
const legal = (l: string) =>
  JSON.parse(readFileSync(path.join(__dirname, "..", "content", "legal", `${l}.json`), "utf8")) as Record<"privacy" | "terms", Doc>;

test("signed-out visitors see the landing page with SEO tags", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("landing")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("cosy bubble");
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /Boolaa/);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /opengraph-image/);
  await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute("href", /icon/);
  await expect(page.locator("footer").getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
  await page.getByTestId("cta-register").click();
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByTestId("terms-consent").getByRole("link")).toHaveCount(2);
  for (const p of ["/robots.txt", "/sitemap.xml"]) expect((await page.request.get(p)).ok()).toBeTruthy();
});

test("signed-in users going to / land in the app", async ({ page }) => {
  await login(page, "alice@boolaa.test");
  await page.goto("/");
  await expect(page).toHaveURL(/\/home$/);
});

for (const l of LOCALES) {
  test(`/privacy and /terms render in ${l} via ?lang=`, async ({ page, context }) => {
    const docs = legal(l);
    for (const kind of ["privacy", "terms"] as const) {
      await page.goto(`/${kind}?lang=${l}`);
      await expect(page.locator("html")).toHaveAttribute("lang", l);
      await expect(page.getByTestId(`legal-${kind}`)).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(docs[kind].title);
      await expect(page.getByTestId("legal-draft")).toBeVisible();
      await expect(page.getByTestId("legal-updated")).toContainText("2026");
      const toc = page.getByRole("navigation").filter({ has: page.locator("#toc-title") }).getByRole("link");
      await expect(toc).toHaveCount(docs[kind].sections.length);
      await expect(page.locator(`section#${docs[kind].sections[0]!.id} h2`)).toContainText(docs[kind].sections[0]!.title);
    }
    expect((await context.cookies()).find((c) => c.name === "boolaa_locale")?.value).toBe(l);
  });
}

test("canonical and Open Graph URLs always use https://boolaa.ro, also when served from www", async ({ request }) => {
  for (const [path, expected] of [
    ["/", /^https:\/\/boolaa\.ro\/?$/],
    ["/login", /^https:\/\/boolaa\.ro\/login$/],
    ["/register", /^https:\/\/boolaa\.ro\/register$/],
    ["/privacy", /^https:\/\/boolaa\.ro\/privacy$/],
    ["/terms", /^https:\/\/boolaa\.ro\/terms$/],
  ] as const) {
    const html = await (await request.get(path, { headers: { host: "www.boolaa.ro", "x-forwarded-host": "www.boolaa.ro" } })).text();
    const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
    const ogUrl = /<meta property="og:url" content="([^"]+)"/.exec(html)?.[1];
    const ogImage = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1];
    expect(canonical, path).toMatch(expected);
    expect(ogUrl, path).toMatch(expected);
    expect(ogImage, path).toMatch(/^https:\/\/boolaa\.ro\/opengraph-image/);
  }
});

test("the landing page switches language from the header menu (keyboard too) and keeps it", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  const header = page.locator("header").first();
  await header.getByTestId("language-button").click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitemradio")).toHaveCount(5);
  await expect(menu.getByRole("menuitemradio", { name: "English" })).toHaveAttribute("aria-checked", "true");
  await menu.getByRole("menuitemradio", { name: "Română" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ro");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("bulă");
  expect((await context.cookies()).find((c) => c.name === "boolaa_locale")?.value).toBe("ro");
  await expect(page).toHaveTitle(/Boolaa/);
  await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute("content", "ro");

  // Keyboard: open with ArrowDown, move to French, Enter.
  // The switch to Romanian re-renders the page (server refresh); under load a key press can land
  // on the old button before the new one is wired up, so retry opening until the menu takes focus.
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(async () => {
    if (await page.getByRole("menu").count()) await page.keyboard.press("Escape");
    await header.getByTestId("language-button").focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitemradio", { name: "Română" })).toBeFocused({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitemradio", { name: "Français" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await header.getByTestId("language-button").click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(header.getByTestId("language-button")).toBeFocused();
});

test("hreflang alternates, ?lang= canonical, and ?lang= winning over the cookie", async ({ page, context }) => {
  await context.addCookies([{ name: "boolaa_locale", value: "it", url: "http://localhost:3100" }]);
  for (const path of ["/", "/login", "/register", "/privacy", "/terms"]) {
    const q = path;
    await page.goto(`${path}?lang=es`);
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `https://boolaa.ro${q}?lang=es`);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", `https://boolaa.ro${q}?lang=es`);
    for (const l of ["en", "ro", "fr", "es", "it"])
      await expect(page.locator(`link[rel="alternate"][hreflang="${l}"]`)).toHaveAttribute("href", `https://boolaa.ro${q}?lang=${l}`);
    await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute("href", new RegExp(`^https://boolaa\\.ro${path === "/" ? "/?" : path}$`));
  }
  // ?lang= was persisted in the cookie, so the plain URL now renders Spanish with a plain canonical.
  expect((await context.cookies()).find((c) => c.name === "boolaa_locale")?.value).toBe("es");
  await page.goto("/privacy");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://boolaa.ro/privacy");
});

test("legal pages name the controller, link the contacts, the licence and the source; the footer credits", async ({ page }) => {
  for (const l of LOCALES) {
    await page.goto(`/privacy?lang=${l}`);
    await expect(page.getByTestId("legal-privacy")).toContainText("Bogdan Raduta");
    await expect(page.getByTestId("legal-privacy").locator('a[href="mailto:privacy@boolaa.ro"]').first()).toBeVisible();
    await expect(page.getByTestId("legal-privacy")).not.toContainText("[");
    await page.goto(`/terms?lang=${l}`);
    await expect(page.locator('#opensource a[href="https://www.apache.org/licenses/LICENSE-2.0"]')).toBeVisible();
    await expect(page.locator('#opensource a[href="https://github.com/unalome-ai/boolaa"]')).toBeVisible();
    await expect(page.getByTestId("legal-terms")).not.toContainText("[");
  }
  await page.goto("/?lang=en");
  await expect(page.getByTestId("made-by")).toContainText("Apache 2.0");
  await expect(page.getByTestId("source-code")).toHaveAttribute("href", "https://github.com/unalome-ai/boolaa");
});

test("the landing shows real app screenshots in the visitor's language and colour scheme, and the downloads", async ({ page }) => {
  for (const [lang, scheme] of [["ro", "dark"], ["en", "light"]] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`/?lang=${lang}`);
    const hero = page.locator('.phone img[fetchpriority="high"]');
    await expect(hero).toHaveCount(1);
    await expect.poll(() => hero.evaluate((img: HTMLImageElement) => (img.complete && img.naturalWidth > 0 ? decodeURIComponent(img.currentSrc) : "")))
      .toContain(`/screens/${lang}/${scheme}/home.webp`);
    // One phone per feature, each with a real description; everything but the hero is lazy.
    await expect(page.locator("#features .phone")).toHaveCount(6);
    await expect(page.locator('#features .phone img:not([alt=""])')).toHaveCount(5);
    await expect(page.locator('.phone img[loading="lazy"]')).toHaveCount((await page.locator(".phone img").count()) - 1);
  }
  // "Open in browser" works today; the store buttons are plain text until the apps are live.
  await expect(page.getByTestId("download-web")).toHaveAttribute("href", "/register");
  for (const id of ["download-ios", "download-android"]) {
    await expect(page.getByTestId(id)).toContainText("Coming soon");
    await expect(page.getByTestId(id)).not.toHaveAttribute("href", /.*/);
  }
});
