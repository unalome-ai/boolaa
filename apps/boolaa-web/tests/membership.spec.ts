import { expect, test, type Page } from "@playwright/test";
import { deleteUsers, register, serviceRoleKey, throwaway } from "./helpers";

/**
 * Live membership with three throwaway users in a bubble of 2:
 *  - a pending screen lets the requester in as soon as the request is approved (realtime, no reload)
 *  - in a full bubble a majority-approved request waits "for a free spot"
 *  - when the owner leaves, ownership passes on and the waiting request is admitted automatically
 *  - the (new) owner removes a member, who is bounced out live
 * The service-role key is only used to delete the throwaway users afterwards.
 */
const KEY = serviceRoleKey();
const RUN = Date.now().toString(36);
const owner = throwaway("Founder", RUN);
const member = throwaway("Member", RUN);
const joiner = throwaway("Waiter", RUN);
const LIVE = { timeout: 15_000 };

test.skip(!KEY, "SUPABASE_SERVICE_ROLE_KEY not available for cleanup");
test.afterAll(async () => {
  if (KEY) await deleteUsers(KEY, [owner.email, member.email, joiner.email]);
});

const live = (page: Page, testId: string) => expect(page.getByTestId(testId)).toHaveAttribute("data-live", "true");

async function requestToJoin(page: Page, code: string) {
  await page.getByTestId("tab-join").click();
  await page.locator("#invite-code").fill(code);
  await page.locator('form:has(#invite-code) button[type="submit"]').click();
  await expect(page.getByTestId("pending-list")).toBeVisible();
  await live(page, "onboarding");
}

test("live approvals, waiting for a free spot, ownership hand-over and removal", async ({ browser }) => {
  test.setTimeout(120_000);
  const bubbleName = `E2E full ${RUN}`;

  // Owner creates a bubble with room for 2 and keeps Settings open.
  const o = await register(browser, owner);
  await o.locator("#bubble-name").fill(bubbleName);
  await o.locator("#bubble-size").focus();
  await o.keyboard.press("Home"); // range minimum: 2
  await expect(o.locator("#bubble-size")).toHaveValue("2");
  await o.locator('form:has(#bubble-name) button[type="submit"]').click();
  await expect(o).toHaveURL(/\/home$/);
  await o.goto("/settings");
  await live(o, "settings");
  const code = (await o.getByTestId("invite-code").textContent())!.trim();

  // Member asks to join; the request appears live in the owner's Settings; approval lets them in
  // from the pending screen without a reload.
  const m = await register(browser, member);
  await requestToJoin(m, code);
  const mReq = o.getByTestId("join-request").filter({ hasText: member.name });
  await expect(mReq).toBeVisible(LIVE);
  await mReq.getByTestId("approve").click();
  await expect(m).toHaveURL(/\/home$/, LIVE);
  await expect(o.getByTestId("member")).toHaveCount(2, LIVE);
  await expect(o.getByTestId("member-count")).toContainText("2"); // 2 of 2: full

  // A third person asks; both members approve; the bubble is full, so the request waits.
  const j = await register(browser, joiner);
  await requestToJoin(j, code);
  const jReq = o.getByTestId("join-request").filter({ hasText: joiner.name });
  await expect(jReq).toBeVisible(LIVE);
  await jReq.getByTestId("approve").click();
  await expect(jReq.getByTestId("approvals-progress")).toHaveText("1 of 2 approvals", LIVE);
  await expect(jReq.getByTestId("waiting-spot")).toHaveCount(0);
  await m.goto("/settings");
  await live(m, "settings");
  const jReqM = m.getByTestId("join-request").filter({ hasText: joiner.name });
  await jReqM.getByTestId("approve").click();
  await expect(m.getByTestId("notice")).toHaveText("Approved, waiting for a free spot");
  await expect(jReqM.getByTestId("waiting-spot")).toBeVisible(LIVE);
  await expect(jReq.getByTestId("waiting-spot")).toBeVisible(LIVE); // owner's page, live
  await expect(jReq.getByTestId("approvals-progress")).toHaveText("2 of 2 approvals");
  await expect(j).toHaveURL(/\/onboarding$/); // still waiting
  // Member is not the owner (yet): no remove buttons for them.
  await expect(m.getByTestId("remove-member")).toHaveCount(0);
  await expect(o.getByTestId("remove-member")).toHaveCount(1);

  // Owner leaves: ownership passes to the member (live badge), the owner's vote is dropped, and the
  // freed seat admits the waiting request (1 of 1 current members approved) -> joiner lands in /home.
  await o.getByTestId("leave-bubble").click();
  await o.getByTestId("leave-confirm").click();
  await expect(o).toHaveURL(/\/onboarding$/);
  await expect(j).toHaveURL(/\/home$/, LIVE);
  const mRow = m.getByTestId("member").filter({ hasText: member.name });
  await expect(mRow.getByTestId("owner-badge")).toBeVisible(LIVE);
  await expect(m.getByTestId("member").filter({ hasText: owner.name })).toHaveCount(0);
  await expect(m.getByTestId("join-request")).toHaveCount(0, LIVE);

  // The new owner removes the joiner (confirmation dialog); the joiner is bounced out live and,
  // with no other bubble, lands on onboarding.
  await live(j, "app-shell");
  const jRow = m.getByTestId("member").filter({ hasText: joiner.name });
  await expect(jRow).toBeVisible(LIVE);
  await jRow.getByTestId("remove-member").click();
  await expect(m.getByRole("dialog")).toContainText(joiner.name);
  await m.getByTestId("remove-confirm").click();
  await expect(m.getByTestId("notice")).toContainText(joiner.name);
  await expect(jRow).toHaveCount(0);
  await expect(j).toHaveURL(/\/onboarding$/, LIVE);

  for (const p of [o, m, j]) await p.context().close();
});

