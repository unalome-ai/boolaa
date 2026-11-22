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
