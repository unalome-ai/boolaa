// End-to-end tests for the moderation admin RPCs and account suspension (docs/moderation.md),
// through the real GoTrue + PostgREST of the LOCAL stack:
//
//   deno test -A --no-check supabase/tests/moderation.test.ts
//
// Every scenario runs twice: flags (device_verification_enforced, age_confirmation_required)
// OFF, then ON. Flags are always restored to OFF. Uses its own throwaway users and bubbles;
// the seeded admin is mod@boolaa.test (device "boolaa-test-device" pre-trusted).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  admin, assert, assertEq, cleanupUsers, client, createUser, PASSWORD, setFlags, sha256Hex, signIn, sql, TEST_DEVICE,
} from "./helpers.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };
const FLAG_STATES = [false, true];

async function withFlags(on: boolean, fn: () => Promise<void>) {
  await setFlags({ device: on, age: on });
  try {
    await fn();
  } finally {
    await setFlags({ device: false, age: false });
    await cleanupUsers();
  }
}

/** Signs in and passes the device check with the pre-trusted test device. */
async function session(email: string) {
  const c = await signIn(email);
  const st = await c.rpc("start_device_check", { p_device_id: TEST_DEVICE } /* no label: keeps the seeded row label */);
  assertEq(st.data?.status, "verified", `device check for ${email}`);
  return c;
}

/** A throwaway user whose test device is trusted, signed in and verified. */
async function member(name: string) {
  const u = await createUser({ name });
  await sql`select public.trust_device(${u.id}::uuid, ${await sha256Hex(TEST_DEVICE)}, 'test')`;
  return { ...u, c: await session(u.email) };
}

/** Owner + troll in a fresh bubble; the troll posts a message; the owner reports it. */
async function scene(tag: string) {
  const owner = await member(`Owner ${tag}`);
  const troll = await member(`Troll ${tag}`);
  const { data: bubble, error } = await owner.c.rpc("create_bubble", { p_name: `Mod ${tag}`.slice(0, 60) });
  assert(!error, `create_bubble: ${error?.message}`);
  const { data: req } = await troll.c.rpc("request_to_join", { p_invite_code: bubble.invite_code });
  assertEq((await owner.c.rpc("approve_join_request", { p_request_id: req.id })).data, true, "troll admitted");
  const { data: msg, error: e2 } = await troll.c.from("chat_messages")
    .insert({ bubble_id: bubble.id, sender_id: troll.id, content: `nasty ${tag}` }).select("id").single();
  assert(!e2, `post: ${e2?.message}`);
  const report = async (reason = "harassment", c: SupabaseClient = owner.c) => {
    const r = await c.rpc("report_content", { p_target_type: "chat_message", p_target_id: msg!.id, p_reason: reason });
    assert(!r.error, `report: ${r.error?.message}`);
    return r.data as string;
  };
  return { owner, troll, bubble, msgId: msg!.id as string, report };
}

const ADMIN_RPCS: [string, Record<string, unknown>][] = [
  ["admin_list_reports", { p_status: "open", p_limit: 10, p_offset: 0 }],
  ["admin_get_report", { p_report_id: crypto.randomUUID() }],
  ["admin_resolve_report", { p_report_id: crypto.randomUUID(), p_action: "dismiss" }],
  ["admin_unsuspend", { p_user_id: crypto.randomUUID() }],
  ["admin_find_users", { p_query: "Dave" }],
];

