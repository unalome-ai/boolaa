// Chat improvements (migration 20261123120000_chat_improvements.sql, docs/boolaa-spec.md "Chat"),
// through the real GoTrue + PostgREST + Storage + Realtime of the LOCAL stack:
//
//   deno test -A --no-check supabase/tests/chat.test.ts
//
// Older pages (keyset), soft delete of your own message (live, report evidence kept), photos in the
// private chat.images bucket, unread counts and the last-read marker. Throwaway users and bubbles
// only; never changes app_settings flags. The seeded admin is mod@boolaa.test.
import type { RealtimeChannel, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { admin, assert, assertEq, cleanupUsers, createUser, sha256Hex, signIn, sleep, sql, TEST_DEVICE, token } from "./helpers.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);

async function verified(email: string) {
  const c = await signIn(email);
  const st = await c.rpc("start_device_check", { p_device_id: TEST_DEVICE });
  assertEq(st.data?.status, "verified", `device check for ${email}`);
  return c;
}

async function member(name: string) {
  const u = await createUser({ name });
  await sql`select public.trust_device(${u.id}::uuid, ${await sha256Hex(TEST_DEVICE)}, 'test')`;
  return { ...u, c: await verified(u.email) };
}
type Member = Awaited<ReturnType<typeof member>>;

/** Owner + the given extra members in a fresh bubble (each admitted by majority vote). */
async function bubbleWith(tag: string, names: string[]) {
  const owner = await member(`Owner ${tag}`);
  const { data: bubble, error } = await owner.c.rpc("create_bubble", { p_name: `Chat ${tag}`.slice(0, 60) });
  assert(!error, `create_bubble: ${error?.message}`);
  const members: Member[] = [owner];
  for (const n of names) {
    const m = await member(`${n} ${tag}`);
    const { data: req } = await m.c.rpc("request_to_join", { p_invite_code: bubble.invite_code });
    for (const v of members) await v.c.rpc("approve_join_request", { p_request_id: req.id });
    members.push(m);
  }
  return { bubble: bubble as { id: string; invite_code: string }, members };
}

async function send(m: Member, bubbleId: string, content: string, image_path?: string) {
  const { data, error } = await m.c.from("chat_messages")
    .insert({ bubble_id: bubbleId, sender_id: m.id, content, ...(image_path ? { image_path } : {}) })
    .select("*").single();
  if (error) throw new Error(`send: ${error.message}`);
  return data as { id: string; created_at: string; content: string; image_path: string | null; deleted_at: string | null };
}

async function upload(m: Member) {
  const path = `${m.id}/${crypto.randomUUID()}.jpg`;
  const { error } = await m.c.storage.from("chat.images").upload(path, JPEG, { contentType: "image/jpeg" });
  if (error) throw new Error(`upload: ${error.message}`);
  return path;
}

async function canRead(c: SupabaseClient, path: string) {
  const { data, error } = await c.storage.from("chat.images").createSignedUrl(path, 60);
  if (error || !data?.signedUrl) return false;
  const res = await fetch(data.signedUrl);
  await res.body?.cancel();
  return res.ok;
}

const unread = async (c: SupabaseClient, bubbleId: string) => {
  const { data, error } = await c.rpc("chat_unread_counts");
  if (error) throw new Error(`chat_unread_counts: ${error.message}`);
  return (data as { bubble_id: string; unread_count: number; last_read_at: string }[]).find((r) => r.bubble_id === bubbleId);
};

Deno.test("older pages: keyset on (created_at, id), server-set timestamps", opts, async () => {
  const tag = `${Date.now()}`;
  try {
    const { bubble, members: [a, b] } = await bubbleWith(tag, ["Bea"]);
    // Backdating is ignored: the server sets created_at.
    const back = await send(a, bubble.id, "backdated?");
    assert(Date.now() - Date.parse(back.created_at) < 60_000, "created_at is now");
    const { error: e } = await a.c.from("chat_messages")
      .insert({ bubble_id: bubble.id, sender_id: a.id, content: "old", created_at: "2001-01-01T00:00:00Z" });
    assert(!e, `insert: ${e?.message}`);
    const { data: old } = await a.c.from("chat_messages").select("created_at").eq("content", "old").eq("bubble_id", bubble.id).single();
    assert(old!.created_at.startsWith("20") && !old!.created_at.startsWith("2001"), "backdate ignored");

    // 57 more messages in one statement share created_at: ties are broken by id.
    await sql`insert into public.chat_messages (bubble_id, sender_id, content)
              select ${bubble.id}::uuid, ${b.id}::uuid, 'm' || g from generate_series(1, 57) g`;
    const all: { id: string; created_at: string }[] = [];
    let cursor: { created_at: string; id: string } | null = null;
    for (let page = 0; page < 5; page++) {
      let q = b.c.from("chat_messages").select("id, created_at").eq("bubble_id", bubble.id)
        .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(25);
      if (cursor) q = q.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
      const { data, error } = await q;
      assert(!error, `page: ${error?.message}`);
      all.push(...data!);
      if (data!.length < 25) break;
      cursor = data![data!.length - 1];
    }
    assertEq(all.length, 59, "every message exactly once");
    assertEq(new Set(all.map((m) => m.id)).size, 59, "no duplicates across pages");

    // The same through chat_messages_page (what the clients use), with the sender embedded.
    const viaRpc: { id: string; sender: { name: string } | null }[] = [];
    let before: string | null = null;
    for (let page = 0; page < 5; page++) {
      const { data, error } = await b.c.rpc("chat_messages_page", { p_bubble_id: bubble.id, p_before_id: before, p_limit: 25 })
        .select("*, sender:users!sender_id(id, name, avatar)");
      assert(!error, `rpc page: ${error?.message}`);
      viaRpc.push(...(data as typeof viaRpc));
      if (data!.length < 25) break;
      before = (data as typeof viaRpc)[data!.length - 1].id;
    }
    assertEq(viaRpc.map((m) => m.id), all.map((m) => m.id), "rpc pages match the keyset order");
    assert(viaRpc.every((m) => m.sender?.name), "sender embedded");
    const outsider = await member(`Out ${tag}`);
    const none = await outsider.c.rpc("chat_messages_page", { p_bubble_id: bubble.id });
    assertEq(none.data?.length ?? 0, 0, "non-members get nothing");
  } finally {
    await cleanupUsers();
  }
});

Deno.test("delete own message: soft delete, author only, live UPDATE, no hard delete", opts, async () => {
  const tag = `${Date.now()}`;
  let ch: RealtimeChannel | null = null;
  try {
    const { bubble, members: [a, b] } = await bubbleWith(tag, ["Bea"]);
    const msg = await send(a, bubble.id, `secret ${tag}`);

    // Bea listens like the clients: INSERT and UPDATE filtered by bubble.
    const got: { type: string; row: Record<string, unknown> }[] = [];
    await b.c.realtime.setAuth(await token(b.c));
    ch = b.c.channel(`chat-${crypto.randomUUID()}`);
    for (const event of ["INSERT", "UPDATE"] as const) {
      ch = ch.on("postgres_changes", { event, schema: "public", table: "chat_messages", filter: `bubble_id=eq.${bubble.id}` },
        (p) => got.push({ type: p.eventType, row: p.new as Record<string, unknown> }));
    }
    await new Promise<void>((res, rej) =>
      ch!.subscribe((s) => (s === "SUBSCRIBED" ? res() : s === "CHANNEL_ERROR" || s === "TIMED_OUT" ? rej(new Error(s)) : null)));
    await sleep(1500);

    const notMine = await b.c.rpc("delete_chat_message", { p_message_id: msg.id });
    assertEq(notMine.error?.message, "message not found", "only the author can delete");

    // Clients can no longer hard-delete.
    const hard = await a.c.from("chat_messages").delete().eq("id", msg.id).select("id");
    assertEq(hard.data?.length ?? 0, 0, "no hard delete");
    // ...nor edit.
    const edit = await a.c.from("chat_messages").update({ content: "edited" }).eq("id", msg.id).select("id");
    assertEq(edit.data?.length ?? 0, 0, "no update");

    const del = await a.c.rpc("delete_chat_message", { p_message_id: msg.id });
    assert(!del.error, `delete: ${del.error?.message}`);
    assertEq(del.data, { id: msg.id, image_path: null }, "returns no photo");
    const again = await a.c.rpc("delete_chat_message", { p_message_id: msg.id });
    assert(!again.error, "idempotent");

    const { data: row } = await b.c.from("chat_messages").select("content, image_path, deleted_at").eq("id", msg.id).single();
    assertEq(row!.content, "", "text wiped");
    assert(row!.deleted_at, "placeholder stays, marked deleted");

    for (let t = 0; t < 60 && !got.some((g) => g.type === "UPDATE"); t++) await sleep(100);
    const upd = got.find((g) => g.type === "UPDATE");
    assert(upd, "member got the deletion live");
    assertEq([upd!.row.id, upd!.row.content, !!upd!.row.deleted_at], [msg.id, "", true], "UPDATE carries the placeholder");
    const [{ n }] = await sql`select count(*)::int n from public.chat_message_evidence where message_id = ${msg.id}`;
    assertEq(n, 0, "no evidence without an open report");
  } finally {
    if (ch) await ch.unsubscribe();
    await cleanupUsers();
  }
});

Deno.test("photos: private bucket, members read while the message lives, blocks and deletion revoke", opts, async () => {
  const tag = `${Date.now()}`;
  try {
    const { bubble, members: [a, b, c] } = await bubbleWith(tag, ["Bea", "Cy"]);
    const outsider = await member(`Out ${tag}`);
    const [{ pub }] = await sql`select public as pub from storage.buckets where id = 'chat.images'`;
    assertEq(pub, false, "chat.images is private");

    // Uploads only into your own folder.
    const foreign = await a.c.storage.from("chat.images").upload(`${b.id}/${crypto.randomUUID()}.jpg`, JPEG, { contentType: "image/jpeg" });
    assert(foreign.error, "can't upload into someone else's folder");
    const png = await a.c.storage.from("chat.images").upload(`${a.id}/${crypto.randomUUID()}.png`, JPEG, { contentType: "image/png" });
    assert(png.error, "PNG refused by allowed_mime_types");

    const path = await upload(a);
    // Before a message references it, only the owner can read it.
    assert(await canRead(a.c, path), "owner reads own upload");
    assert(!(await canRead(b.c, path)), "member can't read an unreferenced upload");

    // Messages can only reference your own, uploaded photo.
    const notUploaded = await a.c.from("chat_messages")
      .insert({ bubble_id: bubble.id, sender_id: a.id, content: "", image_path: `${a.id}/${crypto.randomUUID()}.jpg` });
    assert(notUploaded.error, "photo must be uploaded first");
    const stolen = await b.c.from("chat_messages").insert({ bubble_id: bubble.id, sender_id: b.id, content: "", image_path: path });
    assert(stolen.error, "can't reference another user's photo");
    const empty = await a.c.from("chat_messages").insert({ bubble_id: bubble.id, sender_id: a.id, content: "" });
    assert(empty.error, "text or photo required");

    const msg = await send(a, bubble.id, "", path); // photo without caption
    assertEq(msg.image_path, path, "photo message");
    const reuse = await a.c.from("chat_messages").insert({ bubble_id: bubble.id, sender_id: a.id, content: "again", image_path: path });
    assert(reuse.error, "one message per photo");

    assert(await canRead(b.c, path), "member reads the photo via a signed URL");
    assert(!(await canRead(outsider.c, path)), "outsider can't");
    const publicUrl = a.c.storage.from("chat.images").getPublicUrl(path).data.publicUrl;
    const pubRes = await fetch(publicUrl);
    await pubRes.body?.cancel();
    assert(!pubRes.ok, "no public URL");

    // Block: Cy blocks Ana -> neither the message nor the photo for Cy.
    await c.c.from("blocks").insert({ blocker_id: c.id, blocked_id: a.id });
    assert(!(await canRead(c.c, path)), "blocked member can't read");

    // Deleting the message returns the photo path; members lose access at once.
    const del = await a.c.rpc("delete_chat_message", { p_message_id: msg.id });
    assertEq(del.data, { id: msg.id, image_path: path }, "client is told to remove the photo");
    assert(!(await canRead(b.c, path)), "member loses access after deletion");
    const rm = await a.c.storage.from("chat.images").remove([path]);
    assertEq(rm.data?.length, 1, "owner removes the object");

    // Account deletion cleanup: the owner can list and remove their folder.
    const p2 = await upload(a);
    const { data: listed } = await a.c.storage.from("chat.images").list(a.id);
    assert(listed?.some((f) => `${a.id}/${f.name}` === p2), "owner lists own folder");
    const { data: otherList } = await b.c.storage.from("chat.images").list(a.id);
    assertEq(otherList?.length ?? 0, 0, "others can't list it");
    await a.c.storage.from("chat.images").remove([p2]);
  } finally {
    await cleanupUsers();
  }
});

Deno.test("report evidence: deleting a reported message keeps it for admins; resolving cleans up", opts, async () => {
  const tag = `${Date.now()}`;
  try {
    const { bubble, members: [a, b] } = await bubbleWith(tag, ["Troll"]);
    const path = await upload(b);
    const msg = await send(b, bubble.id, `nasty ${tag}`, path);
    const rep = await a.c.rpc("report_content", { p_target_type: "chat_message", p_target_id: msg.id, p_reason: "harassment" });
    assert(!rep.error, `report: ${rep.error?.message}`);

    const mod = await verified("mod@boolaa.test");
    let snap = (await mod.rpc("admin_get_report", { p_report_id: rep.data })).data.snapshot;
    assertEq([snap.text, snap.image_path, snap.image_bucket, snap.deleted], [`nasty ${tag}`, path, "chat.images", false], "live snapshot");
    assert(await canRead(mod, path), "admin can view the reported photo");

    // The troll deletes it: members see a placeholder, the photo stays as evidence.
    const del = await b.c.rpc("delete_chat_message", { p_message_id: msg.id });
    assertEq(del.data, { id: msg.id, image_path: null }, "photo kept while the report is open");
    const { data: row } = await a.c.from("chat_messages").select("content, image_path, deleted_at").eq("id", msg.id).single();
    assertEq([row!.content, row!.image_path], ["", null], "members see nothing");
    assert(!(await canRead(a.c, path)), "members can't read the evidence photo");
    const ev = await a.c.from("chat_message_evidence").select("*");
    assert(ev.error || (ev.data ?? []).length === 0, "evidence is not client-readable");

    snap = (await mod.rpc("admin_get_report", { p_report_id: rep.data })).data.snapshot;
    assertEq([snap.text, snap.image_path, snap.deleted_by_author, snap.deleted], [`nasty ${tag}`, path, true, false], "evidence snapshot");
    assert(await canRead(mod, path), "admin still views the evidence photo");

    // Dismissing still removes the photo: its author deleted the message.
    const res = await mod.rpc("admin_resolve_report", { p_report_id: rep.data, p_action: "dismiss", p_note: "chat test" });
    assert(!res.error, `resolve: ${res.error?.message}`);
    assertEq([res.data.image_bucket, res.data.image_path], ["chat.images", path], "names the photo");
    const rm = await mod.storage.from("chat.images").remove([path]);
    assertEq(rm.data?.length, 1, "admin view removes it");
    const [{ n }] = await sql`select count(*)::int n from public.chat_message_evidence where message_id = ${msg.id}`;
    assertEq(n, 0, "evidence dropped once no report is open");

    // delete_content on a live photo message names the photo as before.
    const p2 = await upload(b);
    const m2 = await send(b, bubble.id, "", p2);
    const r2 = await a.c.rpc("report_content", { p_target_type: "chat_message", p_target_id: m2.id, p_reason: "spam" });
    const res2 = await mod.rpc("admin_resolve_report", { p_report_id: r2.data, p_action: "delete_content" });
    assertEq([res2.data.image_bucket, res2.data.image_path], ["chat.images", p2], "delete_content names the photo");
    assertEq((await mod.storage.from("chat.images").remove([p2])).data?.length, 1, "admin removes it");
    // A photo with no resolution naming it stays out of reach.
    const p3 = await upload(b);
    assertEq((await mod.storage.from("chat.images").remove([p3])).data?.length ?? 0, 0, "admin can't delete other photos");
    await admin.storage.from("chat.images").remove([p3]);

    // The rewritten wrapper keeps the food / marketplace path (20261122210000) intact.
    const fp = `${b.id}/${crypto.randomUUID()}.jpg`;
    await b.c.storage.from("food.images").upload(fp, JPEG, { contentType: "image/jpeg" });
    const url = b.c.storage.from("food.images").getPublicUrl(fp).data.publicUrl;
    const { data: post } = await b.c.from("food_posts").insert({ bubble_id: bubble.id, user_id: b.id, image: url, description: "x" }).select("id").single();
    const r4 = await a.c.rpc("report_content", { p_target_type: "food_post", p_target_id: post!.id, p_reason: "spam" });
    const res4 = await mod.rpc("admin_resolve_report", { p_report_id: r4.data, p_action: "delete_content" });
    assertEq([res4.data.image_bucket, res4.data.image_path], ["food.images", fp], "food photo named");
    assertEq((await mod.storage.from("food.images").remove([fp])).data?.length, 1, "admin removes the food photo");
    // A dismissed live chat message keeps its photo.
    const p5 = await upload(b);
    const m5 = await send(b, bubble.id, "fine", p5);
    const r5 = await a.c.rpc("report_content", { p_target_type: "chat_message", p_target_id: m5.id, p_reason: "other" });
    const res5 = await mod.rpc("admin_resolve_report", { p_report_id: r5.data, p_action: "dismiss" });
    assertEq(res5.data.image_path, undefined, "dismissing a live message names no photo");
    assert(await canRead(a.c, p5), "photo still visible to members");
  } finally {
    await cleanupUsers();
  }
});

Deno.test("unread counts and last-read marker", opts, async () => {
  const tag = `${Date.now()}`;
  try {
    const { bubble, members: [a, b, c] } = await bubbleWith(tag, ["Bea", "Cy"]);
    const start = await unread(b.c, bubble.id);
    assertEq(start?.unread_count, 0, "a new member starts with nothing unread");

    const m1 = await send(a, bubble.id, "one");
    await send(a, bubble.id, "two");
    const m3 = await send(c, bubble.id, "three");
    await send(b, bubble.id, "mine"); // own messages never count
    assertEq((await unread(b.c, bubble.id))?.unread_count, 3, "three unread");

    // Marker moves forward only.
    const at1 = await b.c.rpc("mark_chat_read", { p_bubble_id: bubble.id, p_message_id: m1.id });
    assert(!at1.error, `mark: ${at1.error?.message}`);
    assertEq((await unread(b.c, bubble.id))?.unread_count, 2, "two after reading the first");
    await b.c.rpc("mark_chat_read", { p_bubble_id: bubble.id, p_message_id: m3.id });
    const back = await b.c.rpc("mark_chat_read", { p_bubble_id: bubble.id, p_message_id: m1.id });
    assertEq(Date.parse(back.data), Date.parse(m3.created_at), "never moves back");
    const row = await unread(b.c, bubble.id);
    assertEq([row?.unread_count, Date.parse(row!.last_read_at)], [0, Date.parse(m3.created_at)], "all read");

    // Deleted and blocked messages don't count.
    const m4 = await send(a, bubble.id, "four");
    await send(c, bubble.id, "five");
    assertEq((await unread(b.c, bubble.id))?.unread_count, 2, "two new");
    await a.c.rpc("delete_chat_message", { p_message_id: m4.id });
    assertEq((await unread(b.c, bubble.id))?.unread_count, 1, "deleted one doesn't count");
    await b.c.from("blocks").insert({ blocker_id: b.id, blocked_id: c.id });
    assertEq((await unread(b.c, bubble.id))?.unread_count, 0, "blocked sender doesn't count");

    // Only members, only messages of that bubble; rows are private.
    const outsider = await member(`Out ${tag}`);
    const deny = await outsider.c.rpc("mark_chat_read", { p_bubble_id: bubble.id, p_message_id: m1.id });
    assertEq(deny.error?.message, "not a member of this bubble", "non-member refused");
    assertEq(await unread(outsider.c, bubble.id), undefined, "no row for non-members");
    const { data: others } = await a.c.from("chat_reads").select("*").eq("user_id", b.id);
    assertEq(others?.length ?? 0, 0, "can't read other users' markers");
    const write = await b.c.from("chat_reads").update({ last_read_at: new Date(0).toISOString() }).eq("user_id", b.id).select();
    assert(write.error || (write.data ?? []).length === 0, "no direct writes");

    // The cap: 100+ shows as 100 (clients print 99+).
    await sql`insert into public.chat_messages (bubble_id, sender_id, content)
              select ${bubble.id}::uuid, ${a.id}::uuid, 'flood ' || g from generate_series(1, 130) g`;
    assertEq((await unread(b.c, bubble.id))?.unread_count, 100, "capped at 100");
  } finally {
    await cleanupUsers();
  }
});
