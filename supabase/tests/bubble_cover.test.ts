// Bubble logo / cover image (migration 20261123130000_bubble_cover.sql), against the LOCAL stack:
//
//   deno test -A --no-check supabase/tests/bubble_cover.test.ts
//
// Throwaway users and bubbles only. Never changes app_settings flags.
import type { RealtimeChannel } from "npm:@supabase/supabase-js@2";
import { admin, assert, assertEq, cleanupUsers, createUser, SERVICE_KEY, sha256Hex, signIn, sleep, sql, TEST_DEVICE, token } from "./helpers.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };
const BUCKET = "bubble.images";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
// The DB container reaches the API gateway on the Docker network (pg_net runs inside it).
const KONG_FROM_DB = "http://supabase_kong_boolaa:8000";

async function member(name: string) {
  const u = await createUser({ name });
  await sql`select public.trust_device(${u.id}::uuid, ${await sha256Hex(TEST_DEVICE)}, 'test')`;
  const c = await signIn(u.email);
  const st = await c.rpc("start_device_check", { p_device_id: TEST_DEVICE });
  assertEq(st.data?.status, "verified", `device check for ${name}`);
  return { ...u, c };
}
type Member = Awaited<ReturnType<typeof member>>;

/** A fresh bubble owned by `owner`, with `others` admitted by majority vote. */
async function bubbleWith(owner: Member, others: Member[], tag: string) {
  const { data: bubble, error } = await owner.c.rpc("create_bubble", { p_name: `Cover ${tag}`.slice(0, 60) });
  assert(!error, `create_bubble: ${error?.message}`);
  const voters = [owner];
  for (const m of others) {
    const { data: req } = await m.c.rpc("request_to_join", { p_invite_code: bubble.invite_code });
    let admitted = false;
    for (const v of voters) admitted = (await v.c.rpc("approve_join_request", { p_request_id: req.id })).data === true || admitted;
    assert(admitted, `${m.email} admitted`);
    voters.push(m);
  }
  return bubble as { id: string; invite_code: string };
}

async function upload(m: Member, path: string) {
  return await m.c.storage.from(BUCKET).upload(path, JPEG, { contentType: "image/jpeg", upsert: false });
}
const urlOf = (path: string) => admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
async function exists(path: string) {
  return (await sql`select 1 from storage.objects where bucket_id = ${BUCKET} and name = ${path}`).length === 1;
}
async function until(fn: () => boolean | Promise<boolean>, ms = 8000) {
  for (let t = 0; t < ms; t += 200) {
    if (await fn()) return true;
    await sleep(200);
  }
  return await fn();
}

Deno.test("bucket, realtime publication and sweep job are set up", opts, async () => {
  const [b] = await sql`select public, file_size_limit, allowed_mime_types from storage.buckets where id = ${BUCKET}`;
  assert(b, "bucket exists");
  assertEq(b.public, false, "private bucket (20261123210000_private_photos.sql)");
  assertEq(Number(b.file_size_limit), 2 * 1024 * 1024, "2 MB like avatars");
  assertEq([...b.allowed_mime_types].sort(), ["image/jpeg", "image/webp"], "JPEG/WebP only");
  const pub = await sql`select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bubbles'`;
  assertEq(pub.length, 1, "bubbles published");
  const job = await sql`select schedule from cron.job where jobname = 'bubble-images-sweep'`;
  assertEq(job.length, 1, "hourly sweep scheduled");
});