for (const on of FLAG_STATES) {
  const flags = on ? "flags ON" : "flags OFF";

  Deno.test(`${flags}: non-admins and anon get permission denied on every admin RPC`, opts, () =>
    withFlags(on, async () => {
      const alice = await session("alice@boolaa.test");
      assertEq((await alice.rpc("is_admin")).data, false, "alice is not admin");
      for (const [fn, args] of ADMIN_RPCS) {
        const r = await alice.rpc(fn, args);
        assertEq([r.error?.code, r.error?.message], ["42501", "permission denied"], `alice ${fn}`);
        const a = await client().rpc(fn, args);
        assert(a.error && /permission denied/.test(a.error.message), `anon ${fn}: ${a.error?.message}`);
      }
      const log = await alice.from("moderation_actions").select("id");
      assertEq(log.data?.length ?? 0, 0, "non-admin reads no audit log");
      const mod = await session("mod@boolaa.test");
      assertEq((await mod.rpc("is_admin")).data, true, "mod is admin");
    }));

  Deno.test(`${flags}: admin lists a report and resolves it with each action; duplicates close`, opts, () =>
    withFlags(on, async () => {
      const mod = await session("mod@boolaa.test");
      const tag = `${on ? "on" : "off"}-${Date.now()}`;

      // dismiss + duplicates
      let s = await scene(`d-${tag}`);
      const r1 = await s.report("spam");
      const r2 = await s.report("harassment");
      const list = await mod.rpc("admin_list_reports", { p_status: "open", p_limit: 200, p_offset: 0 });
      assert(!list.error, `list: ${list.error?.message}`);
      const item = list.data.items.find((x: { id: string }) => x.id === r1);
      assert(item, "report listed");
      assertEq([item.reporter_name, item.reported_user_name, item.bubble_name, item.snapshot.text],
        [`Owner d-${tag}`, `Troll d-${tag}`, `Mod d-${tag}`.slice(0, 60), `nasty d-${tag}`], "row content");
      assertEq([item.open_reports_against_user_30d, item.reported_user_status], [2, "active"], "counters");
      const full = await mod.rpc("admin_get_report", { p_report_id: r1 });
      assertEq(full.data.context.filter((m: { is_target: boolean }) => m.is_target).length, 1, "context marks the target");
      assertEq(full.data.related.map((x: { id: string }) => x.id), [r2], "related report");
      let res = await mod.rpc("admin_resolve_report", { p_report_id: r1, p_action: "dismiss", p_note: "fine" });
      assertEq([res.data?.status, res.data?.duplicates_closed], ["dismissed", 1], `dismiss ${res.error?.message}`);
      const st = await sql`select status from public.reports where id in (${r1}, ${r2})`;
      assert(st.every((x) => x.status === "dismissed"), "both dismissed");
      res = await mod.rpc("admin_resolve_report", { p_report_id: r2, p_action: "dismiss" });
      assertEq(res.error?.message, "report already handled", "duplicate already closed");

      // delete_content
      s = await scene(`c-${tag}`);
      let id = await s.report();
      res = await mod.rpc("admin_resolve_report", { p_report_id: id, p_action: "delete_content", p_note: "gone" });
      assertEq([res.data?.status, res.data?.rows_deleted], ["actioned", 1], `delete ${res.error?.message}`);
      assertEq((await s.owner.c.from("chat_messages").select("id").eq("id", s.msgId)).data?.length, 0, "message deleted");

      // delete_content on a food post also lets the admin delete its photo (public bucket), and only that one
      {
        const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
        const up = async (name: string) => {
          const path = `${s.troll.id}/${name}-${tag}.png`;
          const { error } = await s.troll.c.storage.from("food.images").upload(path, png, { contentType: "image/png" });
          assert(!error, `upload: ${error?.message}`);
          return path;
        };
        const photo = await up("photo");
        const other = await up("other");
        const url = s.troll.c.storage.from("food.images").getPublicUrl(photo).data.publicUrl;
        const { data: post, error: pe } = await s.troll.c.from("food_posts")
          .insert({ bubble_id: s.bubble.id, user_id: s.troll.id, image: url, description: "x" }).select("id").single();
        assert(!pe, `food post: ${pe?.message}`);
        const rep = await s.owner.c.rpc("report_content", { p_target_type: "food_post", p_target_id: post!.id, p_reason: "sexual" });
        assert(!rep.error, `report food: ${rep.error?.message}`);
        res = await mod.rpc("admin_resolve_report", { p_report_id: rep.data, p_action: "delete_content" });
        assertEq([res.data?.status, res.data?.image_bucket, res.data?.image_path], ["actioned", "food.images", photo], `delete food ${res.error?.message}`);
        const audit = await sql`select details from public.moderation_actions where report_id = ${rep.data as string}`;
        assertEq(audit[0].details.image_path, photo, "audit row names the photo");
        const denied = await mod.storage.from("food.images").remove([other]);
        assertEq(denied.data?.length ?? 0, 0, "admin can't delete an unrelated photo");
        const removed = await mod.storage.from("food.images").remove([photo]);
        assertEq(removed.data?.length, 1, `photo removed ${removed.error?.message}`);
        const left = await sql`select name from storage.objects where bucket_id = 'food.images' and name in (${photo}, ${other})`;
        assertEq(left.map((x) => x.name), [other], "only the moderated photo is gone");
        await admin.storage.from("food.images").remove([other]);
      }

      // remove_from_bubble (owner check skipped; trigger cleanup runs)
      s = await scene(`r-${tag}`);
      id = await s.report();
      res = await mod.rpc("admin_resolve_report", { p_report_id: id, p_action: "remove_from_bubble" });
      assertEq(res.data?.status, "actioned", `remove ${res.error?.message}`);
      const members = await s.owner.c.from("bubble_members").select("user_id").eq("bubble_id", s.bubble.id);
      assertEq(members.data?.map((m) => m.user_id), [s.owner.id], "troll removed");

      // suspend 7 days
      s = await scene(`s-${tag}`);
      id = await s.report();
      res = await mod.rpc("admin_resolve_report", { p_report_id: id, p_action: "suspend", p_days: 7, p_note: "cool off" });
      assertEq([res.data?.status, res.data?.days], ["actioned", 7], `suspend ${res.error?.message}`);
      const u = await sql`select status, status_until from public.users where id = ${s.troll.id}`;
      assertEq(u[0].status, "suspended", "suspended");

      // ban
      s = await scene(`b-${tag}`);
      id = await s.report();
      res = await mod.rpc("admin_resolve_report", { p_report_id: id, p_action: "ban", p_note: "bot" });
      assertEq([res.data?.status, res.data?.bubbles_left], ["actioned", 1], `ban ${res.error?.message}`);
      assertEq((await sql`select status from public.users where id = ${s.troll.id}`)[0].status, "banned", "banned");
      const signin = await client().auth.signInWithPassword({ email: s.troll.email, password: PASSWORD });
      assertEq(signin.error?.code, "user_banned", "banned user can't sign in");

      const log = await mod.from("moderation_actions").select("action").in("target_user_id", [s.troll.id]);
      assertEq(log.data?.map((x) => x.action), ["ban"], "audit log readable by admin");
      const found = await mod.rpc("admin_find_users", { p_query: s.troll.id });
      assertEq(found.data?.[0]?.status, "banned", "find by id");
    }));

  Deno.test(`${flags}: suspended user can't read, post or sign in; reads own status; unsuspend restores`, opts, () =>
    withFlags(on, async () => {
      const mod = await session("mod@boolaa.test");
      const s = await scene(`u-${on ? "on" : "off"}-${Date.now()}`);
      const id = await s.report();
      const troll = s.troll.c; // session opened before the suspension
      const res = await mod.rpc("admin_resolve_report", { p_report_id: id, p_action: "suspend", p_days: 1 });
      assert(!res.error, `suspend: ${res.error?.message}`);

      assertEq((await troll.from("chat_messages").select("id")).data?.length, 0, "no chat");
      assertEq((await troll.from("bubbles").select("id")).data?.length, 0, "no bubbles");
      const own = await troll.from("users").select("status, status_reason, status_until").eq("id", s.troll.id).single();
      assertEq([own.data?.status, own.data?.status_reason], ["suspended", "harassment"], "own status readable");
      assert(own.data?.status_until, "until readable");
      const post = await troll.from("chat_messages").insert({ bubble_id: s.bubble.id, sender_id: s.troll.id, content: "still here" });
      assert(post.error, "post refused");
      const rep = await troll.rpc("report_content", { p_target_type: "user", p_target_id: s.owner.id, p_reason: "spam" });
      assertEq(rep.error?.message, "account suspended", "RPCs refused");
      assertEq((await troll.auth.refreshSession()).error?.code, "user_banned", "refresh refused by GoTrue");
      const signin = await client().auth.signInWithPassword({ email: s.troll.email, password: PASSWORD });
      assertEq(signin.error?.code, "user_banned", "sign-in refused by GoTrue");
      assertEq((await s.owner.c.from("chat_messages").select("id").eq("id", s.msgId)).data?.length, 1,
        "content stays visible to the bubble");

      const un = await mod.rpc("admin_unsuspend", { p_user_id: s.troll.id, p_note: "appeal ok" });
      assertEq(un.data?.previous_status, "suspended", `unsuspend ${un.error?.message}`);
      const again = await session(s.troll.email);
      assert(((await again.from("chat_messages").select("id")).data?.length ?? 0) > 0, "reads chat again");
      const ok = await again.from("chat_messages").insert({ bubble_id: s.bubble.id, sender_id: s.troll.id, content: "sorry" });
      assert(!ok.error, `posts again: ${ok.error?.message}`);
    }));
}

Deno.test("a suspended user may still delete their account (session opened before the suspension)", opts, () =>
  withFlags(false, async () => {
    const mod = await session("mod@boolaa.test");
    const s = await scene(`x-${Date.now()}`);
    const id = await s.report();
    await mod.rpc("admin_resolve_report", { p_report_id: id, p_action: "suspend", p_days: 30 });
    const d = await s.troll.c.rpc("delete_my_account");
    assert(!d.error, `delete: ${d.error?.message}`);
    assertEq((await admin.auth.admin.getUserById(s.troll.id)).data.user, null, "deleted");
  }));

Deno.test({ name: "teardown", ...opts, fn: async () => {
  await setFlags({ device: false, age: false });
  await cleanupUsers();
  await sql.end();
} });
