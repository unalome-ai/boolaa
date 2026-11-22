// Invite links (migration 20261123140000_invite_links.sql), against the LOCAL stack:
//
//   deno test -A --no-check supabase/tests/invite_links.test.ts
//
// Uses throwaway users and bubbles (never rotates the seeded FLAT2026 / CLIMB123). Never changes
// app_settings flags.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { assert, assertEq, cleanupUsers, client, createUser, sha256Hex, signIn, sql, TEST_DEVICE } from "./helpers.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };

async function person(name: string) {
  const u = await createUser({ name });
  await sql`select public.trust_device(${u.id}::uuid, ${await sha256Hex(TEST_DEVICE)}, 'test')`;
  const c = await signIn(u.email);
  const st = await c.rpc("start_device_check", { p_device_id: TEST_DEVICE });
  assertEq(st.data?.status, "verified", `device check for ${name}`);
  return { ...u, c };
}

type Preview = { bubble_id: string | null; name: string; logo: string | null; member_count: number; max_size: number; status: string };
async function preview(c: SupabaseClient, code: string): Promise<Preview | null> {
  const { data, error } = await c.rpc("get_invite_preview", { p_code: code });
  if (error) throw error;
  return (data as Preview[])[0] ?? null;
}

Deno.test("invite links: preview, request, rotation, throttle", opts, async (t) => {
  const owner = await person("Olga");
  const friend = await person("Fred");
  const stranger = await person("Sam");
  try {
    const { data: bubble, error } = await owner.c.rpc("create_bubble", { p_name: `Invite test ${Date.now()}`, p_description: "secret plans", p_max_size: 3 });
    if (error) throw error;
    const code: string = bubble.invite_code;

    await t.step("new bubbles get a 10-character code without look-alikes", () => {
      assert(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/.test(code), `code ${code}`);
    });

    await t.step("anon cannot call the preview", async () => {
      const { error } = await client().rpc("get_invite_preview", { p_code: code });
      assert(error, "anon must be refused");
    });

    await t.step("a non-member sees name, cover, count and size only", async () => {
      const p = await preview(friend.c, code.toLowerCase().replace(/(.{5})/, "$1-")); // typed loosely
      assert(p, "preview row");
      assertEq(p, { bubble_id: null, name: bubble.name, logo: null, member_count: 1, max_size: 3, status: "open" }, "preview");
      assert(!("description" in p) && !("invite_code" in p), "no description or code");
      // RLS still hides the bubble itself.
      const { data } = await friend.c.from("bubbles").select("id").eq("id", bubble.id);
      assertEq(data, [], "bubbles row hidden");
    });

    await t.step("an unknown code returns no row", async () => {
      assertEq(await preview(friend.c, "ZZZZZZZZZZ"), null, "unknown");
      assertEq(await preview(friend.c, "x"), null, "too short");
    });

    await t.step("the link still needs approval: request -> pending", async () => {
      const { data: jr, error } = await friend.c.rpc("request_to_join", { p_invite_code: code });
      if (error) throw error;
      assertEq(jr.bubble_id, bubble.id, "request bubble");
      assertEq((await preview(friend.c, code))?.status, "pending", "pending status");
      const { count } = await sql`select 1 from public.bubble_members where bubble_id = ${bubble.id} and user_id = ${friend.id} and approved`.then((r) => ({ count: r.length }));
      assertEq(count, 0, "not a member yet");
    });

    await t.step("the owner sees status member and the bubble id", async () => {
      const p = await preview(owner.c, code);
      assertEq([p?.status, p?.bubble_id], ["member", bubble.id], "member");
    });

    await t.step("only the owner can rotate; a member's plain UPDATE of the code is refused", async () => {
      const approve = await sql`select id from public.join_requests where bubble_id = ${bubble.id} and user_id = ${friend.id}`;
      const { data: admitted } = await owner.c.rpc("approve_join_request", { p_request_id: approve[0].id });
      assertEq(admitted, true, "friend admitted by majority (1 of 1)");

      const byMember = await friend.c.rpc("rotate_invite_code", { p_bubble_id: bubble.id });
      assert(/only the owner can change the invite code/.test(byMember.error?.message ?? ""), `member rotate: ${byMember.error?.message}`);

      const upd = await owner.c.from("bubbles").update({ invite_code: "AAAA" }).eq("id", bubble.id);
      // Refused by the column grant (20261123130000) and, behind it, the trigger.
      assert(upd.error && /use rotate_invite_code|permission denied/.test(upd.error.message), `direct update: ${upd.error?.message}`);
      assertEq((await sql`select invite_code from public.bubbles where id = ${bubble.id}`)[0].invite_code, code, "code unchanged");
      const name = await owner.c.from("bubbles").update({ description: "still editable" }).eq("id", bubble.id);
      assert(!name.error, `owner can still edit details: ${name.error?.message}`);
    });

    await t.step("rotation kills the old link at once", async () => {
      const { data: next, error } = await owner.c.rpc("rotate_invite_code", { p_bubble_id: bubble.id });
      if (error) throw error;
      assert(next !== code && /^[23456789A-HJKMNP-Z]{10}$/.test(next), `new code ${next}`);
      assertEq(await preview(stranger.c, code), null, "old code dead");
      const old = await stranger.c.rpc("request_to_join", { p_invite_code: code });
      assert(/invalid invite code/.test(old.error?.message ?? ""), "old code refused");
      assertEq((await preview(stranger.c, next))?.status, "open", "new code works");
    });

    await t.step("a full bubble says so", async () => {
      const third = await person("Tia");
      const { data: b2 } = await owner.c.from("bubbles").select("invite_code").eq("id", bubble.id).single();
      const jr = await third.c.rpc("request_to_join", { p_invite_code: b2!.invite_code });
      if (jr.error) throw jr.error;
      await owner.c.rpc("approve_join_request", { p_request_id: jr.data.id });
      const admitted = await friend.c.rpc("approve_join_request", { p_request_id: jr.data.id });
      assertEq(admitted.data, true, "third admitted");
      assertEq((await preview(stranger.c, b2!.invite_code))?.status, "full", "full");
    });

    await t.step("too many unknown codes in an hour are refused, also for request_to_join", async () => {
      const limit = (await sql`select public.invite_lookup_limit() as n`)[0].n as number;
      await sql`delete from public.invite_lookup_failures where user_id = ${stranger.id}`;
      for (let i = 0; i < limit - 2; i++) assertEq(await preview(stranger.c, `NOPE${i}XYZW`), null, "unknown");
      const { error: e1 } = await stranger.c.rpc("get_invite_preview", { p_code: "NOPEXXXXXX" });
      assert(!e1, "still under the limit");
      const { error: e2 } = await stranger.c.rpc("get_invite_preview", { p_code: "NOPEYYYYYY" });
      assert(!e2, "the last allowed miss");
      const { error: e3 } = await stranger.c.rpc("get_invite_preview", { p_code: "NOPEZZZZZZ" });
      assert(/too many attempts/.test(e3?.message ?? ""), `throttled preview: ${e3?.message}`);
      const { error: e4 } = await stranger.c.rpc("request_to_join", { p_invite_code: "FLAT2026" });
      assert(/too many attempts/.test(e4?.message ?? ""), `throttled request: ${e4?.message}`);
      // Other users are unaffected.
      assert(await preview(friend.c, "FLAT2026"), "friend not throttled");
      // Old misses age out.
      await sql`update public.invite_lookup_failures set at = now() - interval '2 hours' where user_id = ${stranger.id}`;
      const { error: e5 } = await stranger.c.rpc("get_invite_preview", { p_code: "FLAT2026" });
      assert(!e5, "allowed again after an hour");
    });

    await t.step("clients cannot read the failure log", async () => {
      const { error } = await stranger.c.from("invite_lookup_failures").select("*");
      assert(error, "table not readable");
    });
  } finally {
    await sql`delete from public.invite_lookup_failures where user_id in (${owner.id}, ${friend.id}, ${stranger.id})`;
    await cleanupUsers();
  }
});

Deno.test("invite links: teardown", opts, async () => {
  await sql.end();
});