Deno.test("only the owner uploads into the bubble's folder and sets the logo; the logo must be that file", opts, async () => {
  const tag = `${Date.now()}`;
  try {
    const owner = await member(`Cov Owner ${tag}`);
    const mate = await member(`Cov Mate ${tag}`);
    const outsider = await member(`Cov Out ${tag}`);
    const bubble = await bubbleWith(owner, [mate], tag);
    const other = await bubbleWith(outsider, [], `o${tag}`);

    const path = `${bubble.id}/${crypto.randomUUID()}.jpg`;
    assert(!(await upload(owner, path)).error, "owner uploads into the bubble folder");
    assert((await upload(mate, `${bubble.id}/${crypto.randomUUID()}.jpg`)).error, "a plain member can't upload");
    assert((await upload(outsider, `${bubble.id}/${crypto.randomUUID()}.jpg`)).error, "an outsider can't upload");
    assert((await upload(owner, `${other.id}/${crypto.randomUUID()}.jpg`)).error, "owner can't upload into another bubble's folder");
    assert((await upload(owner, `${owner.id}/${crypto.randomUUID()}.jpg`)).error, "no <uid>/ folders in bubble.images");
    assert((await upload(owner, `${bubble.id}/nested/${crypto.randomUUID()}.jpg`)).error, "no nested folders");
    const png = await owner.c.storage.from(BUCKET).upload(`${bubble.id}/${crypto.randomUUID()}.png`, JPEG, { contentType: "image/png" });
    assert(png.error, "PNG refused by the bucket's MIME list");

    // Logo validation (trigger): external URLs, other folders and missing files are refused.
    const otherPath = `${other.id}/${crypto.randomUUID()}.jpg`;
    assert(!(await upload(outsider, otherPath)).error, "outsider uploads into their own bubble");
    for (const bad of ["https://evil.example/x.jpg", urlOf(otherPath), urlOf(`${bubble.id}/missing.jpg`), "javascript:alert(1)"]) {
      const r = await owner.c.from("bubbles").update({ logo: bad }).eq("id", bubble.id).select("logo");
      assert(r.error?.message === "invalid bubble logo", `refused ${bad}: ${r.error?.message}`);
    }

    const set = await owner.c.from("bubbles").update({ logo: urlOf(path) }).eq("id", bubble.id).select("logo").single();
    assert(!set.error, `owner sets logo: ${set.error?.message}`);
    assertEq(set.data!.logo, urlOf(path), "logo stored");

    // A plain member's update matches no row; the logo stays.
    const mateSet = await mate.c.from("bubbles").update({ logo: null }).eq("id", bubble.id).select("id");
    assertEq(mateSet.data ?? [], [], "member update hits no row");
    assertEq((await mate.c.from("bubbles").select("logo").eq("id", bubble.id).single()).data?.logo, urlOf(path), "members read the logo");

    // Only name, description and logo are writable by clients.
    for (const patch of [{ invite_code: "HACKED12" }, { max_size: 150 }, { created_by: mate.id }]) {
      const r = await owner.c.from("bubbles").update(patch as never).eq("id", bubble.id);
      assert(r.error?.code === "42501", `${Object.keys(patch)[0]} not writable: ${r.error?.code} ${r.error?.message}`);
    }
    assert(!(await owner.c.from("bubbles").update({ name: `Renamed ${tag}`.slice(0, 60) }).eq("id", bubble.id)).error, "rename still works");

    // Members can't delete the file; the owner can (replace/remove cleanup).
    const mateDel = await mate.c.storage.from(BUCKET).remove([path]);
    assertEq(mateDel.data ?? [], [], "member deletes nothing");
    assert(await exists(path), "file still there");
    assert(!(await owner.c.from("bubbles").update({ logo: null }).eq("id", bubble.id)).error, "owner removes the logo");
    const del = await owner.c.storage.from(BUCKET).remove([path]);
    assertEq(del.data?.length, 1, "owner deletes the old file");
    assert(!(await exists(path)), "file gone");
    await admin.storage.from(BUCKET).remove([otherPath]);
  } finally {
    await cleanupUsers();
  }
});

