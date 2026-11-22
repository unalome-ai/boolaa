import { expect, test, type Page } from "@playwright/test";
import { apiUser, deleteUsers, register, serviceRoleKey, throwaway } from "./helpers";

/**
 * Bubble roles (docs/boolaa-spec.md, "Roles"): role badges, the owner's Make admin / Remove admin /
 * Transfer ownership, what an admin can and can't do, and live updates of all of it.
 * Three throwaway users; the service-role key is only used to delete them afterwards.
 */
const KEY = serviceRoleKey();
const RUN = Date.now().toString(36);
const owner = throwaway("Boss", RUN);
const helper = throwaway("Helper", RUN);
const plain = throwaway("Plain", RUN);
const LIVE = { timeout: 15_000 };

test.skip(!KEY, "SUPABASE_SERVICE_ROLE_KEY not available for cleanup");
test.afterAll(async () => {
  if (KEY) await deleteUsers(KEY, [owner.email, helper.email, plain.email]);
});

const live = (page: Page, testId: string) => expect(page.getByTestId(testId)).toHaveAttribute("data-live", "true");
const row = (page: Page, name: string) => page.getByTestId("member").filter({ hasText: name });

test("owner promotes an admin, admin powers, transfer ownership with confirmation, live roles", async ({ browser }) => {
  test.setTimeout(120_000);

  // Owner creates a bubble and keeps Settings open.
  const o = await register(browser, owner);
  await o.locator("#bubble-name").fill(`E2E roles ${RUN}`);
  await o.locator('form:has(#bubble-name) button[type="submit"]').click();
  await expect(o).toHaveURL(/\/home$/);
  await o.goto("/settings");
  await live(o, "settings");
  const code = (await o.getByTestId("invite-code").textContent())!.trim();

  // A plain member joins through the API (1 of 1 approvals).
  const p = await apiUser(plain);
  const { data: pReq, error: pErr } = await p.sb.rpc("request_to_join", { p_invite_code: code });
  expect(pErr).toBeNull();
  await o.getByTestId("join-request").filter({ hasText: plain.name }).getByTestId("approve").click();
  await expect(row(o, plain.name)).toBeVisible(LIVE);
  expect(pReq).toBeTruthy();

  // The future admin joins through the UI (2 of 2 approvals).
  const h = await register(browser, helper);
  await h.getByTestId("tab-join").click();
  await h.locator("#invite-code").fill(code);
  await h.locator('form:has(#invite-code) button[type="submit"]').click();
  await expect(h.getByTestId("pending-list")).toBeVisible();
  const hReq = o.getByTestId("join-request").filter({ hasText: helper.name });
  await expect(hReq).toBeVisible(LIVE);
  await hReq.getByTestId("approve").click();
  const { data: reqs } = await p.sb.from("join_requests").select("id");
  await p.sb.rpc("approve_join_request", { p_request_id: reqs![0].id });
  await expect(h).toHaveURL(/\/home$/, LIVE);

  // As a plain member: no role menu, no remove, no rotate, read-only details.
  await h.goto("/settings");
  await live(h, "settings");
  await expect(h.getByTestId("member")).toHaveCount(3);
  await expect(row(h, owner.name).getByTestId("owner-badge")).toBeVisible();
  await expect(h.getByTestId("role-menu")).toHaveCount(0);
  await expect(h.getByTestId("remove-member")).toHaveCount(0);
  await expect(h.getByTestId("rotate-invite")).toHaveCount(0);
  await expect(h.getByTestId("bubble-photo-editor")).toHaveCount(0);
  // The owner has a role menu on both other members, none on their own row.
  await expect(o.getByTestId("role-menu")).toHaveCount(2);
  await expect(row(o, owner.name).getByTestId("role-menu")).toHaveCount(0);

  // Owner: Make admin. Badge on both pages, live; the admin gains rotate, details and removal of plain members.
  await row(o, helper.name).getByTestId("role-menu").click();
  await o.getByTestId("make-admin").click();
  await expect(o.getByTestId("notice")).toContainText(helper.name);
  await expect(row(o, helper.name).getByTestId("admin-badge")).toBeVisible(LIVE);
  await expect(row(h, helper.name).getByTestId("admin-badge")).toBeVisible(LIVE);
  await expect(h.getByTestId("rotate-invite")).toBeVisible(LIVE);
  await expect(h.getByTestId("bubble-photo-editor")).toBeVisible(LIVE);
  await expect(h.getByTestId("role-menu")).toHaveCount(0); // only the owner changes roles
  await expect(h.getByTestId("remove-member")).toHaveCount(1); // the plain member only, not the owner
  await expect(row(h, plain.name).getByTestId("remove-member")).toBeVisible();
  await expect(row(h, owner.name).getByTestId("remove-member")).toHaveCount(0);
  // The owner can remove the admin and the plain member.
  await expect(o.getByTestId("remove-member")).toHaveCount(2);

  // Owner: Transfer ownership to the admin, after a confirmation that says what they lose.
  await row(o, helper.name).getByTestId("role-menu").click();
  await o.getByTestId("transfer-ownership").click();
  await expect(o.getByRole("dialog")).toContainText(helper.name);
  await expect(o.getByTestId("transfer-body")).toContainText("lose your owner rights");
  await o.getByTestId("transfer-confirm").click();
  await expect(o.getByTestId("notice")).toContainText(helper.name);
  // Exactly one owner; the old owner is now an admin, on both pages, live.
  await expect(row(o, helper.name).getByTestId("owner-badge")).toBeVisible(LIVE);
  await expect(row(o, owner.name).getByTestId("admin-badge")).toBeVisible(LIVE);
  await expect(o.getByTestId("owner-badge")).toHaveCount(1);
  await expect(row(h, helper.name).getByTestId("owner-badge")).toBeVisible(LIVE);
  await expect(row(h, owner.name).getByTestId("admin-badge")).toBeVisible(LIVE);
  await expect(o.getByTestId("role-menu")).toHaveCount(0, LIVE); // lost owner rights
  await expect(o.getByTestId("rotate-invite")).toBeVisible(); // still an admin
  await expect(o.getByTestId("remove-member")).toHaveCount(1); // the plain member only
  await expect(h.getByTestId("role-menu")).toHaveCount(2, LIVE);

  // New owner: Remove admin on the old owner, who loses the admin controls live.
  await row(h, owner.name).getByTestId("role-menu").click();
  await h.getByTestId("remove-admin").click();
  await expect(h.getByTestId("notice")).toContainText(owner.name);
  await expect(row(h, owner.name).getByTestId("admin-badge")).toHaveCount(0, LIVE);
  await expect(o.getByTestId("rotate-invite")).toHaveCount(0, LIVE);
  await expect(o.getByTestId("bubble-photo-editor")).toHaveCount(0, LIVE);
  await expect(o.getByTestId("remove-member")).toHaveCount(0);

  for (const pg of [o, h]) await pg.context().close();
});
