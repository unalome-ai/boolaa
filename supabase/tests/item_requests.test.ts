// Requests ("I want it"), picking and food expiry (migration 20261124100000_requests_food_expiry.sql,
// docs/boolaa-spec.md "Requests and picking", "Food expiry"), against the LOCAL stack:
//
//   deno test -A --no-check supabase/tests/item_requests.test.ts
//
// Throwaway users and bubbles only. Never changes app_settings flags.
import type { RealtimeChannel, SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  admin, assert, assertEq, cleanupUsers, codeOf, createUser, deviceCode, SERVICE_KEY, sha256Hex, signIn, sleep, sql, TEST_DEVICE,
  token, waitMail,
} from "./helpers.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
// The DB container reaches the API gateway on the Docker network (pg_net runs inside it).
const KONG_FROM_DB = "http://supabase_kong_boolaa:8000";
const tag = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

async function member(name: string) {
  const u = await createUser({ name });
  await sql`select public.trust_device(${u.id}::uuid, ${await sha256Hex(TEST_DEVICE)}, 'test')`;
  const c = await signIn(u.email);
  const st = await c.rpc("start_device_check", { p_device_id: TEST_DEVICE });
  assertEq(st.data?.status, "verified", `device check for ${name}`);
  // A device, so push_enqueue writes outbox rows for this user.
  const r = await c.rpc("register_push_token", { p_platform: "android", p_token: `ir-${crypto.randomUUID()}`, p_device_id: TEST_DEVICE });
  assert(!r.error, `register token: ${r.error?.message}`);
  return { ...u, c, name };
}
type Member = Awaited<ReturnType<typeof member>>;

async function bubbleWith(owner: Member, others: Member[], name: string) {
  const { data: bubble, error } = await owner.c.rpc("create_bubble", { p_name: name.slice(0, 60), p_max_size: 20 });
  assert(!error, `create_bubble: ${error?.message}`);
  const voters = [owner];
  for (const m of others) {
    const { data: req } = await m.c.rpc("request_to_join", { p_invite_code: bubble.invite_code });
    let admitted = false;
    for (const v of voters) admitted = (await v.c.rpc("approve_join_request", { p_request_id: req.id })).data === true || admitted;
    assert(admitted, `${m.name} admitted`);
    voters.push(m);
  }
  return bubble as { id: string; invite_code: string };
}

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p;
  assert(!error, `${what}: ${error?.message}`);
  return data;
}
async function fails(p: PromiseLike<{ error: { message: string } | null }>, text: string, what: string) {
  const { error } = await p;
  assert(error, `${what}: expected "${text}", got success`);
  assert(error.message.includes(text), `${what}: expected "${text}", got "${error.message}"`);
}
async function until(fn: () => boolean | Promise<boolean>, ms = 8000) {
  for (let t = 0; t < ms; t += 200) {
    if (await fn()) return true;
    await sleep(200);
  }
  return await fn();
}
const inDays = (d: number) => new Date(Date.now() + d * 86400_000).toISOString();
const outbox = (recipient: string, type: string) =>
  sql`select * from public.notification_outbox where recipient_id = ${recipient} and type = ${type} order by id`;
const itemRow = async (table: "food_posts" | "market_items", id: string) =>
  (await sql`select * from ${sql(`public.${table}`)} where id = ${id}`)[0];
const statuses = async (itemId: string) =>
  Object.fromEntries((await sql`select requester_id, status from public.item_requests where item_id = ${itemId} order by requester_id`)
    .map((r) => [r.requester_id, r.status]));
const sorted = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
async function assertStatuses(itemId: string, expected: Record<string, string>, msg: string) {
  assertEq(await statuses(itemId), sorted(expected), msg);
}

async function addMarket(m: Member, bubbleId: string, title: string) {
  return await must(m.c.from("market_items").insert({ bubble_id: bubbleId, owner_id: m.id, image: `${m.id}/x.jpg`, title })
    .select("id, request_count, availability").single(), "insert item") as { id: string; request_count: number; availability: string };
}
async function addFood(m: Member, bubbleId: string, description: string, expires = inDays(1), image = `${m.id}/f.jpg`) {
  return await must(m.c.from("food_posts").insert({ bubble_id: bubbleId, user_id: m.id, image, description, expires_at: expires })
    .select("id, expires_at, availability, request_count").single(), "insert food") as { id: string; expires_at: string; availability: string };
}