Deno.test("a new owner (after the uploader leaves) can replace and delete the old logo; members see it live", opts, async () => {
  const tag = `${Date.now()}`;
  const paths: string[] = [];
  let ch: RealtimeChannel | undefined;
  try {
    const owner = await member(`Cov Own2 ${tag}`);
    const mate = await member(`Cov Heir ${tag}`);
    const bubble = await bubbleWith(owner, [mate], tag);

    const got: { id: string; logo: string | null }[] = [];
    await mate.c.realtime.setAuth(await token(mate.c));
    ch = mate.c.channel(`bubbles-${crypto.randomUUID()}`).on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "bubbles" },
      (p) => got.push({ id: (p.new as { id: string }).id, logo: (p.new as { logo: string | null }).logo }),
    );
    await new Promise<void>((res, rej) =>
      ch!.subscribe((s) => (s === "SUBSCRIBED" ? res() : s === "CHANNEL_ERROR" || s === "TIMED_OUT" ? rej(new Error(s)) : null)));
    await sleep(1500);

    const first = `${bubble.id}/${crypto.randomUUID()}.jpg`;
    paths.push(first);
    assert(!(await upload(owner, first)).error, "upload");
    assert(!(await owner.c.from("bubbles").update({ logo: urlOf(first) }).eq("id", bubble.id)).error, "set logo");
    assert(await until(() => got.some((g) => g.id === bubble.id && g.logo === urlOf(first))), "member gets the new logo live");

    // The uploader leaves: ownership passes to the mate (trigger), who replaces the logo.
    assert(!(await owner.c.from("bubble_members").delete().eq("user_id", owner.id).eq("bubble_id", bubble.id)).error, "owner leaves");
    const second = `${bubble.id}/${crypto.randomUUID()}.jpg`;
    paths.push(second);
    assert(!(await upload(mate, second)).error, "new owner uploads");
    assert(!(await mate.c.from("bubbles").update({ logo: urlOf(second) }).eq("id", bubble.id)).error, "new owner replaces the logo");
    const del = await mate.c.storage.from(BUCKET).remove([first]);
    assertEq(del.data?.length, 1, "new owner deletes the previous owner's file");
    assert(await until(() => got.some((g) => g.logo === urlOf(second))), "replacement arrives live");

    // The former owner can't touch the folder any more.
    assert((await upload(owner, `${bubble.id}/${crypto.randomUUID()}.jpg`)).error, "ex-owner can't upload");
  } finally {
    if (ch) await ch.unsubscribe();
    await admin.storage.from(BUCKET).remove(paths);
    await cleanupUsers();
  }
});

Deno.test("orphans (deleted bubble, abandoned upload) are found and swept through the Storage API", opts, async () => {
  const tag = `${Date.now()}`;
  const paths: string[] = [];
  try {
    const owner = await member(`Cov Sweep ${tag}`);
    const bubble = await bubbleWith(owner, [], tag);
    const kept = `${bubble.id}/${crypto.randomUUID()}.jpg`;
    const abandoned = `${bubble.id}/${crypto.randomUUID()}.jpg`;
    paths.push(kept, abandoned);
    assert(!(await upload(owner, kept)).error, "upload logo");
    assert(!(await upload(owner, abandoned)).error, "upload never linked");
    assert(!(await owner.c.from("bubbles").update({ logo: urlOf(kept) }).eq("id", bubble.id)).error, "set logo");

    const orphans = async (grace = "0 seconds") =>
      (await sql`select public.bubble_image_orphans(1000, ${grace}::interval) as n`).map((r) => r.n as string);
    let found = await orphans();
    assert(found.includes(abandoned) && !found.includes(kept), "only the unlinked upload is an orphan");
    assert(!(await orphans("1 hour")).includes(abandoned), "fresh uploads get an hour's grace");

    // Not callable by clients.
    assert((await owner.c.rpc("sweep_bubble_images", {})).error, "clients can't sweep");
    assert((await owner.c.rpc("bubble_image_orphans", {})).error, "clients can't list orphans");

    // The last member leaves: the bubble is deleted and its logo becomes an orphan too.
    assert(!(await owner.c.from("bubble_members").delete().eq("user_id", owner.id).eq("bubble_id", bubble.id)).error, "leave");
    assertEq((await sql`select 1 from public.bubbles where id = ${bubble.id}`).length, 0, "empty bubble deleted");
    found = await orphans();
    assert(found.includes(kept) && found.includes(abandoned), "deleted bubble's logo is an orphan");

    // No Vault secrets locally: the scheduled call is a no-op.
    const noop = await sql`select public.sweep_bubble_images() as n`;
    const hasSecrets = (await sql`select 1 from vault.decrypted_secrets where name in ('storage_sweep_url', 'storage_sweep_key')`).length === 2;
    if (!hasSecrets) assertEq(noop[0].n, 0, "no secrets, no sweep");

    const asked = await sql`select public.sweep_bubble_images(${KONG_FROM_DB}, ${SERVICE_KEY}, '0 seconds'::interval) as n`;
    assert(asked[0].n >= 2, `sweep asked for ${asked[0].n}`);
    assert(await until(async () => !(await exists(kept)) && !(await exists(abandoned)), 15000), "orphans deleted by the Storage API");
  } finally {
    await admin.storage.from(BUCKET).remove(paths);
    await cleanupUsers();
  }
});
