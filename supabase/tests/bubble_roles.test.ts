// Bubble roles and manual ownership transfer (migration 20261123190000_bubble_roles.sql), against the
// LOCAL stack:
//
//   deno test -A --no-check supabase/tests/bubble_roles.test.ts
//
// Throwaway users and bubbles only (never touches the seeded bubbles). Never changes app_settings.
import type { RealtimeChannel, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { admin, assert, assertEq, cleanupUsers, createUser, sha256Hex, signIn, sleep, sql, TEST_DEVICE, token } from "./helpers.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };

async function person(name: string) {
  const u = await createUser({ name });
  await sql`select public.trust_device(${u.id}::uuid, ${await sha256Hex(TEST_DEVICE)}, 'test')`;
  const c = await signIn(u.email);
  const st = await c.rpc("start_device_check", { p_device_id: TEST_DEVICE });
  assertEq(st.data?.status, "verified", `device check for ${name}`);
  return { ...u, c };
}
type Person = Awaited<ReturnType<typeof person>>;

async function newBubble(owner: Person, maxSize = 10): Promise<string> {
  const { data, error } = await owner.c.rpc("create_bubble", { p_name: `Roles test ${Date.now()}`, p_max_size: maxSize });
  if (error) throw error;
  return data.id;
}

/** Test setup only: seats a member directly, with a membership age so hand-over order is deterministic. */
async function seat(bubbleId: string, p: Person, secondsAgo: number) {
  await sql`insert into public.bubble_members (user_id, bubble_id, approved, role, created_at)
            values (${p.id}, ${bubbleId}, true, 'member', now() - make_interval(secs => ${secondsAgo}))`;
}

async function roles(bubbleId: string): Promise<Record<string, string>> {
  const rows = await sql`select user_id, role from public.bubble_members where bubble_id = ${bubbleId} and approved`;
  return Object.fromEntries(rows.map((r) => [r.user_id as string, r.role as string]));
}

function refused(res: { error: { message: string } | null }, re: RegExp, what: string) {
  assert(res.error && re.test(res.error.message), `${what}: expected ${re}, got ${res.error?.message ?? "success"}`);
}

const rpc = (c: SupabaseClient, fn: string, args: Record<string, unknown>) => c.rpc(fn, args);

Deno.test("bubble roles: set_member_role, admin powers, remove_member limits, transfer_ownership", opts, async (t) => {
  const owner = await person("Olga");
  const ann = await person("Ann");
  const ben = await person("Ben");
  const cat = await person("Cat");
  const stranger = await person("Sam");
  try {
    const bubble = await newBubble(owner);
    await seat(bubble, ann, 300);
    await seat(bubble, ben, 200);
    await seat(bubble, cat, 100);

    await t.step("role check and at most one owner per bubble", async () => {
      const bad = await sql`select 1 from pg_constraint where conname = 'bubble_members_role_check'
                             and pg_get_constraintdef(oid) like '%admin%'`;
      assertEq(bad.length, 1, "check allows admin");
      let err = "";
      try {
        await sql`update public.bubble_members set role = 'owner' where bubble_id = ${bubble} and user_id = ${ann.id}`;
      } catch (e) {
        err = (e as Error).message;
      }
      assert(/bubble_members_one_owner|duplicate key/.test(err), `second owner refused: ${err}`);
    });

    await t.step("clients can't write roles directly", async () => {
      const up = await ann.c.from("bubble_members").update({ role: "owner" }).eq("bubble_id", bubble).eq("user_id", ann.id);
      assert(up.error, "direct update refused");
      const ins = await stranger.c.from("bubble_members").insert({ bubble_id: bubble, user_id: stranger.id, approved: true, role: "owner" });
      assert(ins.error, "direct insert refused");
      assertEq((await roles(bubble))[ann.id], "member", "unchanged");
    });

    await t.step("only the owner changes roles", async () => {
      refused(await rpc(ann.c, "set_member_role", { p_bubble_id: bubble, p_user_id: ben.id, p_role: "admin" }), /only the owner can change roles/, "member promotes");
      refused(await rpc(stranger.c, "set_member_role", { p_bubble_id: bubble, p_user_id: ben.id, p_role: "admin" }), /only the owner can change roles/, "stranger promotes");
      const ok = await rpc(owner.c, "set_member_role", { p_bubble_id: bubble, p_user_id: ann.id, p_role: "admin" });
      assert(!ok.error, `owner promotes: ${ok.error?.message}`);
      assertEq((await roles(bubble))[ann.id], "admin", "ann admin");
      refused(await rpc(ann.c, "set_member_role", { p_bubble_id: bubble, p_user_id: ben.id, p_role: "admin" }), /only the owner can change roles/, "admin promotes");
      refused(await rpc(ann.c, "set_member_role", { p_bubble_id: bubble, p_user_id: owner.id, p_role: "member" }), /only the owner can change roles/, "admin demotes owner");
      refused(await rpc(owner.c, "set_member_role", { p_bubble_id: bubble, p_user_id: ben.id, p_role: "owner" }), /invalid role/, "role owner via set_member_role");
      refused(await rpc(owner.c, "set_member_role", { p_bubble_id: bubble, p_user_id: ben.id, p_role: "boss" }), /invalid role/, "unknown role");
      refused(await rpc(owner.c, "set_member_role", { p_bubble_id: bubble, p_user_id: owner.id, p_role: "member" }), /use transfer_ownership/, "owner demotes self");
      refused(await rpc(owner.c, "set_member_role", { p_bubble_id: bubble, p_user_id: stranger.id, p_role: "admin" }), /member not found/, "non-member");
    });

    await t.step("admins edit details, rotate the code; members don't", async () => {
      assertEq((await rpc(ann.c, "can_manage_bubble", { p_bubble_id: bubble })).data, true, "admin manages");
      assertEq((await rpc(ben.c, "can_manage_bubble", { p_bubble_id: bubble })).data, false, "member doesn't");
      const upd = await ann.c.from("bubbles").update({ description: "set by an admin" }).eq("id", bubble).select("id");
      assert(!upd.error && upd.data?.length === 1, `admin edits: ${upd.error?.message}`);
      const memberUpd = await ben.c.from("bubbles").update({ description: "nope" }).eq("id", bubble).select("id");
      assertEq(memberUpd.data?.length ?? 0, 0, "member edit matches no row");
      const rot = await rpc(ann.c, "rotate_invite_code", { p_bubble_id: bubble });
      assert(!rot.error && /^[A-Z0-9]{10}$/.test(rot.data), `admin rotates: ${rot.error?.message}`);
      refused(await rpc(ben.c, "rotate_invite_code", { p_bubble_id: bubble }), /only the owner can change the invite code/, "member rotates");
      // Storage follows can_manage_bubble: an admin may upload into the bubble's folder.
      const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);
      const up = await ann.c.storage.from("bubble.images").upload(`${bubble}/${crypto.randomUUID()}.jpg`, jpeg, { contentType: "image/jpeg" });
      assert(!up.error, `admin uploads the photo: ${up.error?.message}`);
      const upMember = await ben.c.storage.from("bubble.images").upload(`${bubble}/${crypto.randomUUID()}.jpg`, jpeg, { contentType: "image/jpeg" });
      assert(upMember.error, "member upload refused");
      if (up.data) await admin.storage.from("bubble.images").remove([up.data.path]);
    });

    await t.step("remove_member: admins remove plain members only, members nobody", async () => {
      refused(await rpc(ben.c, "remove_member", { p_bubble_id: bubble, p_user_id: cat.id }), /only the owner can remove members/, "member removes");
      refused(await rpc(ann.c, "remove_member", { p_bubble_id: bubble, p_user_id: owner.id }), /only the owner can remove admins/, "admin removes owner");
      await rpc(owner.c, "set_member_role", { p_bubble_id: bubble, p_user_id: ben.id, p_role: "admin" });
      refused(await rpc(ann.c, "remove_member", { p_bubble_id: bubble, p_user_id: ben.id }), /only the owner can remove admins/, "admin removes admin");
      refused(await rpc(ann.c, "remove_member", { p_bubble_id: bubble, p_user_id: ann.id }), /use leave to remove yourself/, "admin removes self");
      refused(await rpc(ann.c, "remove_member", { p_bubble_id: bubble, p_user_id: stranger.id }), /member not found/, "admin removes stranger");
      const ok = await rpc(ann.c, "remove_member", { p_bubble_id: bubble, p_user_id: cat.id });
      assert(!ok.error, `admin removes member: ${ok.error?.message}`);
      assert(!((await roles(bubble))[cat.id]), "cat gone");
      // Demote, then the owner removes an admin.
      const demote = await rpc(owner.c, "set_member_role", { p_bubble_id: bubble, p_user_id: ben.id, p_role: "member" });
      assert(!demote.error, `owner demotes: ${demote.error?.message}`);
      assertEq((await roles(bubble))[ben.id], "member", "ben member again");
      await seat(bubble, cat, 50);
      await rpc(owner.c, "set_member_role", { p_bubble_id: bubble, p_user_id: cat.id, p_role: "admin" });
      const rmAdmin = await rpc(owner.c, "remove_member", { p_bubble_id: bubble, p_user_id: cat.id });
      assert(!rmAdmin.error, `owner removes admin: ${rmAdmin.error?.message}`);
    });

    await t.step("transfer_ownership: owner only, approved members only, old owner becomes admin", async () => {
      refused(await rpc(ann.c, "transfer_ownership", { p_bubble_id: bubble, p_new_owner: ann.id }), /only the owner can transfer ownership/, "admin transfers");
      refused(await rpc(ben.c, "transfer_ownership", { p_bubble_id: bubble, p_new_owner: ben.id }), /only the owner can transfer ownership/, "member transfers");
      refused(await rpc(owner.c, "transfer_ownership", { p_bubble_id: bubble, p_new_owner: stranger.id }), /member not found/, "to a non-member");
      // A pending requester is not a member either.
      const { data: b } = await owner.c.from("bubbles").select("invite_code").eq("id", bubble).single();
      const jr = await stranger.c.rpc("request_to_join", { p_invite_code: b!.invite_code });
      assert(!jr.error, `request: ${jr.error?.message}`);
      refused(await rpc(owner.c, "transfer_ownership", { p_bubble_id: bubble, p_new_owner: stranger.id }), /member not found/, "to a pending requester");
      refused(await rpc(owner.c, "transfer_ownership", { p_bubble_id: bubble, p_new_owner: owner.id }), /already the owner/, "to self");

      const ok = await rpc(owner.c, "transfer_ownership", { p_bubble_id: bubble, p_new_owner: ben.id });
      assert(!ok.error, `transfer: ${ok.error?.message}`);
      const r = await roles(bubble);
      assertEq([r[ben.id], r[owner.id], r[ann.id]], ["owner", "admin", "admin"], "roles after transfer");
      assertEq(Object.values(r).filter((x) => x === "owner").length, 1, "exactly one owner");
      // The old owner lost owner rights.
      refused(await rpc(owner.c, "set_member_role", { p_bubble_id: bubble, p_user_id: ann.id, p_role: "member" }), /only the owner can change roles/, "old owner changes roles");
      refused(await rpc(owner.c, "transfer_ownership", { p_bubble_id: bubble, p_new_owner: owner.id }), /only the owner can transfer ownership/, "old owner takes it back");
      refused(await rpc(owner.c, "remove_member", { p_bubble_id: bubble, p_user_id: ann.id }), /only the owner can remove admins/, "old owner removes an admin");
      // Majority vote is unchanged: an admin's approval is one vote (1 of 3 members), the owner's too.
      const jrId = (await sql`select id from public.join_requests where bubble_id = ${bubble} and user_id = ${stranger.id}`)[0].id;
      assertEq((await rpc(ann.c, "approve_join_request", { p_request_id: jrId })).data, false, "admin vote alone: 1 of 3");
      assertEq((await rpc(ben.c, "approve_join_request", { p_request_id: jrId })).data, true, "2 of 3 is a majority");
      assertEq((await roles(bubble))[stranger.id], "member", "joins as a plain member");
    });

    await t.step("concurrent transfers never leave zero or two owners", async () => {
      // ben (owner) fires two transfers at once; exactly one wins.
      const [a, c] = await Promise.all([
        rpc(ben.c, "transfer_ownership", { p_bubble_id: bubble, p_new_owner: ann.id }),
        rpc(ben.c, "transfer_ownership", { p_bubble_id: bubble, p_new_owner: owner.id }),
      ]);
      assertEq([a.error, c.error].filter((e) => !e).length, 1, `one wins: ${a.error?.message} / ${c.error?.message}`);
      const r = await roles(bubble);
      assertEq(Object.values(r).filter((x) => x === "owner").length, 1, "exactly one owner");
      assertEq(r[ben.id], "admin", "ben now admin");
    });
  } finally {
    await sql`delete from public.invite_lookup_failures where user_id in (${owner.id}, ${stranger.id})`;
    await cleanupUsers();
  }
});