Deno.test("schema: columns, grants, realtime, cron and push types are in place", opts, async () => {
  const cols = await sql`select table_name, column_name, is_nullable from information_schema.columns
                          where table_schema = 'public' and ((table_name = 'food_posts' and column_name in ('expires_at', 'availability', 'handed_over_at', 'request_count'))
                             or (table_name = 'market_items' and column_name = 'request_count'))
                          order by 1, 2`;
  assertEq(cols.map((c) => `${c.table_name}.${c.column_name}:${c.is_nullable}`),
    ["food_posts.availability:NO", "food_posts.expires_at:NO", "food_posts.handed_over_at:YES", "food_posts.request_count:NO", "market_items.request_count:NO"], "columns");
  const grants = await sql`select column_name from information_schema.column_privileges
                            where table_schema = 'public' and table_name = 'food_posts' and grantee = 'authenticated' and privilege_type = 'UPDATE' order by 1`;
  assertEq(grants.map((g) => g.column_name), ["description", "expires_at", "image"], "food: clients update only image, description, expires_at");
  const [priv] = await sql`select has_table_privilege('authenticated', 'public.item_requests', 'INSERT') i,
                                  has_table_privilege('authenticated', 'public.item_requests', 'UPDATE') u,
                                  has_table_privilege('authenticated', 'public.item_requests', 'DELETE') d,
                                  has_table_privilege('authenticated', 'public.item_requests', 'SELECT') s,
                                  has_table_privilege('anon', 'public.item_requests', 'SELECT') a`;
  assertEq([priv.i, priv.u, priv.d, priv.s, priv.a], [false, false, false, true, false], "item_requests: select only, writes through RPCs");
  assertEq((await sql`select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'item_requests'`).length, 1, "realtime");
  assertEq((await sql`select schedule from cron.job where jobname = 'food-posts-sweep'`)[0]?.schedule, "*/15 * * * *", "sweep every 15 min");
  const [np] = await sql`select item_requests, request_updates from public.notification_prefs limit 1`;
  assertEq([np.item_requests, np.request_updates], [true, true], "new prefs default on");
});

