import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { login, newSession, selectBubble } from "./helpers";

type Messages = { [k: string]: string | Messages };
const load = (l: string) => JSON.parse(readFileSync(path.join(__dirname, "..", "messages", `${l}.json`), "utf8")) as Messages;
const flatten = (m: Messages, p = ""): [string, string][] =>
  Object.entries(m).flatMap(([k, v]) => (typeof v === "string" ? [[`${p}${k}`, v]] : flatten(v, `${p}${k}.`)));

const en = new Map(flatten(load("en")));
const OTHER_LOCALES = ["ro", "fr", "es", "it"] as const;

/** Visible text plus accessible strings (aria-label, placeholder, title, alt) of the visible page. */
async function pageStrings(page: Page) {
  return page.evaluate(() => {
    const visible = (el: Element) => !!(el as HTMLElement).offsetParent || el.getClientRects().length > 0;
    const attrs = [...document.querySelectorAll("[aria-label],[placeholder],[title],img[alt]")]
      .filter(visible)
      .flatMap((el) => ["aria-label", "placeholder", "title", "alt"].map((a) => el.getAttribute(a) ?? ""));
    return [document.body.innerText, document.title, ...attrs].join("\n");
  });
}

test("Accept-Language picks the locale when there is no cookie; the cookie wins over it", async ({ browser }) => {
  const ctx = await browser.newContext({ locale: "fr-FR" });
  const page = await ctx.newPage();
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.locator('form button[type="submit"]')).toHaveText("Se connecter");

  // Compact picker on the auth screen: switch to Italian, persisted in the cookie.
  await page.getByTestId("locale-select").selectOption("it");
  await expect(page.locator("html")).toHaveAttribute("lang", "it");
  await expect(page.locator('form button[type="submit"]')).toHaveText("Accedi");
  expect((await ctx.cookies()).find((c) => c.name === "boolaa_locale")?.value).toBe("it");
  await page.goto("/register");
  await expect(page.locator('form button[type="submit"]')).toHaveText("Crea account");
  await ctx.close();

  const unknown = await browser.newContext({ locale: "de-DE" });
  const p2 = await unknown.newPage();
  await p2.goto("/login");
  await expect(p2.locator("html")).toHaveAttribute("lang", "en");
  await unknown.close();
});

test("switching to Romanian in the profile sheet translates the shell, survives reload, keeps the session", async ({
  page,
}) => {
  await login(page, "alice@boolaa.test");
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await selectBubble(page, "Flatmates");

  await page.getByTestId("profile-button").click();
  await page.getByTestId("locale-picker").getByRole("radio", { name: "Română" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ro");
  await expect(page.getByRole("dialog")).toContainText("Limbă");
  await page.keyboard.press("Escape");

  const expectRomanianShell = async () => {
    await expect(page.locator("html")).toHaveAttribute("lang", "ro");
    const sidebar = page.getByTestId("sidebar");
    // Tab labels exactly as in the glossary.
    await expect(sidebar.getByTestId("nav-home")).toHaveText("Acasă");
    await expect(sidebar.getByTestId("nav-events")).toHaveText("Evenimente");
    await expect(sidebar.getByTestId("nav-food")).toHaveText("Cercul culinar");
    await expect(sidebar.getByTestId("nav-marketplace")).toHaveText("Piață");
    await expect(sidebar.getByTestId("nav-settings")).toHaveText("Setări");
    await expect(sidebar.getByTestId("nav-links")).toHaveText("Linkuri");
    await expect(page.getByTestId("page-title")).toHaveText("Acasă");
    await expect(page.getByTestId("tab-food")).toHaveAttribute("aria-label", "Cercul culinar");
    await expect(page).toHaveTitle("Acasă · Boolaa");
  };
  await expectRomanianShell();

  await page.reload();
  await expect(page).toHaveURL(/\/home$/); // still signed in, not bounced to /login
  await expectRomanianShell();
  await expect(page.getByTestId("feed-card").first()).toBeVisible(); // data still loads with the session
});

for (const locale of OTHER_LOCALES) {
  test(`/settings has no untranslated English in ${locale}`, async ({ browser }) => {
    const translated = new Map(flatten(load(locale)));
    // English strings that must not appear: every plain (non-ICU) en value that this locale translates differently.
    const forbidden = [...en]
      .filter(([key, value]) => !/[{}<]/.test(value) && value.length >= 4 && translated.get(key) !== value)
      .map(([, value]) => value);

    const { context, page } = await newSession(browser, "alice@boolaa.test");
    await context.addCookies([{ name: "boolaa_locale", value: locale, url: page.url() }]);
    await page.goto("/settings");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await selectBubble(page, "Flatmates"); // has Carol's pending join request
    await expect(page.getByTestId("join-request")).toBeVisible();
    await expect(page.getByTestId("member-count")).not.toBeEmpty();

    const text = await pageStrings(page);
    const leaks = forbidden.filter((s) => new RegExp(`(^|[^\\p{L}])${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}])`, "u").test(text));
    expect(leaks, `English strings on /settings in ${locale}`).toEqual([]);
    // ICU plurals rendered in the locale (e.g. ro "2 membri din 8", "0 din 2 aprobări").
    await expect(page.getByTestId("member-count")).toHaveText(
      { ro: "2 membri din 8", fr: "2 membres sur 8", es: "2 miembros de 8", it: "2 membri su 8" }[locale],
    );
    await expect(page.getByTestId("approvals-progress")).toHaveText(
      { ro: "0 din 2 aprobări", fr: "0 sur 2 approbations", es: "0 de 2 aprobaciones", it: "0 su 2 approvazioni" }[locale],
    );
    await context.close();
  });
}
