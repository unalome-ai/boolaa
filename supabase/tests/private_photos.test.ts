// Private photos (migration 20261123210000_private_photos.sql, docs/boolaa-spec.md "Images"),
// through the real GoTrue + PostgREST + Storage of the LOCAL stack:
//
//   deno test -A --no-check supabase/tests/private_photos.test.ts
//
// Every photo bucket is private: no public URL works, anon reads nothing, and signed URLs are only
// issued to the callers can_read_image() allows. Throwaway users and bubbles only; never changes
// app_settings flags. The seeded admin is mod@boolaa.test.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { admin, API, assert, assertEq, cleanupUsers, client, createUser, sha256Hex, signIn, sql, TEST_DEVICE } from "./helpers.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const BUCKETS = ["avatars", "food.images", "market.images", "bubble.images", "link.previews", "chat.images"];

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

async function bubbleWith(owner: Member, others: Member[], tag: string) {
  const { data: bubble, error } = await owner.c.rpc("create_bubble", { p_name: `Photos ${tag}`.slice(0, 60) });
  assert(!error, `create_bubble: ${error?.message}`);
  const voters = [owner];
  for (const m of others) {
    const { data: req } = await m.c.rpc("request_to_join", { p_invite_code: bubble.invite_code });
    for (const v of voters) await v.c.rpc("approve_join_request", { p_request_id: req.id });
    voters.push(m);
  }
  return bubble as { id: string; invite_code: string };
}

async function upload(c: SupabaseClient, bucket: string, folder: string) {
  const path = `${folder}/${crypto.randomUUID()}.jpg`;
  const { error } = await c.storage.from(bucket).upload(path, JPEG, { contentType: "image/jpeg" });
  if (error) throw new Error(`upload ${bucket}/${path}: ${error.message}`);
  return path;
}
const publicUrl = (bucket: string, path: string) => `${API}/storage/v1/object/public/${bucket}/${path}`;

/** True when `c` gets a signed URL for the object and the URL downloads it. */
async function canRead(c: SupabaseClient, bucket: string, path: string) {
  const { data, error } = await c.storage.from(bucket).createSignedUrl(path, 60);
  if (error || !data?.signedUrl) return false;
  const res = await fetch(data.signedUrl);
  await res.body?.cancel();
  return res.ok;
}
/** The old public URL and an anon download both fail. */
async function noPublicAccess(bucket: string, path: string) {
  const pub = await fetch(publicUrl(bucket, path));
  await pub.body?.cancel();
  assert(!pub.ok, `public URL refused for ${bucket} (${pub.status})`);
  const anon = await client().storage.from(bucket).download(path);
  assert(anon.error, `anon can't download from ${bucket}`);
  assert(!(await canRead(client(), bucket, path)), `anon can't sign ${bucket}`);
}

let owner: Member, mate: Member, outsider: Member, blocker: Member;
let bubble: { id: string; invite_code: string };
const tag = `${Date.now()}`;

Deno.test({ name: "setup", ...opts, fn: async () => {
  [owner, mate, outsider, blocker] = await Promise.all([
    member(`Pho Owner ${tag}`), member(`Pho Mate ${tag}`), member(`Pho Out ${tag}`), member(`Pho Blocker ${tag}`)]);
  bubble = await bubbleWith(owner, [mate, blocker], tag);
  // The blocker blocks the owner: neither sees the other's posts (or their photos).
  await blocker.c.from("blocks").insert({ blocker_id: blocker.id, blocked_id: owner.id });
}});

Deno.test({ name: "every photo bucket is private", ...opts, fn: async () => {
  const rows = await sql`select id, public from storage.buckets where id in ${sql(BUCKETS)} order by id`;
  assertEq(rows.length, BUCKETS.length, "all buckets exist");
  for (const r of rows) assertEq(r.public, false, `${r.id} is private`);
}});