Deno.test("market: request, privacy, errors, pick / switch / undo / withdraw / hand over, manual Mark as, pushes", opts, async () => {
  try {
    const O = await member(`IR Owner ${tag}`);
    const A = await member(`IR Ana ${tag}`);
    const B = await member(`IR Ben ${tag}`);
    const M = await member(`IR Mia ${tag}`); // member who never asks
    const C = await member(`IR Cy ${tag}`); // blocked the owner
    const X = await member(`IR Xan ${tag}`); // other bubble
    const b = await bubbleWith(O, [A, B, M, C], `IR market ${tag}`);
    await bubbleWith(X, [], `IR other ${tag}`);
    const item = await addMarket(O, b.id, `Lamp ${tag}`);
    assertEq([item.request_count, item.availability], [0, "available"], "fresh item");

    // Request with a note (trimmed, whitespace collapsed) and without.
    const ra = await must(A.c.rpc("request_item", { p_kind: "market", p_item_id: item.id, p_note: "  Can I   pick it up Friday?  " }), "A requests");
    assertEq([ra.status, ra.note, ra.item_kind, ra.item_id, ra.owner_id], ["pending", "Can I pick it up Friday?", "market", item.id, O.id], "A's row");
    const rb = await must(B.c.rpc("request_item", { p_kind: "market", p_item_id: item.id, p_note: "   " }), "B requests");
    assertEq(rb.note, null, "blank note is null");

    // Errors.
    await fails(O.c.rpc("request_item", { p_kind: "market", p_item_id: item.id }), "cannot request own item", "own item");
    await fails(A.c.rpc("request_item", { p_kind: "market", p_item_id: item.id }), "already requested", "twice");
    await fails(X.c.rpc("request_item", { p_kind: "market", p_item_id: item.id }), "item not found", "not a member");
    await fails(M.c.rpc("request_item", { p_kind: "market", p_item_id: item.id, p_note: "x".repeat(201) }), "request note too long", "note > 200");
    await fails(M.c.rpc("request_item", { p_kind: "car", p_item_id: item.id }), "invalid item kind", "kind");
    await fails(M.c.rpc("request_item", { p_kind: "food", p_item_id: item.id }), "item not found", "wrong kind for the id");
    assert(!(await C.c.from("blocks").insert({ blocker_id: C.id, blocked_id: O.id })).error, "C blocks O");
    await fails(C.c.rpc("request_item", { p_kind: "market", p_item_id: item.id }), "item not found", "blocked (C blocked O)");
    // Clients can't write the table.
    assert((await M.c.from("item_requests").insert({ bubble_id: b.id, owner_id: O.id, requester_id: M.id, market_item_id: item.id })).error, "no direct insert");
    const upd = await A.c.from("item_requests").update({ status: "picked" }).eq("id", ra.id).select("id");
    assert(upd.error || (upd.data ?? []).length === 0, "no direct update");

    // Privacy: count for everyone, rows only for the owner and each requester.
    const seen = async (c: SupabaseClient) => (await must(c.from("item_requests").select("id, requester_id, note").eq("market_item_id", item.id), "read")).map((r) => r.requester_id).sort();
    assertEq(await seen(O.c), [A.id, B.id].sort(), "owner sees both");
    assertEq(await seen(A.c), [A.id], "A sees only her own");
    assertEq(await seen(M.c), [], "M sees none");
    assertEq(await seen(X.c), [], "outsider sees none");
    const mv = await must(M.c.from("market_items").select("request_count").eq("id", item.id).single(), "M reads item");
    assertEq(mv.request_count, 2, "M sees the count");
    // Embedding the requester like the clients do.
    const emb = await must(O.c.from("item_requests").select("id, requester:users!requester_id(id, name)").eq("id", ra.id).single(), "embed");
    assertEq((emb as unknown as { requester: { name: string } }).requester.name, A.name, "requester name");

    // Push: the owner was told twice (one per requester).
    assertEq((await outbox(O.id, "item_request")).length, 2, "owner: 2 item_request pushes");

    // Pick: only the owner; then the item is reserved and new requests are refused.
    await fails(B.c.rpc("pick_item_request", { p_request_id: ra.id }), "item request gone", "non-owner pick");
    const pa = await must(O.c.rpc("pick_item_request", { p_request_id: ra.id }), "O picks A");
    assertEq(pa.status, "picked", "A picked");
    assertEq((await itemRow("market_items", item.id)).availability, "reserved", "reserved");
    await fails(M.c.rpc("request_item", { p_kind: "market", p_item_id: item.id }), "item not available", "request while reserved");
    assertEq((await must(O.c.rpc("pick_item_request", { p_request_id: ra.id }), "re-pick")).status, "picked", "picking the pick again is a no-op");
    assertEq((await outbox(A.id, "item_picked")).length, 1, "A told once");
    // Switch to B.
    await must(O.c.rpc("pick_item_request", { p_request_id: rb.id }), "switch to B");
    await assertStatuses(item.id, { [A.id]: "pending", [B.id]: "picked" }, "switch: A back to pending");
    assertEq((await itemRow("market_items", item.id)).request_count, 2, "count = pending + picked");
    // Undo.
    await must(O.c.rpc("unpick_item", { p_kind: "market", p_item_id: item.id }), "unpick");
    assertEq((await itemRow("market_items", item.id)).availability, "available", "available again");
    await assertStatuses(item.id, { [A.id]: "pending", [B.id]: "pending" }, "requests kept");
    await fails(A.c.rpc("unpick_item", { p_kind: "market", p_item_id: item.id }), "not your item", "non-owner unpick");
    await fails(O.c.rpc("hand_over_item", { p_kind: "market", p_item_id: item.id }), "nothing picked", "hand over needs a pick");

    // The picked person withdraws: item freed, owner told.
    await must(O.c.rpc("pick_item_request", { p_request_id: ra.id }), "pick A again");
    assertEq(await must(A.c.rpc("withdraw_item_request", { p_request_id: ra.id }), "A withdraws"), true, "withdrawn");
    assertEq(await must(A.c.rpc("withdraw_item_request", { p_request_id: ra.id }), "again"), false, "idempotent");
    assertEq(await must(B.c.rpc("withdraw_item_request", { p_request_id: ra.id }), "B on A's"), false, "can't withdraw someone else's");
    assertEq((await itemRow("market_items", item.id)).availability, "available", "freed");
    assertEq((await itemRow("market_items", item.id)).request_count, 1, "count 1");
    assertEq((await outbox(O.id, "item_request_withdrawn")).length, 1, "owner told about the withdrawal");
    // A asks again: no second item_request push (dedupe per item and requester).
    const ra2 = await must(A.c.rpc("request_item", { p_kind: "market", p_item_id: item.id }), "A asks again");
    assertEq((await outbox(O.id, "item_request")).length, 2, "no repeat push for the same requester");

    // Hand over to B: A missed (pushed once), B received; no more withdrawals.
    await must(O.c.rpc("pick_item_request", { p_request_id: rb.id }), "pick B");
    const won = await must(O.c.rpc("hand_over_item", { p_kind: "market", p_item_id: item.id }), "hand over");
    assertEq([won.id, won.status], [rb.id, "received"], "winner row");
    assertEq((await itemRow("market_items", item.id)).availability, "taken", "taken");
    await assertStatuses(item.id, { [A.id]: "missed", [B.id]: "received" }, "outcomes");
    assertEq((await itemRow("market_items", item.id)).request_count, 0, "count 0 once decided");
    assertEq((await outbox(A.id, "item_missed")).length, 1, "A: someone else got it");
    assertEq((await outbox(B.id, "item_missed")).length, 0, "B not told 'missed'");
    await fails(A.c.rpc("withdraw_item_request", { p_request_id: ra2.id }), "request already decided", "withdraw after hand-over");
    await fails(O.c.rpc("pick_item_request", { p_request_id: ra2.id }), "item not available", "pick after hand-over");
    await fails(O.c.rpc("hand_over_item", { p_kind: "market", p_item_id: item.id }), "item not available", "hand over twice");

    // Manual "Mark as" stays consistent: reserved -> winner picked again, others pending; available -> all pending;
    // taken without a pick -> everyone missed (A not pushed twice).
    await must(O.c.from("market_items").update({ availability: "reserved" }).eq("id", item.id), "mark reserved");
    await assertStatuses(item.id, { [A.id]: "pending", [B.id]: "picked" }, "reserved restores the pick");
    await must(O.c.from("market_items").update({ availability: "available" }).eq("id", item.id), "mark available");
    await assertStatuses(item.id, { [A.id]: "pending", [B.id]: "pending" }, "available clears the pick");
    await must(O.c.from("market_items").update({ availability: "taken" }).eq("id", item.id), "mark taken");
    await assertStatuses(item.id, { [A.id]: "missed", [B.id]: "missed" }, "taken without a pick: all missed");
    assertEq((await outbox(A.id, "item_missed")).length, 1, "A's 'missed' push is not repeated");
    assertEq((await outbox(B.id, "item_missed")).length, 1, "B told now");
    // request_count can't be written by clients.
    assert((await O.c.from("market_items").update({ request_count: 9 }).eq("id", item.id)).error, "request_count is server-only");

    // Deleting the item cascades.
    await must(O.c.from("market_items").delete().eq("id", item.id), "delete item");
    assertEq((await sql`select 1 from public.item_requests where item_id = ${item.id}`).length, 0, "requests deleted with the item");
  } finally {
    await cleanupUsers();
  }
});