test("a removed member with another bubble is moved to it live, with a notice", async ({ browser }) => {
  const run = `${RUN}b`;
  const a = throwaway("Host", run);
  const b = throwaway("Guest", run);
  try {
    const host = await register(browser, a);
    await host.locator("#bubble-name").fill(`E2E shared ${run}`);
    await host.locator('form:has(#bubble-name) button[type="submit"]').click();
    await expect(host).toHaveURL(/\/home$/);
    await host.goto("/settings");
    await live(host, "settings");
    const code = (await host.getByTestId("invite-code").textContent())!.trim();

    // Guest has a bubble of their own, then joins the host's and switches to it.
    const guest = await register(browser, b);
    await guest.locator("#bubble-name").fill(`E2E own ${run}`);
    await guest.locator('form:has(#bubble-name) button[type="submit"]').click();
    await expect(guest).toHaveURL(/\/home$/);
    await guest.goto("/onboarding");
    await requestToJoin(guest, code);
    await host.getByTestId("join-request").filter({ hasText: b.name }).getByTestId("approve").click();
    await expect(guest).toHaveURL(/\/home$/, LIVE);
    await expect(guest.getByTestId("bubble-switcher").getByRole("button", { name: `E2E shared ${run}`, exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await live(guest, "app-shell");

    await host.getByTestId("member").filter({ hasText: b.name }).getByTestId("remove-member").click();
    await host.getByTestId("remove-confirm").click();
    const own = guest.getByTestId("bubble-switcher").getByRole("button", { name: `E2E own ${run}`, exact: true });
    await expect(own).toHaveAttribute("aria-pressed", "true", LIVE);
    await expect(guest.getByTestId("bubble-switcher").getByRole("button", { name: `E2E shared ${run}`, exact: true })).toHaveCount(0);
    await expect(guest.getByTestId("lost-bubble")).toContainText(`E2E shared ${run}`);
  } finally {
    if (KEY) await deleteUsers(KEY, [a.email, b.email]);
  }
});