Deno.test("bubble roles: hand-over prefers the oldest admin, then the oldest member; empty bubbles go", opts, async () => {
  const owner = await person("Olga");
  const oldMember = await person("Mia");
  const youngAdmin = await person("Ada");
  const oldAdmin = await person("Abe");
  const late = await person("Lou");
  try {
    const bubble = await newBubble(owner);
    await sql`update public.bubble_members set created_at = now() - interval '1 hour' where bubble_id = ${bubble}`;
    await seat(bubble, oldMember, 3000);
    await seat(bubble, oldAdmin, 2000);
    await seat(bubble, youngAdmin, 1000);
    await seat(bubble, late, 500);
    await rpc(owner.c, "set_member_role", { p_bubble_id: bubble, p_user_id: youngAdmin.id, p_role: "admin" });
    await rpc(owner.c, "set_member_role", { p_bubble_id: bubble, p_user_id: oldAdmin.id, p_role: "admin" });

    // 1. The owner leaves: the oldest admin (not the older plain member) takes over.
    await owner.c.from("bubble_members").delete().eq("bubble_id", bubble).eq("user_id", owner.id);
    let r = await roles(bubble);
    assertEq([r[oldAdmin.id], r[youngAdmin.id], r[oldMember.id]], ["owner", "admin", "member"], "oldest admin takes over on leave");

    // 2. The new owner is removed by moderation (a plain delete, like admin_resolve_report): next admin.
    await sql`delete from public.bubble_members where bubble_id = ${bubble} and user_id = ${oldAdmin.id}`;
    r = await roles(bubble);
    assertEq(r[youngAdmin.id], "owner", "remaining admin takes over on removal");

    // 3. The owner deletes their account (cascade): no admins left, the oldest member takes over.
    await admin.auth.admin.deleteUser(youngAdmin.id);
    r = await roles(bubble);
    assertEq([r[oldMember.id], r[late.id]], ["owner", "member"], "oldest member takes over on account deletion");

    // 4. Last members leave: the bubble is deleted.
    await late.c.from("bubble_members").delete().eq("bubble_id", bubble).eq("user_id", late.id);
    await oldMember.c.from("bubble_members").delete().eq("bubble_id", bubble).eq("user_id", oldMember.id);
    assertEq((await sql`select 1 from public.bubbles where id = ${bubble}`).length, 0, "empty bubble deleted");
  } finally {
    await cleanupUsers();
  }
});