Deno.test("blocks, leaving, removal, suspension and account deletion clean up requests", opts, async () => {
  try {
    const O = await member(`IR2 Owner ${tag}`);
    const A = await member(`IR2 Ana ${tag}`);
    const B = await member(`IR2 Ben ${tag}`);
    const D = await member(`IR2 Dan ${tag}`);
    const S = await member(`IR2 Sue ${tag}`);
    const b = await bubbleWith(O, [A, B, D, S], `IR2 ${tag}`);
    const lamp = await addMarket(O, b.id, `Lamp2 ${tag}`);
    const chair = await addMarket(A, b.id, `Chair ${tag}`);
    for (const m of [A, B, D]) await must(m.c.rpc("request_item", { p_kind: "market", p_item_id: lamp.id }), `${m.name} asks`);
    await must(O.c.rpc("request_item", { p_kind: "market", p_item_id: chair.id }), "O asks for A's chair");
    await must(O.c.rpc("pick_item_request", { p_request_id: (await sql`select id from public.item_requests where item_id = ${lamp.id} and requester_id = ${D.id}`)[0].id }), "pick D");

    // The owner blocks D (the pick): D's request goes, the item is free again.
    assert(!(await O.c.from("blocks").insert({ blocker_id: O.id, blocked_id: D.id })).error, "O blocks D");
    assertEq(Object.keys(await statuses(lamp.id)).sort(), [A.id, B.id].sort(), "D's request deleted by the block");
    assertEq([(await itemRow("market_items", lamp.id)).availability, (await itemRow("market_items", lamp.id)).request_count], ["available", 2], "freed, count 2");
    await fails(D.c.rpc("request_item", { p_kind: "market", p_item_id: lamp.id }), "item not found", "blocked can't ask");

    // A leaves: her request on the lamp and O's request on her chair go.
    await must(A.c.from("bubble_members").delete().eq("user_id", A.id).eq("bubble_id", b.id), "A leaves");
    assertEq(Object.keys(await statuses(lamp.id)), [B.id], "A's request deleted");
    assertEq(Object.keys(await statuses(chair.id)), [], "requests on A's item deleted");
    await fails(B.c.rpc("request_item", { p_kind: "market", p_item_id: chair.id }), "item not available", "an item whose owner left can't be requested");

    // Suspended users can't ask.
    await sql`update public.users set status = 'suspended', status_until = now() + interval '1 day' where id = ${S.id}`;
    await fails(S.c.rpc("request_item", { p_kind: "market", p_item_id: lamp.id }), "account suspended", "suspended");
    await sql`update public.users set status = 'active', status_until = null where id = ${S.id}`;

    // Account deletion cascades and the count follows.
    const pre = (await itemRow("market_items", lamp.id)).request_count;
    await admin.auth.admin.deleteUser(B.id);
    assertEq(Object.keys(await statuses(lamp.id)), [], "B's request gone with the account");
    assertEq([pre, (await itemRow("market_items", lamp.id)).request_count], [1, 0], "count follows");

    // Removal by the owner works the same as leaving.
    await must(S.c.rpc("request_item", { p_kind: "market", p_item_id: lamp.id }), "S asks");
    await must(O.c.rpc("remove_member", { p_bubble_id: b.id, p_user_id: S.id }), "O removes S");
    assertEq(Object.keys(await statuses(lamp.id)), [], "removed member's request deleted");
  } finally {
    await cleanupUsers();
  }
});

