import path from "node:path";
import { expect, test } from "@playwright/test";
import { apiUser, bubbleChip, deleteUsers, login, objectExists, publicUrlOf, sameObject, serviceRoleKey, throwaway } from "./helpers";
import { IMAGE_LIMITS } from "../src/lib/image";

/**
 * Bubble photo (supabase/migrations/20261123130000_bubble_cover.sql): the owner adds, replaces and
 * removes it in Settings; a member sees it in the switcher live and can't edit it; replaced and
 * removed files are deleted from `bubble.images/<bubble id>/`.
 * The service-role key is only used to delete the throwaway users afterwards.
 */
const KEY = serviceRoleKey();
const RUN = Date.now().toString(36);
const owner = throwaway("PhotoOwner", RUN);
const mate = throwaway("PhotoMate", RUN);
const guest = throwaway("PhotoGuest", RUN);
const FIXTURE = path.join(__dirname, "fixtures", "item.png");
const LIVE = { timeout: 15_000 };

test.skip(!KEY, "SUPABASE_SERVICE_ROLE_KEY not available for cleanup");
test.afterAll(async () => {
  if (KEY) await deleteUsers(KEY, [owner.email, mate.email, guest.email]);
});

test("bubble photos use the avatar size and limit", () => {
  expect(IMAGE_LIMITS["bubble.images"]).toEqual({ maxSide: 512, maxBytes: 2 * 1024 * 1024 });
});

test("owner adds, replaces and removes the bubble photo; a member sees it live", async ({ browser }) => {
  test.setTimeout(120_000);
  const name = `E2E photo ${RUN}`;
  const a = await apiUser(owner);
  const b = await apiUser(mate);
  const { data: bubble, error } = await a.sb.rpc("create_bubble", { p_name: name, p_description: "", p_max_size: 12 });
  expect(error).toBeNull();
  const { data: req } = await b.sb.rpc("request_to_join", { p_invite_code: bubble!.invite_code });
  expect((await a.sb.rpc("approve_join_request", { p_request_id: req!.id })).data).toBe(true);

  // The member watches the switcher; the fallback is the coloured orb.
  const mCtx = await browser.newContext();
  const m = await mCtx.newPage();
  await login(m, mate.email);
  const mChip = bubbleChip(m, name);
  await expect(mChip).toBeVisible();
  await expect(m.getByTestId("app-shell")).toHaveAttribute("data-live", "true", LIVE);
  await expect(mChip.getByTestId("bubble-chip-photo")).toHaveCount(0);

  const oCtx = await browser.newContext();
  const o = await oCtx.newPage();
  await login(o, owner.email);
  await o.goto("/settings");
  const editor = o.getByTestId("bubble-photo-editor");
  await expect(editor.getByTestId("bubble-photo-fallback")).toBeVisible();

  // Add.
  await editor.getByTestId("bubble-photo-input").setInputFiles(FIXTURE);
  const img = editor.getByTestId("bubble-photo");
  await expect(img).toBeVisible(LIVE);
  const first = (await img.getAttribute("src"))!;
  expect(first).toContain(`/storage/v1/object/sign/bubble.images/${bubble!.id}/`);
  expect(await objectExists(o.request, first)).toBe(true);
  // Private bucket (20261123210000_private_photos.sql): no public URL.
  expect(await objectExists(o.request, publicUrlOf(first))).toBe(false);
  await expect(bubbleChip(o, name).getByTestId("bubble-chip-photo")).toHaveAttribute("src", sameObject(first));
  // The member gets it live, without reloading (their own signed URL for the same object).
  await expect(mChip.getByTestId("bubble-chip-photo")).toHaveAttribute("src", sameObject(first), LIVE);

  // A non-member with the invite link sees the cover on /join/CODE (invite preview grant, signed URL).
  await apiUser(guest);
  const gCtx = await browser.newContext();
  const g = await gCtx.newPage();
  await login(g, guest.email);
  await g.goto(`/join/${bubble!.invite_code}`);
  const cover = g.getByTestId("join-preview").getByTestId("bubble-photo");
  await expect(cover).toHaveAttribute("src", sameObject(first), LIVE);
  await expect.poll(() => cover.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);
  await gCtx.close();

  // Replace: the new file is shown and the old one is deleted.
  await editor.getByTestId("bubble-photo-input").setInputFiles(FIXTURE);
  await expect(img).not.toHaveAttribute("src", sameObject(first), LIVE);
  const second = (await img.getAttribute("src"))!;
  expect(second).toContain(`/bubble.images/${bubble!.id}/`);
  await expect.poll(() => objectExists(o.request, first)).toBe(false);
  await expect(mChip.getByTestId("bubble-chip-photo")).toHaveAttribute("src", sameObject(second), LIVE);

  // A member sees the photo in Settings but gets no controls.
  await m.goto("/settings");
  await expect(m.getByTestId("bubble-photo").filter({ visible: true })).toHaveAttribute("src", sameObject(second));
  await expect(m.getByTestId("bubble-photo-editor")).toHaveCount(0);

  // Remove: back to the fallback everywhere, file gone.
  await editor.getByTestId("bubble-photo-remove").click();
  await expect(editor.getByTestId("bubble-photo-fallback")).toBeVisible(LIVE);
  await expect.poll(() => objectExists(o.request, second)).toBe(false);
  await expect(mChip.getByTestId("bubble-chip-photo")).toHaveCount(0, LIVE);

  await mCtx.close();
  await oCtx.close();
});
