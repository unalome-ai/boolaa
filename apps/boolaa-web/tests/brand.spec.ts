import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { login, selectBubble } from "./helpers";
import { over, ratio, type RGB } from "../src/lib/contrast";
import {
  BAND,
  CHAT_ORB_ALPHA,
  CHAT_PANEL_ALPHA,
  DOCK_GLASS,
  HUE_TOKENS,
  SURFACES,
  TITLE_GRADIENT,
  WASH,
  gradientStops,
  type Mode,
} from "../src/lib/brand";
import { HUES } from "../src/lib/hue";

/**
 * Brand redesign (docs/design-system.md §8): the contrast of every new text/background pair, that globals.css
 * ships the strengths the ratios were measured with, and the behaviour of the dock, the mascot and the reduced
 * motion fallbacks.
 */

const MODES: Mode[] = ["light", "dark"];
const text = (mode: Mode, hue: (typeof HUES)[number]) => (mode === "light" ? HUE_TOKENS[hue].textLight : HUE_TOKENS[hue].textDark);

test.describe("contrast of the new pairs (WCAG 2.2 AA)", () => {
  for (const mode of MODES) {
    const S = SURFACES[mode];
    const bands = HUES.map((h) => {
      const band = over(HUE_TOKENS[h].fill, BAND.strength[mode], S.background);
      const circle = BAND.circle[mode];
      const withCircle = over(circle.color === "background" ? S.background : circle.color, circle.alpha, band);
      return [band, withCircle] as RGB[];
    });

    test(`${mode}: ink and inkSecondary on every feature band (incl. its circles)`, () => {
      for (const [band, circle] of bands) {
        expect(ratio(S.ink, band)).toBeGreaterThanOrEqual(7);
        expect(ratio(S.ink, circle)).toBeGreaterThanOrEqual(7);
        expect(ratio(S.inkSecondary, band)).toBeGreaterThanOrEqual(4.5);
        // Dark circles are the background at 40 %: they only raise light text's contrast.
        if (mode === "dark") expect(ratio(S.inkSecondary, circle)).toBeGreaterThanOrEqual(ratio(S.inkSecondary, band));
      }
    });

    test(`${mode}: gradient title, lightest stop on the Home (grape) band is large-text AA`, () => {
      const [band, circle] = bands[HUES.indexOf("grape")];
      for (const stop of TITLE_GRADIENT[mode]) {
        expect(ratio(stop, band)).toBeGreaterThanOrEqual(3);
        expect(ratio(stop, circle)).toBeGreaterThanOrEqual(3);
        expect(ratio(stop, S.background)).toBeGreaterThanOrEqual(4.5);
      }
    });

    test(`${mode}: chat bubbles: onFill on own gradient, ink and links on others' wash`, () => {
      for (const h of HUES) {
        const tok = HUE_TOKENS[h];
        for (const stop of gradientStops(tok)) expect(ratio(tok.onFill, stop), `${h} own`).toBeGreaterThanOrEqual(4.5);
        const wash = over(tok.fill, WASH[mode], S.card);
        expect(ratio(S.ink, wash), `${h} other`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(text(mode, h), wash), `${h} link in other`).toBeGreaterThanOrEqual(4.5);
      }
    });

    test(`${mode}: names, times and "Not sent" over the chat orbs (every name hue over every orb hue)`, () => {
      const panel = over(S.card, CHAT_PANEL_ALPHA, S.background);
      for (const orb of HUES) {
        const under = over(HUE_TOKENS[orb].deep, CHAT_ORB_ALPHA[mode], panel);
        expect(ratio(S.inkSecondary, under)).toBeGreaterThanOrEqual(4.5);
        expect(ratio(S.dangerText, under)).toBeGreaterThanOrEqual(4.5);
        for (const name of HUES) expect(ratio(text(mode, name), under), `${name} over ${orb}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    test(`${mode}: stickers and the active dock pill (onFill on the hue gradient)`, () => {
      for (const h of HUES) for (const stop of gradientStops(HUE_TOKENS[h])) expect(ratio(HUE_TOKENS[h].onFill, stop)).toBeGreaterThanOrEqual(4.5);
    });

    test(`${mode}: inactive dock icons on the glass over any content (UI, 3:1)`, () => {
      const worst = mode === "light" ? "#000000" : "#FFFFFF";
      expect(ratio(S.inkSecondary, over(S.card, DOCK_GLASS[mode], worst))).toBeGreaterThanOrEqual(3);
    });
  }
});

test("globals.css ships the strengths the ratios were measured with", () => {
  const css = readFileSync(path.join(__dirname, "../src/app/globals.css"), "utf8");
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const light = /:root \{\n  --band-a: ([\d.]+%);[\s\S]*?--chat-orb-a: ([\d.]+);[\s\S]*?--glass-a: ([\d.]+%);/.exec(css)!;
  expect([light[1], Number(light[2]), light[3]]).toEqual([pct(BAND.strength.light), CHAT_ORB_ALPHA.light, pct(DOCK_GLASS.light)]);
  // Both dark copies (theme choice and OS setting).
  const dark = [...css.matchAll(/--band-a: ([\d.]+%);\s*--band-circle: color-mix\(in srgb, var\(--app-bg\) 40%, transparent\);\s*--chat-orb-a: ([\d.]+);\s*--glass-a: ([\d.]+%);/g)];
  expect(dark).toHaveLength(2);
  for (const m of dark) expect([m[1], Number(m[2]), m[3]]).toEqual([pct(BAND.strength.dark), CHAT_ORB_ALPHA.dark, pct(DOCK_GLASS.dark)]);
});

/** The visible main page (visited routes stay mounted but hidden). */
const main = (page: Page) => page.locator("main:visible");

test.describe("labelled dock", () => {
  test("the active tab shows its label and is the current page; others are icons", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await login(page, "alice@boolaa.test");
    await page.goto("/events");
    const bar = page.getByTestId("tab-bar");
    await expect(bar).toHaveAttribute("data-compact", "false");
    await expect(page.getByTestId("tab-events")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("tab-events").getByTestId("tab-label")).toHaveText("Events");
    await expect(bar.getByTestId("tab-label")).toHaveCount(1);
    await expect(page.getByTestId("tab-home")).not.toHaveAttribute("aria-current", /.*/);
    await expect(page.getByTestId("tab-home")).toHaveAttribute("aria-label", "Home");
    // The sliding pill covers the active tab.
    const pill = await page.getByTestId("tab-indicator").boundingBox();
    const tab = await page.getByTestId("tab-events").boundingBox();
    expect(Math.abs(pill!.x - tab!.x)).toBeLessThan(2);
    expect(Math.abs(pill!.width - tab!.width)).toBeLessThan(2);
    // Switching moves the current page.
    await page.getByTestId("tab-settings").click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByTestId("tab-settings")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("tab-events")).not.toHaveAttribute("aria-current", /.*/);
    await context.close();
  });

  test("at 390 px the active tab shows its short label on every tab in every language", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await login(page, "alice@boolaa.test");
    for (const lang of ["en", "ro", "fr", "es", "it"]) {
      await context.addCookies([{ name: "boolaa_locale", value: lang, url: test.info().project.use.baseURL! }]);
      for (const key of ["home", "events", "food", "marketplace", "settings"]) {
        await page.goto(`/${key}`);
        await expect(main(page)).toBeVisible();
        const bar = page.getByTestId("tab-bar");
        await expect(bar, `${lang} ${key}`).toHaveAttribute("data-compact", "false");
        await expect(page.getByTestId(`tab-${key}`).getByTestId("tab-label"), `${lang} ${key}`).toBeVisible();
      }
    }
    await context.close();
  });

  test("at 320 px in French the label falls back to the accessible name only", async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 320, height: 640 } });
    await context.addCookies([{ name: "boolaa_locale", value: "fr", url: test.info().project.use.baseURL! }]);
    const page = await context.newPage();
    await login(page, "alice@boolaa.test");
    await page.goto("/events");
    await expect(main(page)).toBeVisible();
    const bar = page.getByTestId("tab-bar");
    await expect(bar).toHaveAttribute("data-compact", "true");
    await expect(bar.getByTestId("tab-label")).toHaveCount(0);
    const events = page.getByTestId("tab-events");
    await expect(events).toHaveAttribute("aria-current", "page");
    await expect(events).toHaveAttribute("aria-label", "Agenda");
    // Every tab keeps a target of at least 24 × 24 and nothing scrolls sideways.
    for (const box of await bar.getByRole("link").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
      expect(box.width).toBeGreaterThanOrEqual(24);
      expect(box.height).toBeGreaterThanOrEqual(24);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await context.close();
  });
});

test("feature band takes the tab's colour; chat takes the bubble's", async ({ page }) => {
  await login(page, "alice@boolaa.test");
  await selectBubble(page, "Climbing Crew");
  const band = page.getByTestId("feature-band");
  for (const [path, hue] of [["/home", "grape"], ["/events", "coral"], ["/food", "tangerine"], ["/marketplace", "mint"], ["/links", "sky"], ["/settings", "indigo"], ["/chat", "tangerine"]]) {
    await page.goto(path);
    await expect(band).toHaveAttribute("data-hue", hue);
  }
});

test("chat: your messages wear the bubble's hue, others wear their own", async ({ page }) => {
  await login(page, "alice@boolaa.test");
  for (const [bubble, hue] of [["Flatmates", "sky"], ["Climbing Crew", "tangerine"]] as const) {
    await selectBubble(page, bubble);
    await page.goto("/chat");
    const list = page.getByTestId("chat-list");
    await expect(list.getByTestId("chat-message").first()).toBeVisible();
    const mine = list.locator('[data-testid="chat-bubble"].msg-mine');
    if (await mine.count()) await expect(mine.first()).toHaveAttribute("data-hue", hue);
    // Bob (pink) wrote in both seeded bubbles.
    const bob = list.locator('[data-testid="chat-bubble"].msg-other[data-hue="pink"]');
    await expect(bob.first()).toBeVisible();
  }
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("mascot, chat orbs, dock pill and floating orbs stand still", async ({ page }) => {
    await login(page, "alice@boolaa.test");
    await page.goto("/events");
    await expect(main(page)).toBeVisible();
    await page.getByTestId("search-button").click();
    await page.getByTestId("search-input").fill("zzqx-nothing-matches");
    const mascot = page.getByRole("dialog").getByTestId("mascot");
    await expect(mascot).toBeVisible();
    const moving = await mascot.evaluate((root) =>
      [root, ...root.querySelectorAll("*")].map((el) => getComputedStyle(el).animationName).filter((n) => n !== "none"),
    );
    expect(moving).toEqual([]);
    await page.keyboard.press("Escape");
    const transition = await page.getByTestId("tab-indicator").evaluate((el) => getComputedStyle(el).transitionProperty);
    expect(transition).not.toMatch(/transform|width/);
    await page.goto("/chat");
    await expect(page.getByTestId("chat-orbs")).toBeAttached();
    const orbs = await page.getByTestId("chat-orbs").evaluate((root) =>
      [...root.querySelectorAll("*")].map((el) => getComputedStyle(el).animationName).filter((n) => n !== "none"),
    );
    expect(orbs).toEqual([]);
  });
});

test.describe("mascot", () => {
  test("empty states are curious, failed loads worried, offline sleepy", async ({ page, context }) => {
    await login(page, "alice@boolaa.test");
    await selectBubble(page, "Flatmates");
    // Empty search: curious.
    await page.getByTestId("search-button").click();
    await page.getByTestId("search-input").fill("zzqx-nothing-matches");
    await expect(page.getByRole("dialog").getByTestId("mascot")).toHaveAttribute("data-expression", "curious");
    await page.keyboard.press("Escape");
    // The server answers with an error (online): worried.
    await page.route("**/rest/v1/shared_links*", (route) => route.fulfill({ status: 500, body: "{}" }));
    await page.goto("/links");
    await expect(main(page).getByTestId("load-error").getByTestId("mascot")).toHaveAttribute("data-expression", "worried");
    // The connection drops while it's showing: sleepy.
    await context.setOffline(true);
    await expect(main(page).getByTestId("load-error").getByTestId("mascot")).toHaveAttribute("data-expression", "sleepy");
    await context.setOffline(false);
    await page.unroute("**/rest/v1/shared_links*");
  });

  test("never appears on safety surfaces", async ({ page }) => {
    await login(page, "alice@boolaa.test");
    await selectBubble(page, "Flatmates");
    await page.goto("/chat");
    // Report dialog (from Bob's message).
    const bobs = page.getByTestId("chat-message").filter({ has: page.locator('.msg-other[data-hue="pink"]') }).first();
    await bobs.getByTestId("safety-menu").click();
    await page.getByTestId("report").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("data-calm", "true");
    await expect(dialog.getByTestId("mascot")).toHaveCount(0);
    await page.keyboard.press("Escape");
    // Delete account panel.
    await page.getByTestId("profile-button").click();
    await page.getByTestId("delete-account").click();
    const panel = page.getByTestId("delete-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("data-calm", "true");
    await expect(panel.getByTestId("mascot")).toHaveCount(0);
    // And the guard itself: a mascot placed inside a calm surface is not drawn.
    const hidden = await panel.evaluate((el) => {
      const probe = document.createElement("span");
      probe.className = "mascot";
      el.appendChild(probe);
      const display = getComputedStyle(probe).display;
      probe.remove();
      return display;
    });
    expect(hidden).toBe("none");
  });
});