Deno.test("food: expiry validation, expired posts invisible (feed, search, photo, requests), hand-over hides and pushes", opts, async () => {
  try {
    const O = await member(`IRF Owner ${tag}`);
    const A = await member(`IRF Ana ${tag}`);
    const B = await member(`IRF Ben ${tag}`);
    const b = await bubbleWith(O, [A, B], `IRF ${tag}`);

    // Expiry validation on client writes.
    for (const [exp, what] of [[new Date(Date.now() - 60_000).toISOString(), "past"], [inDays(14.1), "> 14 days"]] as const) {
      await fails(O.c.from("food_posts").insert({ bubble_id: b.id, user_id: O.id, image: `${O.id}/a.jpg`, expires_at: exp }), "invalid expiry", what);
    }
    const dflt = await must(O.c.from("food_posts").insert({ bubble_id: b.id, user_id: O.id, image: `${O.id}/d.jpg` }).select("expires_at, availability").single(), "no expiry sent");
    const h = (Date.parse(dflt.expires_at) - Date.now()) / 3600_000;
    assert(h > 47.5 && h <= 48, `default is now + 2 days (${h} h)`);
    const forged = await must(O.c.from("food_posts").insert({ bubble_id: b.id, user_id: O.id, image: `${O.id}/g.jpg`, availability: "taken", request_count: 5 })
      .select("availability, request_count").single(), "forged insert");
    assertEq([forged.availability, forged.request_count], ["available", 0], "insert can't forge state");

    const soup = await addFood(O, b.id, `Soup zanzibar${tag}`, inDays(1), `${O.id}/soup-${tag}.jpg`);
    await must(O.c.from("food_posts").update({ expires_at: inDays(13) }).eq("id", soup.id), "owner extends within 14 days");
    await fails(O.c.from("food_posts").update({ expires_at: inDays(15) }).eq("id", soup.id), "invalid expiry", "owner extends too far");
    await must(O.c.from("food_posts").update({ description: `Soup zanzibar${tag} (hot)` }).eq("id", soup.id), "edit without touching expiry");
    assert((await O.c.from("food_posts").update({ availability: "reserved" }).eq("id", soup.id)).error, "food availability is RPC-only");

    // Request + pick on food.
    const ra = await must(A.c.rpc("request_item", { p_kind: "food", p_item_id: soup.id, p_note: "for lunch" }), "A asks for soup");
    const rb = await must(B.c.rpc("request_item", { p_kind: "food", p_item_id: soup.id }), "B asks for soup");
    await must(O.c.rpc("pick_item_request", { p_request_id: ra.id }), "pick A");
    assertEq((await itemRow("food_posts", soup.id)).availability, "reserved", "food reserved");
    const search = async (c: SupabaseClient, q: string) => (await must(c.rpc("search_bubble", { p_bubble_id: b.id, p_query: q }), "search")).map((r: { id: string }) => r.id);
    assert((await search(B.c, `zanzibar${tag}`)).includes(soup.id), "reserved food is searchable");

    // B watches the food feed live, like the clients.
    await B.c.realtime.setAuth(await token(B.c));
    const got: Record<string, unknown>[] = [];
    const ch: RealtimeChannel = B.c.channel(`food-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "food_posts", filter: `bubble_id=eq.${b.id}` }, (p) => got.push(p.new as Record<string, unknown>));
    await new Promise<void>((res, rej) => ch.subscribe((s) => (s === "SUBSCRIBED" ? res() : s === "CHANNEL_ERROR" || s === "TIMED_OUT" ? rej(new Error(s)) : null)));
    await sleep(1500);

    // Hand over: taken, handed_over_at set, B missed + pushed, A received; B gets the UPDATE live; search skips it.
    await must(O.c.rpc("hand_over_item", { p_kind: "food", p_item_id: soup.id }), "hand over soup");
    const row = await itemRow("food_posts", soup.id);
    assert(row.availability === "taken" && row.handed_over_at, "taken with handed_over_at");
    await assertStatuses(soup.id, { [A.id]: "received", [B.id]: "missed" }, "outcomes");
    assertEq((await outbox(B.id, "item_missed")).length, 1, "B pushed");
    assertEq((await outbox(A.id, "item_picked")).length, 1, "A was pushed at pick time");
    assert(await until(() => got.some((r) => r.id === soup.id && r.availability === "taken")), "members get the hand-over live");
    await B.c.removeChannel(ch);
    assert(!(await search(B.c, `zanzibar${tag}`)).includes(soup.id), "handed-over food not in search");

    // Expired: invisible to everyone (owner too), not searchable, photo not signable, not requestable.
    const salad = await addFood(O, b.id, `Salad quokka${tag}`, inDays(1), `${O.id}/salad-${tag}.jpg`);
    await must(A.c.rpc("request_item", { p_kind: "food", p_item_id: salad.id }), "A asks for salad");
    const canRead = async (c: SupabaseClient) => await must(c.rpc("can_read_image", { p_bucket: "food.images", p_name: `${O.id}/salad-${tag}.jpg` }), "can_read_image");
    assertEq(await canRead(B.c), false, "path must be referenced by URL form"); // the row stores a bare path here
    await sql`update public.food_posts set image = ${`http://127.0.0.1:55321/storage/v1/object/public/food.images/${O.id}/salad-${tag}.jpg`} where id = ${salad.id}`;
    assertEq(await canRead(B.c), true, "member may sign the live post's photo");
    await sql`update public.food_posts set expires_at = now() - interval '1 minute' where id = ${salad.id}`;
    for (const m of [O, A, B]) {
      assertEq((await must(m.c.from("food_posts").select("id").eq("id", salad.id), "read")).length, 0, `${m.name}: expired post hidden`);
    }
    assertEq(await canRead(B.c), false, "expired photo not signable");
    assert(!(await search(B.c, `quokka${tag}`)).includes(salad.id), "expired food not in search");
    await fails(B.c.rpc("request_item", { p_kind: "food", p_item_id: salad.id }), "item not available", "expired food can't be requested");
    await fails(O.c.rpc("pick_item_request", { p_request_id: (await sql`select id from public.item_requests where item_id = ${salad.id}`)[0].id }), "item not available", "no pick on expired");
    assert(rb.id, "B's soup request existed");
  } finally {
    await cleanupUsers();
  }
});

Deno.test("realtime: the owner gets request INSERT/DELETE, other members get only the count", opts, async () => {
  const chans: [SupabaseClient, RealtimeChannel][] = [];
  try {
    const O = await member(`IRR Owner ${tag}`);
    const A = await member(`IRR Ana ${tag}`);
    const M = await member(`IRR Mia ${tag}`);
    const b = await bubbleWith(O, [A, M], `IRR ${tag}`);
    const item = await addMarket(O, b.id, `Bike ${tag}`);
    const events: Record<string, { req: string[]; counts: number[] }> = { O: { req: [], counts: [] }, M: { req: [], counts: [] } };
    for (const [k, m] of [["O", O], ["M", M]] as const) {
      await m.c.realtime.setAuth(await token(m.c));
      const ch = m.c.channel(`ir-${crypto.randomUUID()}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "item_requests", filter: `bubble_id=eq.${b.id}` }, (p) => events[k].req.push(p.eventType))
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "item_requests", filter: `bubble_id=eq.${b.id}` }, (p) => events[k].req.push(p.eventType))
        // Realtime can't filter deletes: unfiltered, primary key only (the spec's client rule).
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "item_requests" }, (p) => events[k].req.push(p.eventType))
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "market_items", filter: `bubble_id=eq.${b.id}` }, (p) => events[k].counts.push((p.new as { request_count: number }).request_count));
      await new Promise<void>((res, rej) => ch.subscribe((s) => (s === "SUBSCRIBED" ? res() : s === "CHANNEL_ERROR" || s === "TIMED_OUT" ? rej(new Error(s)) : null)));
      chans.push([m.c, ch]);
    }
    await sleep(1500);
    const r = await must(A.c.rpc("request_item", { p_kind: "market", p_item_id: item.id, p_note: "secret note" }), "A asks");
    assert(await until(() => events.O.req.includes("INSERT")), "owner gets the INSERT");
    assert(await until(() => events.M.counts.includes(1)), "M gets the count UPDATE");
    await must(O.c.rpc("pick_item_request", { p_request_id: r.id }), "pick");
    assert(await until(() => events.O.req.includes("UPDATE")), "owner gets the UPDATE");
    await must(A.c.rpc("withdraw_item_request", { p_request_id: r.id }), "withdraw");
    assert(await until(() => events.O.req.includes("DELETE")), "owner gets the DELETE (id only)");
    await sleep(1000);
    assertEq(events.M.req.filter((e) => e !== "DELETE"), [], "M never receives request rows (DELETE carries only a random id)");
  } finally {
    for (const [c, ch] of chans) await c.removeChannel(ch).catch(() => {});
    await cleanupUsers();
  }
});