Deno.test("bubble roles: an admin's removal frees a seat and admits a queued request", opts, async () => {
  const owner = await person("Olga");
  const adm = await person("Ada");
  const mem = await person("Max");
  const req = await person("Rae");
  try {
    const bubble = await newBubble(owner, 3);
    await seat(bubble, adm, 200);
    await rpc(owner.c, "set_member_role", { p_bubble_id: bubble, p_user_id: adm.id, p_role: "admin" });
    const code = (await sql`select invite_code from public.bubbles where id = ${bubble}`)[0].invite_code;
    const jm = await mem.c.rpc("request_to_join", { p_invite_code: code });
    await rpc(owner.c, "approve_join_request", { p_request_id: jm.data.id });
    assertEq((await rpc(adm.c, "approve_join_request", { p_request_id: jm.data.id })).data, true, "max admitted (2 of 2)");
    refused(await req.c.rpc("request_to_join", { p_invite_code: code }), /bubble is full/, "full bubble");
    // A request queued earlier (before the bubble filled up) with a majority, 2 of 3, but no seat.
    await sql`insert into public.join_requests (user_id, bubble_id, approver_ids)
              values (${req.id}, ${bubble}, array[${owner.id}, ${adm.id}]::uuid[])
              on conflict (user_id, bubble_id) do update set approver_ids = excluded.approver_ids`;
    assertEq((await sql`select 1 from public.bubble_members where bubble_id = ${bubble} and user_id = ${req.id}`).length, 0, "Rae waits");
    const rm = await rpc(adm.c, "remove_member", { p_bubble_id: bubble, p_user_id: mem.id });
    assert(!rm.error, `admin removes max: ${rm.error?.message}`);
    const r = await roles(bubble);
    assertEq(r[req.id], "member", "Rae admitted into the freed seat as a plain member");
  } finally {
    await cleanupUsers();
  }
});