Deno.test({ name: "avatars: owner and people sharing a bubble (or a join request) read; outsiders and anon don't", ...opts, fn: async () => {
  const path = await upload(owner.c, "avatars", owner.id);
  await owner.c.from("users").update({ avatar: owner.c.storage.from("avatars").getPublicUrl(path).data.publicUrl }).eq("id", owner.id);
  assert(await canRead(owner.c, "avatars", path), "owner");
  assert(await canRead(mate.c, "avatars", path), "member of a shared bubble");
  assert(!(await canRead(outsider.c, "avatars", path)), "outsider");
  await noPublicAccess("avatars", path);
  assert(await canRead(await verified("mod@boolaa.test"), "avatars", path), "admin (users list, profile reports)");

  // A requester's avatar is visible to the members who vote on the request.
  const reqPath = await upload(outsider.c, "avatars", outsider.id);
  assert(!(await canRead(mate.c, "avatars", reqPath)), "not before the request");
  const { data: req } = await outsider.c.rpc("request_to_join", { p_invite_code: bubble.invite_code });
  assert(await canRead(mate.c, "avatars", reqPath), "members see the requester's photo");
  assert(!(await canRead(outsider.c, "avatars", path)), "the requester still can't read members' avatars");
  await outsider.c.from("join_requests").delete().eq("id", req.id);
  assert(!(await canRead(mate.c, "avatars", reqPath)), "gone with the request");

  // Uploads stay in your own folder.
  const foreign = await mate.c.storage.from("avatars").upload(`${owner.id}/${crypto.randomUUID()}.jpg`, JPEG, { contentType: "image/jpeg" });
  assert(foreign.error, "can't upload into someone else's folder");
  await admin.storage.from("avatars").remove([path, reqPath]);
}});

for (const [bucket, table, author, target] of [
  ["food.images", "food_posts", "user_id", "food_post"],
  ["market.images", "market_items", "owner_id", "market_item"],
] as const) {
  Deno.test({ name: `${bucket}: members read a referenced photo; outsiders, blocked members and anon don't; deleting cuts access`, ...opts, fn: async () => {
    const path = await upload(owner.c, bucket, owner.id);
    assert(await canRead(owner.c, bucket, path), "owner reads own upload");
    assert(!(await canRead(mate.c, bucket, path)), "unreferenced upload: members can't read it");

    const url = owner.c.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    const row = table === "food_posts"
      ? { bubble_id: bubble.id, user_id: owner.id, image: url, description: `photo ${tag}` }
      : { bubble_id: bubble.id, owner_id: owner.id, image: url, title: `photo ${tag}` };
    const { data: post, error } = await owner.c.from(table).insert(row as never).select("id").single();
    assert(!error, `insert ${table}: ${error?.message}`);

    assert(await canRead(mate.c, bucket, path), "member reads it");
    assert(!(await canRead(outsider.c, bucket, path)), "outsider can't");
    assert(!(await canRead(blocker.c, bucket, path)), "member in a block relationship can't");
    await noPublicAccess(bucket, path);

    // Pointing your own post at someone else's photo grants nothing.
    const stolenUrl = url;
    const theft = table === "food_posts"
      ? { bubble_id: bubble.id, user_id: mate.id, image: stolenUrl, description: "theft" }
      : { bubble_id: bubble.id, owner_id: mate.id, image: stolenUrl, title: "theft" };
    const outsiderBubble = await bubbleWith(outsider, [], `x${tag}`);
    await outsider.c.from(table).insert({ ...theft, bubble_id: outsiderBubble.id, [author]: outsider.id } as never);
    assert(!(await canRead(outsider.c, bucket, path)), "a row by another author doesn't unlock the photo");

    // Admins: only photos of reported posts.
    const mod = await verified("mod@boolaa.test");
    assert(!(await canRead(mod, bucket, path)), "admin: not without a report");
    const rep = await mate.c.rpc("report_content", { p_target_type: target, p_target_id: post!.id, p_reason: "spam" });
    assert(!rep.error, `report: ${rep.error?.message}`);
    assert(await canRead(mod, bucket, path), "admin reads the reported photo");
    await sql`delete from public.reports where id = ${rep.data as string}`;

    // Deleting the row cuts access at once.
    await owner.c.from(table).delete().eq("id", post!.id);
    assert(!(await canRead(mate.c, bucket, path)), "deleted post: no access");
    assert(await canRead(owner.c, bucket, path), "owner still reads (and can remove) it");
    assertEq((await owner.c.storage.from(bucket).remove([path])).data?.length, 1, "owner removes it");
  }});
}