Deno.test("push: per-bubble mute and the request_updates pref are respected", opts, async () => {
  try {
    const O = await member(`IRP Owner ${tag}`);
    const A = await member(`IRP Ana ${tag}`);
    const B = await member(`IRP Ben ${tag}`);
    const b = await bubbleWith(O, [A, B], `IRP ${tag}`);
    const item = await addMarket(O, b.id, `Desk ${tag}`);
    // O mutes the bubble: no item_request push. A turns request_updates off: no item_picked push.
    await must(O.c.from("bubble_mutes").upsert({ user_id: O.id, bubble_id: b.id, until: null }), "mute");
    await must(A.c.from("notification_prefs").update({ request_updates: false }).eq("user_id", A.id), "prefs");
    const ra = await must(A.c.rpc("request_item", { p_kind: "market", p_item_id: item.id }), "A asks");
    assertEq((await outbox(O.id, "item_request")).length, 0, "muted owner not pushed");
    await must(O.c.rpc("pick_item_request", { p_request_id: ra.id }), "pick A");
    assertEq((await outbox(A.id, "item_picked")).length, 0, "request_updates off: no push");
    // Unmuted again: B's request reaches the owner.
    await must(O.c.from("bubble_mutes").delete().eq("user_id", O.id).eq("bubble_id", b.id), "unmute");
    await must(O.c.rpc("unpick_item", { p_kind: "market", p_item_id: item.id }), "unpick");
    await must(B.c.rpc("request_item", { p_kind: "market", p_item_id: item.id }), "B asks");
    const rows = await outbox(O.id, "item_request");
    assertEq(rows.map((r) => [r.actor_id, r.target_id, r.payload.kind, r.collapse_key]), [[B.id, item.id, "market", `item_request:${item.id}`]], "owner pushed for B");
  } finally {
    await cleanupUsers();
  }
});