Deno.test("bubble roles: role changes arrive live over realtime", opts, async () => {
  const owner = await person("Olga");
  const watcher = await person("Wes");
  const target = await person("Tom");
  try {
    const bubble = await newBubble(owner);
    await seat(bubble, watcher, 200);
    await seat(bubble, target, 100);
    const got: { role: string; user_id: string }[] = [];
    await watcher.c.realtime.setAuth(await token(watcher.c));
    const ch: RealtimeChannel = watcher.c
      .channel(`roles-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "bubble_members", filter: `bubble_id=eq.${bubble}` }, (p) =>
        got.push(p.new as { role: string; user_id: string }));
    await new Promise<void>((res, rej) =>
      ch.subscribe((s) => (s === "SUBSCRIBED" ? res() : s === "CHANNEL_ERROR" || s === "TIMED_OUT" ? rej(new Error(s)) : null)));
    await sleep(1500);
    await rpc(owner.c, "set_member_role", { p_bubble_id: bubble, p_user_id: target.id, p_role: "admin" });
    await rpc(owner.c, "transfer_ownership", { p_bubble_id: bubble, p_new_owner: watcher.id });
    for (let i = 0; i < 60 && got.length < 3; i++) await sleep(100);
    const seen = got.map((g) => `${g.user_id === target.id ? "tom" : g.user_id === watcher.id ? "wes" : "olga"}:${g.role}`).sort();
    assertEq(seen, ["olga:admin", "tom:admin", "wes:owner"], "updates seen live");
    await watcher.c.removeChannel(ch);
  } finally {
    await cleanupUsers();
  }
});

Deno.test("bubble roles: teardown", opts, async () => {
  await sql.end();
});