Deno.test({ name: "bubble.images: members read; a non-member reads the current cover only after a valid invite preview or with a join request", ...opts, fn: async () => {
  const cover = await upload(owner.c, "bubble.images", bubble.id);
  const old = await upload(owner.c, "bubble.images", bubble.id);
  const url = owner.c.storage.from("bubble.images").getPublicUrl(cover).data.publicUrl;
  const { error } = await owner.c.from("bubbles").update({ logo: url }).eq("id", bubble.id);
  assert(!error, `set logo: ${error?.message}`);

  assert(await canRead(mate.c, "bubble.images", cover), "member reads the cover");
  assert(!(await canRead(outsider.c, "bubble.images", cover)), "outsider can't before a preview");
  await noPublicAccess("bubble.images", cover);

  const stranger = await member(`Pho Stranger ${tag}`);
  const bad = await stranger.c.rpc("get_invite_preview", { p_code: "ZZZZ-ZZZZ" });
  assertEq(bad.data?.length ?? 0, 0, "unknown code: no preview");
  assert(!(await canRead(stranger.c, "bubble.images", cover)), "no grant from a wrong code");
  const prev = await stranger.c.rpc("get_invite_preview", { p_code: bubble.invite_code });
  assertEq(prev.data?.[0]?.logo, url, "preview returns the cover");
  assert(await canRead(stranger.c, "bubble.images", cover), "valid preview: the cover is readable");
  assert(!(await canRead(stranger.c, "bubble.images", old)), "but not other files in the bubble's folder");
  await sql`update public.invite_preview_grants set at = now() - interval '2 hours' where user_id = ${stranger.id}`;
  assert(!(await canRead(stranger.c, "bubble.images", cover)), "the grant expires after an hour");

  // A pending requester keeps seeing it (bubble-approval screen).
  const { data: req } = await stranger.c.rpc("request_to_join", { p_invite_code: bubble.invite_code });
  assert(await canRead(stranger.c, "bubble.images", cover), "pending requester reads the cover");
  await stranger.c.from("join_requests").delete().eq("id", req.id);

  // Replacing the cover: non-members lose the old one.
  await stranger.c.rpc("get_invite_preview", { p_code: bubble.invite_code });
  const next = await upload(owner.c, "bubble.images", bubble.id);
  await owner.c.from("bubbles").update({ logo: owner.c.storage.from("bubble.images").getPublicUrl(next).data.publicUrl }).eq("id", bubble.id);
  assert(!(await canRead(stranger.c, "bubble.images", cover)), "old cover gone for non-members");
  assert(await canRead(stranger.c, "bubble.images", next), "new cover readable");
  await owner.c.from("bubbles").update({ logo: null }).eq("id", bubble.id);
  await admin.storage.from("bubble.images").remove([cover, old, next]);
}});

Deno.test({ name: "link.previews: members read a link's preview image; outsiders, blocked members and anon don't", ...opts, fn: async () => {
  const { data: link, error } = await owner.c.from("shared_links")
    .insert({ bubble_id: bubble.id, user_id: owner.id, url: `https://example.org/${tag}`, title: "x" }).select("id").single();
  assert(!error, `link: ${error?.message}`);
  const path = `${link!.id}/${crypto.randomUUID()}.jpg`;
  await admin.storage.from("link.previews").upload(path, JPEG, { contentType: "image/jpeg" });
  assert(!(await canRead(mate.c, "link.previews", path)), "not before the link references it");
  await sql`update public.shared_links set preview_status = 'ready', preview_image_path = ${path} where id = ${link!.id}`;

  assert(await canRead(mate.c, "link.previews", path), "member reads it");
  assert(!(await canRead(outsider.c, "link.previews", path)), "outsider can't");
  assert(!(await canRead(blocker.c, "link.previews", path)), "blocked member can't");
  await noPublicAccess("link.previews", path);
  const write = await mate.c.storage.from("link.previews").upload(`${link!.id}/${crypto.randomUUID()}.jpg`, JPEG, { contentType: "image/jpeg" });
  assert(write.error, "clients can't write link previews");

  await owner.c.from("shared_links").delete().eq("id", link!.id);
  assert(!(await canRead(mate.c, "link.previews", path)), "deleted link: no access");
  await admin.storage.from("link.previews").remove([path]);
}});

Deno.test({ name: "teardown", ...opts, fn: async () => {
  await cleanupUsers();
  await sql.end();
}});