Deno.test("push: claim_push_batch renders item data and skips withdrawn or expired targets", opts, async () => {
  try {
    const O = await member(`IRC Owner ${tag}`);
    const A = await member(`IRC Ana ${tag}`);
    const b = await bubbleWith(O, [A], `IRC ${tag}`);
    const item = await addMarket(O, b.id, `Rug ${tag}`);
    const food = await addFood(O, b.id, `Pie ${tag}`);
    const rm = await must(A.c.rpc("request_item", { p_kind: "market", p_item_id: item.id, p_note: "pretty please" }), "A asks rug");
    const rf = await must(A.c.rpc("request_item", { p_kind: "food", p_item_id: food.id }), "A asks pie");
    // Park the dispatcher's view of these rows: claim them ourselves, in a transaction we roll back.
    const ids = (await sql`select id from public.notification_outbox where recipient_id = ${O.id} and type = 'item_request' order by id`).map((r) => Number(r.id));
    assertEq(ids.length, 2, "two pushes queued for the owner");
    await must(A.c.rpc("withdraw_item_request", { p_request_id: rf.id }), "A withdraws the pie request");
    // Claim them ourselves in a transaction that is rolled back (the dry-run dispatcher may have sent them already).
    const claimed = await sql.begin(async (tx) => {
      await tx`update public.notification_outbox set status = 'pending', claimed_until = null, attempts = 0, next_attempt_at = now() where id = any(${ids})`;
      await tx`update public.notification_outbox set next_attempt_at = now() + interval '1 day' where status = 'pending' and not (id = any(${ids}))`;
      const [r] = await tx`select public.claim_push_batch(500) as items`;
      const skipped = await tx`select id, status, last_error from public.notification_outbox where id = any(${ids}) order by id`;
      throw { rollback: true, items: r.items, skipped };
    }).catch((e) => e);
    assert(claimed.rollback, `claim ran: ${claimed}`);
    const mine = (claimed.items as { id: number; type: string; data: Record<string, unknown>; target_id: string; actor_name: string }[]).filter((i) => ids.includes(i.id));
    assertEq(mine.length, 1, "only the open request is pushed");
    assertEq([mine[0].type, mine[0].target_id, mine[0].data, mine[0].actor_name], ["item_request", item.id, { item: `Rug ${tag}`, kind: "market", note: "pretty please" }, A.name], "rendered data");
    assertEq(claimed.skipped.find((s: { id: string }) => Number(s.id) === ids[1])?.last_error, "content_gone", "withdrawn request skipped");
    assert(rm.id, "rug request");
  } finally {
    await cleanupUsers();
  }
});

Deno.test("sweep: expired (> 24 h) and handed-over (> 1 h) food rows go, reported ones stay, photos deleted through Storage", opts, async () => {
  const paths: string[] = [];
  try {
    const O = await member(`IRS Owner ${tag}`);
    const A = await member(`IRS Ana ${tag}`);
    const b = await bubbleWith(O, [A], `IRS ${tag}`);
    const url = (p: string) => admin.storage.from("food.images").getPublicUrl(p).data.publicUrl;
    const post = async (name: string) => {
      const p = `${O.id}/${name}-${crypto.randomUUID()}.jpg`;
      paths.push(p);
      const up = await O.c.storage.from("food.images").upload(p, JPEG, { contentType: "image/jpeg" });
      assert(!up.error, `upload ${name}: ${up.error?.message}`);
      return { path: p, id: (await addFood(O, b.id, name, inDays(1), url(p))).id };
    };
    const oldExpired = await post("old-expired");
    const freshExpired = await post("fresh-expired");
    const handed = await post("handed");
    const reported = await post("reported");
    const live = await post("live");
    await must(A.c.rpc("request_item", { p_kind: "food", p_item_id: oldExpired.id }), "a request on the old post");
    await sql`update public.food_posts set expires_at = now() - interval '25 hours' where id in (${oldExpired.id}, ${reported.id})`;
    await sql`update public.food_posts set expires_at = now() - interval '2 hours' where id = ${freshExpired.id}`;
    await sql`update public.food_posts set availability = 'taken' where id = ${handed.id}`;
    await sql`update public.food_posts set handed_over_at = now() - interval '2 hours' where id = ${handed.id}`;
    await sql`insert into public.reports (reporter_id, bubble_id, target_type, target_id, reported_user_id, reason)
              values (${A.id}, ${b.id}, 'food_post', ${reported.id}, ${O.id}, 'spam')`;

    const due = (await sql`select public.food_posts_due_for_sweep() as id`).map((r) => r.id);
    assert(due.includes(oldExpired.id) && due.includes(handed.id), "old expired + handed over are due");
    assert(!due.includes(freshExpired.id) && !due.includes(reported.id) && !due.includes(live.id), "fresh expired, reported and live are not");
    assert((await O.c.rpc("sweep_food_posts", {})).error, "clients can't sweep");

    const [res] = await sql`select public.sweep_food_posts(${KONG_FROM_DB}, ${SERVICE_KEY}, '0 seconds'::interval) as r`;
    assert(res.r.deleted_posts >= 2 && res.r.photos_requested >= 2, `sweep result ${JSON.stringify(res.r)}`);
    const left = (await sql`select id from public.food_posts where id in (${oldExpired.id}, ${freshExpired.id}, ${handed.id}, ${reported.id}, ${live.id})`).map((r) => r.id);
    assertEq(left.sort(), [freshExpired.id, reported.id, live.id].sort(), "rows left");
    assertEq((await sql`select 1 from public.item_requests where item_id = ${oldExpired.id}`).length, 0, "its requests cascaded");
    const exists = async (p: string) => (await sql`select 1 from storage.objects where bucket_id = 'food.images' and name = ${p}`).length === 1;
    assert(await until(async () => !(await exists(oldExpired.path)) && !(await exists(handed.path)), 15000), "swept photos deleted by the Storage API");
    assert(await exists(live.path) && await exists(reported.path) && await exists(freshExpired.path), "referenced photos kept");
  } finally {
    await admin.storage.from("food.images").remove(paths);
    await cleanupUsers();
  }
});

