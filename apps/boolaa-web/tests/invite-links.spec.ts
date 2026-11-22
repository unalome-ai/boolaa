import { expect, test } from "@playwright/test";
import { apiUser, deleteUsers, login, PASSWORD, serviceRoleKey, throwaway } from "./helpers";

/**
 * Invite links (supabase/migrations/20261123140000_invite_links.sql, docs/boolaa-spec.md "Invite
 * links"): /join/CODE for signed-out, new, pending and member visitors, rotation by the owner, and
 * the universal-link / App Links files. Throwaway users only; the service-role key only deletes them.
 */
const KEY = serviceRoleKey();
const RUN = Date.now().toString(36);
const owner = throwaway("InvOwner", RUN);
const guest = throwaway("InvGuest", RUN);
const fresh = throwaway("InvFresh", RUN);

test.afterAll(async () => {
  if (KEY) await deleteUsers(KEY, [owner.email, guest.email, fresh.email]);
});

test.describe("app link files", () => {
  test("apple-app-site-association claims /join/* for the iOS app, as JSON, without redirects", async ({ request }) => {
    const res = await request.get("/.well-known/apple-app-site-association", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/json");
    const body = await res.json();
    expect(body.applinks.details).toEqual([
      { appIDs: ["W5WKF2N472.ro.boolaa.app"], components: [{ "/": "/join/*", comment: "Invite links" }] },
    ]);
  });

  test("assetlinks.json names ro.boolaa.app and the release certificate", async ({ request }) => {
    const res = await request.get("/.well-known/assetlinks.json", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/json");
    const [entry] = await res.json();
    expect(entry.relation).toEqual(["delegate_permission/common.handle_all_urls"]);
    expect(entry.target.package_name).toBe("ro.boolaa.app");
    expect(entry.target.sha256_cert_fingerprints).toEqual([
      "4F:65:12:5D:BF:81:83:E7:10:10:56:2D:86:0C:E6:34:6E:AA:7C:C3:B5:28:4B:97:D0:F0:63:2C:82:8E:D9:C4",
    ]);
  });

  test("signed-in visitors get the same files (no auth redirect)", async ({ page }) => {
    await login(page, "alice@boolaa.test");
    const res = await page.request.get("/.well-known/apple-app-site-association", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
  });
});

test.describe("/join/CODE", () => {
  test.skip(!KEY, "SUPABASE_SERVICE_ROLE_KEY not available for cleanup");

  test("signed out in every language: generic invite, no bubble details, sign-in keeps the code", async ({ page }) => {
    const titles = { en: "You've got an invite", ro: "Ai o invitație", fr: "Tu as une invitation", es: "Tienes una invitación", it: "Hai un invito" };
    for (const [lang, title] of Object.entries(titles)) {
      await page.goto(`/join/FLAT2026?lang=${lang}`);
      await expect(page.getByTestId("join-signed-out")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
      await expect(page.getByText("Flatmates")).toHaveCount(0); // name only after sign-in
    }
    await expect(page.getByTestId("join-sign-in")).toHaveAttribute("href", "/login?next=%2Fjoin%2FFLAT2026");
    await expect(page.getByTestId("join-register")).toHaveAttribute("href", "/register?next=%2Fjoin%2FFLAT2026");
    await expect(page.getByTestId("join-download-ios")).toBeVisible();
    await expect(page.getByTestId("join-download-android")).toBeVisible();
  });

  test("new user: register from the link, back on the preview, request, then pending", async ({ browser }) => {
    test.setTimeout(120_000);
    const name = `E2E invite ${RUN}`;
    const o = await apiUser(owner);
    const { data: bubble, error } = await o.sb.rpc("create_bubble", { p_name: name, p_description: "private notes", p_max_size: 12 });
    expect(error).toBeNull();
    const code = bubble!.invite_code;

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    // Lower-case and dashed, as someone might type it: normalised to the code.
    await page.goto(`/join/${code.slice(0, 5).toLowerCase()}-${code.slice(5).toLowerCase()}`);
    await page.getByTestId("join-register").click();
    await expect(page).toHaveURL(/\/register\?next=/);
    await page.locator("#name").fill(fresh.name);
    await page.locator("#email").fill(fresh.email);
    await page.locator("#password").fill(PASSWORD);
    await page.locator("#age-confirm").check();
    await page.locator('form button[type="submit"]').click();
    await expect(page).toHaveURL(new RegExp(`/join/${code}$`));

    const preview = page.getByTestId("join-preview");
    await expect(preview).toHaveAttribute("data-status", "open");
    await expect(page.getByTestId("join-bubble-name")).toHaveText(name);
    await expect(page.getByText("private notes")).toHaveCount(0); // no description for non-members

    await page.getByTestId("join-request").click();
    await expect(preview).toHaveAttribute("data-status", "pending");
    await expect(page.getByTestId("join-pending")).toBeVisible();
    // Still needs the members' vote: the owner sees the request, the newcomer is not a member.
    const { data: reqs } = await o.sb.from("join_requests").select("user_id").eq("bubble_id", bubble!.id);
    expect(reqs).toHaveLength(1);

    // Opening the link again shows "already asked".
    await page.reload();
    await expect(page.getByTestId("join-preview")).toHaveAttribute("data-status", "pending");
    await page.getByTestId("join-view-pending").click();
    await expect(page.getByTestId("pending-list")).toContainText(name);
    await ctx.close();
  });

  test("existing user: sign in from the link; members get 'Open bubble'; owner rotation kills the link", async ({ browser }) => {
    test.setTimeout(120_000);
    const name = `E2E rotate ${RUN}`;
    const o = await apiUser(owner);
    await apiUser(guest);
    const { data: bubble } = await o.sb.rpc("create_bubble", { p_name: name, p_description: "", p_max_size: 12 });
    const code = bubble!.invite_code;

    // Guest, signed out, follows the link and signs in.
    const gCtx = await browser.newContext();
    const g = await gCtx.newPage();
    await g.goto(`/join/${code}`);
    await g.getByTestId("join-sign-in").click();
    await g.locator("#email").fill(guest.email);
    await g.locator("#password").fill(PASSWORD);
    await g.locator('form button[type="submit"]').click();
    await expect(g).toHaveURL(new RegExp(`/join/${code}$`));
    await expect(g.getByTestId("join-preview")).toHaveAttribute("data-status", "open");

    // The owner sees "member" and opens the bubble.
    const oCtx = await browser.newContext();
    const op = await oCtx.newPage();
    await login(op, owner.email);
    await op.goto(`/join/${code}`);
    await expect(op.getByTestId("join-preview")).toHaveAttribute("data-status", "member");
    await op.getByTestId("join-open").click();
    await expect(op).toHaveURL(/\/home$/);

    // Settings shows the link; the owner rotates the code.
    await op.goto("/settings");
    const settings = op.getByTestId("settings");
    await expect(settings.getByTestId("invite-link")).toHaveText(new RegExp(`/join/${code}$`));
    await settings.getByTestId("rotate-invite").click();
    await op.getByTestId("rotate-confirm").click();
    await expect(settings.getByTestId("invite-link")).not.toHaveText(new RegExp(`/join/${code}$`));
    const next = (await settings.getByTestId("invite-code").textContent())!.trim();
    expect(next).toMatch(/^[23456789A-HJKMNP-Z]{10}$/);
    await expect(settings.getByTestId("invite-link")).toHaveText(new RegExp(`/join/${next}$`));

    // The old link is dead for the guest; the new one works.
    await g.goto(`/join/${code}`);
    await expect(g.getByTestId("join-invalid")).toBeVisible();
    await g.goto(`/join/${next}`);
    await expect(g.getByTestId("join-preview")).toHaveAttribute("data-status", "open");

    // Once admitted, the guest (a plain member) sees and shares the link but can't rotate it.
    await g.getByTestId("join-request").click();
    await expect(g.getByTestId("join-preview")).toHaveAttribute("data-status", "pending");
    const { data: req } = await o.sb.from("join_requests").select("id").eq("bubble_id", bubble!.id).single();
    expect((await o.sb.rpc("approve_join_request", { p_request_id: req!.id })).data).toBe(true);
    await g.goto(`/join/${next}`);
    await expect(g.getByTestId("join-preview")).toHaveAttribute("data-status", "member");
    await g.getByTestId("join-open").click();
    await expect(g).toHaveURL(/\/home$/);
    await g.goto("/settings");
    const gs = g.getByTestId("settings");
    await expect(gs.getByTestId("invite-link")).toHaveText(new RegExp(`/join/${next}$`));
    await expect(gs.getByTestId("copy-invite-link")).toBeVisible();
    await expect(gs.getByTestId("share-invite-link")).toBeVisible();
    await expect(gs.getByTestId("rotate-invite")).toHaveCount(0);
    await gCtx.close();
    await oCtx.close();
  });
});
