// Marketplace availability (available / reserved / taken), against the LOCAL stack
// (migration 20261123170000_market_status_calendar.sql):
//
//   deno test -A --no-check supabase/tests/market_status.test.ts
//
// Uses throwaway users and a throwaway bubble. Never changes app_settings flags.
import type { RealtimeChannel, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { assert, assertEq, cleanupUsers, createUser, sha256Hex, signIn, sleep, sql, TEST_DEVICE, token } from "./helpers.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };

async function member(name: string) {
  const u = await createUser({ name });
  await sql`select public.trust_device(${u.id}::uuid, ${await sha256Hex(TEST_DEVICE)}, 'test')`;
  const c = await signIn(u.email);
  const st = await c.rpc("start_device_check", { p_device_id: TEST_DEVICE });
  assertEq(st.data?.status, "verified", `device check for ${name}`);
  return { ...u, c };
}

async function until(fn: () => boolean, ms = 6000) {
  for (let t = 0; t < ms && !fn(); t += 100) await sleep(100);
  return fn();
}

async function availabilityOf(id: string) {
  const [r] = await sql`select availability, bubble_id, owner_id, created_at from public.market_items where id = ${id}`;
  return r;
}

Deno.test("availability column: default, allowed values, column-level UPDATE grant", opts, async () => {
  const [col] = await sql`select column_default, is_nullable from information_schema.columns
                           where table_schema = 'public' and table_name = 'market_items' and column_name = 'availability'`;
  assert(col, "column exists");
  assertEq(col.is_nullable, "NO", "not null");
  assert(String(col.column_default).includes("available"), "defaults to available");
  const grants = await sql`select column_name from information_schema.column_privileges
                            where table_schema = 'public' and table_name = 'market_items'
                              and grantee = 'authenticated' and privilege_type = 'UPDATE' order by column_name`;
  assertEq(grants.map((g) => g.column_name), ["availability", "description", "image", "status", "title"], "authenticated may update only the editable columns");
  const [anon] = await sql`select has_table_privilege('anon', 'public.market_items', 'UPDATE') as t,
                                  has_column_privilege('anon', 'public.market_items', 'availability', 'UPDATE') as c`;
  assertEq([anon.t, anon.c], [false, false], "anon cannot update");
});

Deno.test("only the owner changes availability; others' writes change nothing; bad values and locked columns fail; live UPDATE arrives", opts, async () => {
  const tag = `${Date.now()}`;
  let ch: RealtimeChannel | null = null;
  let watcherClient: SupabaseClient | null = null;
  try {
    const owner = await member(`MS Owner ${tag}`);
    const friend = await member(`MS Friend ${tag}`);
    const outsider = await member(`MS Outsider ${tag}`);
    const { data: bubble, error } = await owner.c.rpc("create_bubble", { p_name: `MS ${tag}`.slice(0, 60) });
    assert(!error, `create_bubble: ${error?.message}`);
    const { data: req } = await friend.c.rpc("request_to_join", { p_invite_code: bubble.invite_code });
    assertEq((await owner.c.rpc("approve_join_request", { p_request_id: req.id })).data, true, "friend admitted");
    const { data: other } = await outsider.c.rpc("create_bubble", { p_name: `MS other ${tag}`.slice(0, 60) });

    const ins = await owner.c.from("market_items")
      .insert({ bubble_id: bubble.id, owner_id: owner.id, image: `${owner.id}/x.jpg`, title: `lamp ${tag}` })
      .select("id, availability").single();
    assert(!ins.error, `insert: ${ins.error?.message}`);
    assertEq(ins.data!.availability, "available", "new items are available");
    const id = ins.data!.id as string;

    // The friend watches the bubble's market feed like the clients do.
    watcherClient = friend.c;
    const got: Record<string, unknown>[] = [];
    await friend.c.realtime.setAuth(await token(friend.c));
    ch = friend.c.channel(`market-status-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "market_items", filter: `bubble_id=eq.${bubble.id}` }, (p) =>
        got.push(p.new as Record<string, unknown>));
    await new Promise<void>((res, rej) =>
      ch!.subscribe((s) => (s === "SUBSCRIBED" ? res() : s === "CHANNEL_ERROR" || s === "TIMED_OUT" ? rej(new Error(s)) : null)));
    await sleep(1500);

    // Owner: available -> reserved -> taken -> available.
    for (const a of ["reserved", "taken", "available", "reserved"]) {
      const up = await owner.c.from("market_items").update({ availability: a }).eq("id", id).select("availability").single();
      assert(!up.error, `owner sets ${a}: ${up.error?.message}`);
      assertEq(up.data!.availability, a, `owner set ${a}`);
    }
    assert(await until(() => got.some((r) => r.id === id && r.availability === "taken")), "friend gets the 'taken' UPDATE live");
    assert(await until(() => got.at(-1)?.availability === "reserved"), "friend's last live row is 'reserved'");

    // A bubble member who isn't the owner: RLS filters the row out, nothing changes.
    const fr = await friend.c.from("market_items").update({ availability: "taken" }).eq("id", id).select("id");
    assert(!fr.error, `friend update returns no error: ${fr.error?.message}`);
    assertEq(fr.data, [], "friend's update matched no row");
    assertEq((await availabilityOf(id)).availability, "reserved", "still reserved after the friend's try");

    // Someone outside the bubble: same.
    const out = await outsider.c.from("market_items").update({ availability: "available" }).eq("id", id).select("id");
    assertEq(out.data ?? [], [], "outsider's update matched no row");
    assertEq((await availabilityOf(id)).availability, "reserved", "still reserved after the outsider's try");

    // Values outside the set are rejected by the check constraint.
    const bad = await owner.c.from("market_items").update({ availability: "sold" }).eq("id", id);
    assert(bad.error, "unknown availability rejected");
    assertEq(bad.error!.code, "23514", "check_violation");

    // Locked columns: the owner can no longer move an item to another bubble, re-own it or backdate it.
    const before = await availabilityOf(id);
    for (const [col, val] of [["bubble_id", other.id], ["owner_id", friend.id], ["created_at", "2030-01-01T00:00:00Z"]] as const) {
      const r = await owner.c.from("market_items").update({ [col]: val }).eq("id", id);
      assert(r.error, `${col} update refused`);
      assertEq(r.error!.code, "42501", `${col}: permission denied`);
    }
    const after = await availabilityOf(id);
    assertEq([after.bubble_id, after.owner_id, String(after.created_at)], [before.bubble_id, before.owner_id, String(before.created_at)], "locked columns unchanged");

    // Normal edits keep working with the column grant (same payload the clients send).
    const edit = await owner.c.from("market_items")
      .update({ image: `${owner.id}/y.jpg`, title: "lamp (edited)", description: "works", status: "trade" }).eq("id", id);
    assert(!edit.error, `owner edit: ${edit.error?.message}`);

    // Inserting straight into another state is fine (e.g. a reserved item listed for the record).
    const ins2 = await owner.c.from("market_items")
      .insert({ bubble_id: bubble.id, owner_id: owner.id, image: `${owner.id}/z.jpg`, title: `chair ${tag}`, availability: "taken" })
      .select("availability").single();
    assert(!ins2.error, `insert taken: ${ins2.error?.message}`);
    assertEq(ins2.data!.availability, "taken", "insert with availability");
  } finally {
    if (ch && watcherClient) await watcherClient.removeChannel(ch).catch(() => {});
    await cleanupUsers();
  }
});