Deno.test("data export: own requests, requests on my items, food expiry", opts, async () => {
  try {
    const O = await member(`IRE Owner ${tag}`);
    const A = await member(`IRE Ana ${tag}`);
    const b = await bubbleWith(O, [A], `IRE ${tag}`);
    const item = await addMarket(O, b.id, `Kettle ${tag}`);
    const food = await addFood(A, b.id, `Bread ${tag}`, inDays(2));
    await must(A.c.rpc("request_item", { p_kind: "market", p_item_id: item.id, p_note: "kettle please" }), "A asks O");
    await must(O.c.rpc("request_item", { p_kind: "food", p_item_id: food.id, p_note: "bread please" }), "O asks A");

    const sent = await deviceCode(A.c, { action: "send", purpose: "sensitive_action", sensitive_action: "export_data" });
    assertEq(sent.status, 200, `send code: ${JSON.stringify(sent.body)}`);
    const mail = await waitMail(A.email, { subject: /confirmation code/i });
    const ok = await deviceCode(A.c, { action: "verify", purpose: "sensitive_action", code: codeOf(mail) });
    assertEq(ok.status, 200, `verify: ${JSON.stringify(ok.body)}`);
    const doc = await must(A.c.rpc("export_my_data"), "export");
    assertEq(doc.item_requests.map((r: Record<string, unknown>) => [r.item_kind, r.item_id, r.item, r.note, r.status]),
      [["market", item.id, `Kettle ${tag}`, "kettle please", "pending"]], "own requests, with the item label");
    assertEq(doc.requests_on_my_items.map((r: Record<string, unknown>) => [r.item_kind, r.item_id, r.requester_id, r.note]),
      [["food", food.id, O.id, "bread please"]], "requests on my items, with the requester id");
    assertEq(doc.food_posts.map((f: Record<string, unknown>) => [f.id, f.availability, Boolean(f.expires_at)]), [[food.id, "available", true]], "food with expiry");
    assert(Array.isArray(doc.chat_messages) && doc.format === "boolaa-data-export", "rest of the document intact");
    await fails(A.c.rpc("export_my_data"), "export rate limited", "rate limit still applies");
    assert((await A.c.rpc("export_my_data_core")).error, "core not callable");
  } finally {
    await cleanupUsers();
  }
});

Deno.test("push-dispatch (dry run): request pushes rendered with the item and an item_kind deep link", opts, async () => {
  try {
    const O = await member(`IRD Owner ${tag}`);
    const A = await member(`IRD Ana ${tag}`);
    const b = await bubbleWith(O, [A], `IRD ${tag}`);
    const tok = (await sql`select token from public.push_tokens where user_id = ${O.id}`)[0].token as string;
    const aTok = (await sql`select token from public.push_tokens where user_id = ${A.id}`)[0].token as string;
    const food = await addFood(O, b.id, `Lasagna ${tag}`);
    const r = await must(A.c.rpc("request_item", { p_kind: "food", p_item_id: food.id, p_note: "I'll bring a box" }), "A asks");
    // deno-lint-ignore no-explicit-any
    const logFor = async (t: string) =>
      (await sql<any[]>`select * from public.push_debug_log where token = ${t} order by id`)
        .filter((l) => String(l.request?.payload?.message?.data?.type ?? "").startsWith("item_"));
    assert(await until(async () => (await logFor(tok)).length > 0, 20000), "owner's push went out");
    const [o] = await logFor(tok);
    assertEq([o.title, o.body], [`IRD Ana ${tag} wants “Lasagna ${tag}”`, "“I'll bring a box”"], "owner text");
    assertEq(o.request.payload.message.data, { type: "item_request", bubble_id: b.id, item_kind: "food", target_id: food.id, collapse_key: `item_request:${food.id}` }, "deep link");
    await must(O.c.rpc("pick_item_request", { p_request_id: r.id }), "pick");
    assert(await until(async () => (await logFor(aTok)).length > 0, 20000), "winner's push went out");
    const [a] = await logFor(aTok);
    assertEq([a.title, a.request.payload.message.data.type], [`It's yours: “Lasagna ${tag}”`, "item_picked"], "winner text");
  } finally {
    await cleanupUsers();
  }
});
