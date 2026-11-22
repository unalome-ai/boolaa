// Live feed updates (events + RSVPs, food, market, links) over Supabase Realtime, against the LOCAL
// stack (migration 20261123110000_realtime_feeds.sql):
//
//   deno test -A --no-check supabase/tests/realtime_feeds.test.ts
//
// Uses throwaway users and a throwaway bubble. Never changes app_settings flags.
import type { RealtimeChannel, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { assert, assertEq, cleanupUsers, createUser, sha256Hex, signIn, sleep, sql, TEST_DEVICE, token } from "./helpers.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };
const FEEDS = ["events", "food_posts", "market_items", "shared_links"] as const;
type Feed = (typeof FEEDS)[number];

Deno.test("feed tables are in the supabase_realtime publication", opts, async () => {
  const rows = await sql`select tablename from pg_publication_tables
                          where pubname = 'supabase_realtime' and schemaname = 'public'`;
  const have = new Set(rows.map((r) => r.tablename as string));
  for (const t of [...FEEDS, "chat_messages", "join_requests", "bubble_members"]) assert(have.has(t), `${t} published`);
});

async function member(name: string) {
  const u = await createUser({ name });
  await sql`select public.trust_device(${u.id}::uuid, ${await sha256Hex(TEST_DEVICE)}, 'test')`;
  const c = await signIn(u.email);
  const st = await c.rpc("start_device_check", { p_device_id: TEST_DEVICE });
  assertEq(st.data?.status, "verified", `device check for ${name}`);
  return { ...u, c };
}

type Change = { table: string; type: string; id: string; row: Record<string, unknown> };

/** Subscribes like the clients do: INSERT/UPDATE filtered by bubble, DELETE by id. */
async function listen(c: SupabaseClient, bubbleId: string) {
  const got: Change[] = [];
  await c.realtime.setAuth(await token(c));
  let ch: RealtimeChannel = c.channel(`feeds-${crypto.randomUUID()}`);
  for (const table of FEEDS) {
    for (const event of ["INSERT", "UPDATE"] as const) {
      ch = ch.on("postgres_changes", { event, schema: "public", table, filter: `bubble_id=eq.${bubbleId}` }, (p) =>
        got.push({ table, type: p.eventType, id: (p.new as { id: string }).id, row: p.new as Record<string, unknown> }));
    }
    ch = ch.on("postgres_changes", { event: "DELETE", schema: "public", table }, (p) =>
      got.push({ table, type: "DELETE", id: (p.old as { id: string }).id, row: p.old as Record<string, unknown> }));
  }
  await new Promise<void>((res, rej) =>
    ch.subscribe((s) => (s === "SUBSCRIBED" ? res() : s === "CHANNEL_ERROR" || s === "TIMED_OUT" ? rej(new Error(s)) : null)));
  await sleep(1500); // the change subscription registers just after SUBSCRIBED
  return got;
}

async function until(fn: () => boolean, ms = 6000) {
  for (let t = 0; t < ms && !fn(); t += 100) await sleep(100);
  return fn();
}

function insertRow(table: Feed, bubbleId: string, userId: string, tag: string) {
  switch (table) {
    case "events":
      return { bubble_id: bubbleId, creator_id: userId, title: `ev ${tag}`, datetime: new Date(Date.now() + 864e5).toISOString() };
    case "food_posts":
      return { bubble_id: bubbleId, user_id: userId, image: `${userId}/x.jpg`, description: `food ${tag}` };
    case "market_items":
      return { bubble_id: bubbleId, owner_id: userId, image: `${userId}/x.jpg`, title: `item ${tag}` };
    case "shared_links":
      return { bubble_id: bubbleId, user_id: userId, url: `https://example.com/${tag}`, title: `link ${tag}` };
  }
}
const editOf = (table: Feed) =>
  table === "food_posts" ? { description: "edited" } : table === "shared_links" ? { title: "edited" } : { title: "edited" };

Deno.test("members see inserts, updates, RSVPs and deletes live; RLS hides blocked authors and other bubbles", opts, async () => {
  const tag = `${Date.now()}`;
  try {
    const owner = await member(`RT Owner ${tag}`);
    const friend = await member(`RT Friend ${tag}`);
    const troll = await member(`RT Troll ${tag}`);
    const { data: bubble, error } = await owner.c.rpc("create_bubble", { p_name: `RT ${tag}`.slice(0, 60) });
    assert(!error, `create_bubble: ${error?.message}`);
    // Majority vote: every current member approves, the last vote admits.
    const voters = [owner];
    for (const m of [friend, troll]) {
      const { data: req } = await m.c.rpc("request_to_join", { p_invite_code: bubble.invite_code });
      let admitted = false;
      for (const v of voters) admitted = (await v.c.rpc("approve_join_request", { p_request_id: req.id })).data === true || admitted;
      assert(admitted, `${m.email} admitted`);
      voters.push(m);
    }
    // The owner blocks the troll; a second bubble (troll only) is the "other bubble".
    assert(!(await owner.c.from("blocks").insert({ blocker_id: owner.id, blocked_id: troll.id })).error, "block");
    const { data: other } = await troll.c.rpc("create_bubble", { p_name: `RT other ${tag}`.slice(0, 60) });

    const got = await listen(owner.c, bubble.id);
    const ids: Record<string, string> = {};
    for (const table of FEEDS) {
      const ins = await friend.c.from(table).insert(insertRow(table, bubble.id, friend.id, tag) as never).select("id").single();
      assert(!ins.error, `${table} insert: ${ins.error?.message}`);
      ids[table] = ins.data!.id;
      const hidden = await troll.c.from(table).insert(insertRow(table, bubble.id, troll.id, `t${tag}`) as never).select("id").single();
      assert(!hidden.error, `troll ${table} insert: ${hidden.error?.message}`);
      ids[`troll:${table}`] = hidden.data!.id;
      const elsewhere = await troll.c.from(table).insert(insertRow(table, other.id, troll.id, `o${tag}`) as never).select("id").single();
      assert(!elsewhere.error, `other-bubble ${table} insert: ${elsewhere.error?.message}`);
      ids[`other:${table}`] = elsewhere.data!.id;
    }
    for (const table of FEEDS) {
      assert(await until(() => got.some((g) => g.table === table && g.type === "INSERT" && g.id === ids[table])), `${table} INSERT arrives`);
    }

    for (const table of FEEDS) {
      assert(!(await friend.c.from(table).update(editOf(table) as never).eq("id", ids[table])).error, `${table} update`);
    }
    // An RSVP is an UPDATE of the event row (events.rsvp_list).
    const rsvp = await friend.c.rpc("toggle_rsvp", { p_event_id: ids.events });
    assert(!rsvp.error, `rsvp: ${rsvp.error?.message}`);
    for (const table of FEEDS) {
      assert(await until(() => got.some((g) => g.table === table && g.type === "UPDATE" && g.id === ids[table])), `${table} UPDATE arrives`);
    }
    assert(
      await until(() => got.some((g) => g.table === "events" && g.type === "UPDATE" && (g.row.rsvp_list as string[])?.includes(friend.id))),
      "RSVP arrives with the new rsvp_list",
    );

    for (const table of FEEDS) {
      assert(!(await friend.c.from(table).delete().eq("id", ids[table])).error, `${table} delete`);
    }
    for (const table of FEEDS) {
      assert(await until(() => got.some((g) => g.table === table && g.type === "DELETE" && g.id === ids[table])), `${table} DELETE arrives`);
    }
    const del = got.find((g) => g.type === "DELETE")!;
    assertEq(Object.keys(del.row).sort(), ["id"], "DELETE carries only the primary key");

    await sleep(1500);
    for (const table of FEEDS) {
      for (const key of [`troll:${table}`, `other:${table}`]) {
        assert(!got.some((g) => g.type !== "DELETE" && g.id === ids[key]), `${key} never delivered`);
      }
    }
  } finally {
    await cleanupUsers(); // cascades bubbles' content via users -> rows
  }
});
