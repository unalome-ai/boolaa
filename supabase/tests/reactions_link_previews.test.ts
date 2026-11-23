// Reactions and link previews (migration 20261123160000_reactions_link_previews.sql,
// docs/boolaa-spec.md "Reactions" and "Link previews"), against the LOCAL stack:
//
//   deno test -A --no-check supabase/tests/reactions_link_previews.test.ts
//
// RLS (members only, blocks both ways, verified sessions), toggle semantics, cascades (target
// deletion, soft-deleted chat messages, account deletion), live INSERT/DELETE over Realtime, the
// preview columns guard, the trigger queueing the function, claim/store, and the link-preview
// handler end to end against the real database and Storage (with a fake DNS + HTTP fixture, since
// the guard refuses every local address). Throwaway users and bubbles; never changes app_settings.
import type { RealtimeChannel, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { admin, API, assert, assertEq, cleanupUsers, createUser, sha256Hex, signIn, sleep, sql, TEST_DEVICE, token } from "./helpers.ts";
import { createHandler } from "../functions/link-preview/handler.ts";
import { sniff } from "../functions/link-preview/image.ts";
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };

async function member(name: string) {
  const u = await createUser({ name });
  await sql`select public.trust_device(${u.id}::uuid, ${await sha256Hex(TEST_DEVICE)}, 'test')`;
  const c = await signIn(u.email);
  const st = await c.rpc("start_device_check", { p_device_id: TEST_DEVICE });
  assertEq(st.data?.status, "verified", `device check for ${name}`);
  return { ...u, c };
}
type Member = Awaited<ReturnType<typeof member>>;

async function bubbleWith(tag: string, names: string[]) {
  const owner = await member(`Owner ${tag}`);
  const { data: bubble, error } = await owner.c.rpc("create_bubble", { p_name: `React ${tag}`.slice(0, 60) });
  assert(!error, `create_bubble: ${error?.message}`);
  const members: Member[] = [owner];
  for (const n of names) {
    const m = await member(`${n} ${tag}`);
    const { data: req } = await m.c.rpc("request_to_join", { p_invite_code: bubble.invite_code });
    for (const v of members) await v.c.rpc("approve_join_request", { p_request_id: req.id });
    members.push(m);
  }
  return { bubble: bubble as { id: string }, members };
}

async function until(fn: () => boolean | Promise<boolean>, ms = 6000) {
  for (let t = 0; t < ms; t += 100) {
    if (await fn()) return true;
    await sleep(100);
  }
  return await fn();
}

const toggle = (c: SupabaseClient, type: string, id: string, reaction: string) =>
  c.rpc("toggle_reaction", { p_target_type: type, p_target_id: id, p_reaction: reaction });

async function reactionsOn(c: SupabaseClient, targetId: string) {
  const { data, error } = await c.from("reactions").select("id, user_id, reaction, target_type, target_id").eq("target_id", targetId);
  if (error) throw new Error(`select reactions: ${error.message}`);
  return data as { id: string; user_id: string; reaction: string; target_type: string; target_id: string }[];
}

async function targets(m: Member, bubbleId: string, tag: string) {
  const one = async (table: string, row: Record<string, unknown>) => {
    const { data, error } = await m.c.from(table).insert(row as never).select("id").single();
    if (error) throw new Error(`${table}: ${error.message}`);
    return (data as { id: string }).id;
  };
  return {
    chat_message: await one("chat_messages", { bubble_id: bubbleId, sender_id: m.id, content: `hi ${tag}` }),
    event: await one("events", { bubble_id: bubbleId, creator_id: m.id, title: `ev ${tag}`, datetime: new Date(Date.now() + 864e5).toISOString() }),
    food_post: await one("food_posts", { bubble_id: bubbleId, user_id: m.id, image: `${m.id}/x.jpg`, description: `food ${tag}` }),
    market_item: await one("market_items", { bubble_id: bubbleId, owner_id: m.id, image: `${m.id}/x.jpg`, title: `item ${tag}` }),
    shared_link: await one("shared_links", { bubble_id: bubbleId, user_id: m.id, url: `https://example.com/${tag}`, title: `link ${tag}` }),
  };
}

Deno.test("reactions: toggle on every target type, members only, fixed set, no direct writes", opts, async () => {
  const tag = `${Date.now()}`;
  try {
    const { bubble, members: [owner, friend] } = await bubbleWith(tag, ["Friend"]);
    const outsider = await member(`Out ${tag}`);
    const t = await targets(owner, bubble.id, tag);

    for (const [type, id] of Object.entries(t)) {
      const on = await toggle(friend.c, type, id, "love");
      assert(!on.error, `${type} react: ${on.error?.message}`);
      assertEq(on.data.reacted, true, `${type} on`);
      assert(!(await toggle(owner.c, type, id, "love")).error, `${type} owner reacts too`);
      assert(!(await toggle(owner.c, type, id, "laugh")).error, `${type} second reaction`);
      const rows = await reactionsOn(owner.c, id);
      assertEq(rows.length, 3, `${type} three rows`);
      assert(rows.every((r) => r.target_type === type && r.target_id === id), `${type} target columns`);
      const off = await toggle(friend.c, type, id, "love");
      assertEq(off.data.reacted, false, `${type} off`);
      assertEq(off.data.id, on.data.id, `${type} off returns the removed id`);
      assertEq((await reactionsOn(friend.c, id)).length, 2, `${type} two left`);
      // Outsiders can neither react nor see.
      const out = await toggle(outsider.c, type, id, "like");
      assertEq(out.error?.message, "reaction target not found", `${type} outsider refused`);
      assertEq((await reactionsOn(outsider.c, id)).length, 0, `${type} outsider sees nothing`);
    }

    assertEq((await toggle(friend.c, "food_post", t.food_post, "👍")).error?.message, "invalid reaction", "emoji literal refused");
    assertEq((await toggle(friend.c, "food_post", t.food_post, "angry")).error?.message, "invalid reaction", "unknown key refused");
    assertEq((await toggle(friend.c, "user", owner.id, "like")).error?.message, "invalid reaction", "unknown target type");
    assertEq((await toggle(friend.c, "event", crypto.randomUUID(), "like")).error?.message, "reaction target not found", "missing target");

    const ins = await friend.c.from("reactions").insert({ bubble_id: bubble.id, user_id: friend.id, reaction: "like", food_post_id: t.food_post, target_owner_id: owner.id } as never);
    assert(ins.error, "direct insert refused");
    const mine = (await reactionsOn(owner.c, t.event)).find((r) => r.user_id === owner.id)!;
    await owner.c.from("reactions").delete().eq("id", mine.id);
    assertEq((await reactionsOn(owner.c, t.event)).length, 2, "direct delete does nothing");

    // Anon sees nothing.
    const anonRows = await (await import("./helpers.ts")).client().from("reactions").select("id").eq("bubble_id", bubble.id);
    assertEq(anonRows.data?.length ?? 0, 0, "anon sees nothing");
  } finally {
    await cleanupUsers();
  }
});

Deno.test("reactions: blocks hide both ways, soft-deleted messages and deleted targets lose them, account deletion removes them", opts, async () => {
  const tag = `${Date.now()}`;
  try {
    const { bubble, members: [owner, friend, troll] } = await bubbleWith(tag, ["Friend", "Troll"]);
    const t = await targets(owner, bubble.id, tag);
    const trollPost = (await targets(troll, bubble.id, `t${tag}`)).food_post;
    assert(!(await toggle(troll.c, "food_post", t.food_post, "laugh")).error, "troll reacts");
    assert(!(await toggle(friend.c, "food_post", trollPost, "like")).error, "friend reacts to troll's post");
    assert(!(await toggle(friend.c, "food_post", t.food_post, "like")).error, "friend reacts");

    assert(!(await owner.c.from("blocks").insert({ blocker_id: owner.id, blocked_id: troll.id })).error, "block");
    const seen = await reactionsOn(owner.c, t.food_post);
    assertEq(seen.map((r) => r.user_id), [friend.id], "owner no longer sees the troll's reaction");
    assertEq((await reactionsOn(owner.c, trollPost)).length, 0, "owner sees no reactions on the troll's post");
    assertEq((await reactionsOn(troll.c, t.food_post)).length, 0, "troll sees none on the owner's post (two-way)");
    assertEq((await reactionsOn(friend.c, t.food_post)).length, 2, "the friend still sees both");
    assertEq((await toggle(owner.c, "food_post", trollPost, "like")).error?.message, "reaction target not found", "can't react to a blocked author");
    assertEq((await toggle(troll.c, "event", t.event, "like")).error?.message, "reaction target not found", "blocked author can't react back");

    // Soft-deleting a chat message removes its reactions and refuses new ones.
    assert(!(await toggle(friend.c, "chat_message", t.chat_message, "wow")).error, "react to message");
    assert(!(await owner.c.rpc("delete_chat_message", { p_message_id: t.chat_message })).error, "delete message");
    assertEq((await sql`select count(*)::int as n from public.reactions where message_id = ${t.chat_message}`)[0].n, 0, "reactions gone");
    assertEq((await toggle(friend.c, "chat_message", t.chat_message, "wow")).error?.message, "reaction target not found", "deleted message refused");

    // Deleting the target cascades.
    assert(!(await toggle(friend.c, "shared_link", t.shared_link, "thanks")).error, "react to link");
    assert(!(await owner.c.from("shared_links").delete().eq("id", t.shared_link)).error, "delete link");
    assertEq((await sql`select count(*)::int as n from public.reactions where link_id = ${t.shared_link}`)[0].n, 0, "cascade on target deletion");

    // Account deletion removes the user's reactions (and the reactions on their content).
    assert(!(await toggle(friend.c, "market_item", t.market_item, "sad")).error, "react to item");
    await admin.auth.admin.deleteUser(friend.id);
    assertEq((await sql`select count(*)::int as n from public.reactions where user_id = ${friend.id}`)[0].n, 0, "deleted user's reactions gone");
  } finally {
    await cleanupUsers();
  }
});

Deno.test("reactions: live INSERT filtered by bubble (RLS-checked), DELETE by id only", opts, async () => {
  const tag = `${Date.now()}`;
  try {
    const rows = await sql`select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'reactions'`;
    assertEq(rows.length, 1, "reactions published");
    const { bubble, members: [owner, friend, troll] } = await bubbleWith(tag, ["Friend", "Troll"]);
    assert(!(await owner.c.from("blocks").insert({ blocker_id: owner.id, blocked_id: troll.id })).error, "block");
    const t = await targets(owner, bubble.id, tag);
    const friendMsg = (await targets(friend, bubble.id, `f${tag}`)).chat_message;

    const got: { type: string; row: Record<string, unknown> }[] = [];
    await owner.c.realtime.setAuth(await token(owner.c));
    const ch: RealtimeChannel = owner.c.channel(`reactions:${bubble.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "reactions", filter: `bubble_id=eq.${bubble.id}` },
        (p) => got.push({ type: "INSERT", row: p.new as Record<string, unknown> }))
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "reactions" },
        (p) => got.push({ type: "DELETE", row: p.old as Record<string, unknown> }));
    await new Promise<void>((res, rej) =>
      ch.subscribe((s) => (s === "SUBSCRIBED" ? res() : s === "CHANNEL_ERROR" || s === "TIMED_OUT" ? rej(new Error(s)) : null)));
    await sleep(1500);

    const on = await toggle(friend.c, "chat_message", t.chat_message, "laugh");
    const hidden = await toggle(troll.c, "chat_message", friendMsg, "laugh"); // troll isn't blocked by the friend
    assert(!on.error && !hidden.error, `reactions added: ${on.error?.message ?? hidden.error?.message}`);
    assert(await until(() => got.some((g) => g.type === "INSERT" && g.row.id === on.data.id)), "INSERT arrives");
    const ins = got.find((g) => g.row.id === on.data.id)!.row;
    assertEq([ins.target_type, ins.target_id, ins.reaction, ins.user_id], ["chat_message", t.chat_message, "laugh", friend.id], "INSERT row shape");

    await toggle(friend.c, "chat_message", t.chat_message, "laugh");
    assert(await until(() => got.some((g) => g.type === "DELETE" && g.row.id === on.data.id)), "DELETE arrives");
    assertEq(Object.keys(got.find((g) => g.type === "DELETE")!.row).sort(), ["id"], "DELETE carries only the id");
    await sleep(1000);
    assert(!got.some((g) => g.type === "INSERT" && g.row.id === hidden.data.id), "blocked reactor never delivered");
    await owner.c.removeChannel(ch);
  } finally {
    await cleanupUsers();
  }
});

// --- Link previews ------------------------------------------------------------
Deno.test("link previews: clients can't write preview columns; URL changes reset; throttle; trigger queues the function", opts, async () => {
  const tag = `${Date.now()}`;
  try {
    const { bubble, members: [owner] } = await bubbleWith(tag, []);
    const { data: link, error } = await owner.c.from("shared_links")
      .insert({ bubble_id: bubble.id, user_id: owner.id, url: `https://example.com/${tag}`, title: "t",
        preview_status: "ready", preview_title: "forged", preview_image_path: `${crypto.randomUUID()}/${crypto.randomUUID()}.jpg` } as never)
      .select("*").single();
    assert(!error, `insert: ${error?.message}`);
    assertEq([link.preview_status, link.preview_title, link.preview_image_path], ["pending", null, null], "forged preview ignored");

    await sql`update public.shared_links set preview_status = 'ready', preview_title = 'Real' where id = ${link.id}`;
    const same = await owner.c.from("shared_links").update({ title: "edited", preview_title: "forged" } as never).eq("id", link.id).select("*").single();
    assertEq([same.data.preview_status, same.data.preview_title, same.data.title], ["ready", "Real", "edited"], "edit keeps the preview");
    const moved = await owner.c.from("shared_links").update({ url: `https://example.org/${tag}` } as never).eq("id", link.id).select("*").single();
    assertEq([moved.data.preview_status, moved.data.preview_title], ["pending", null], "new URL starts over");

    // claim/store are service-role only.
    assertEq((await owner.c.rpc("claim_link_preview", { p_link_id: link.id })).error?.code, "42501", "claim refused to clients");
    assert((await owner.c.rpc("store_link_preview", { p_link_id: link.id, p_url: "x", p_status: "ready" })).error, "store refused to clients");

    // The AFTER trigger queues POST {link_id} to the Vault URL (checked inside a rolled-back transaction).
    const claimsJson = JSON.stringify({ sub: owner.id, role: "authenticated" });
    const queued = await sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${claimsJson}, true)`;
      const [l] = await tx`insert into public.shared_links (bubble_id, user_id, url) values (${bubble.id}, ${owner.id}, ${`https://example.net/${tag}`}) returning id, preview_status`;
      const q = await tx`select url, convert_from(body, 'utf8') as body from net.http_request_queue where convert_from(body, 'utf8') like ${`%${l.id}%`}`;
      await tx`select set_config('request.jwt.claims', '', true)`;
      throw Object.assign(new Error("rollback"), { result: { l, q } });
    }).catch((e) => e.result);
    assertEq(queued.l.preview_status, "pending", "pending in the transaction");
    assertEq(queued.q.length, 1, "one request queued");
    assert(String(queued.q[0].url).endsWith("/functions/v1/link-preview"), "to the link-preview function");
    assertEq(JSON.parse(queued.q[0].body), { link_id: queued.l.id }, "body is only the link id");

    // Lost calls are re-queued by retry_link_previews(); after a day the link gives up.
    const retried = await sql.begin(async (tx) => {
      const [old] = await tx`insert into public.shared_links (bubble_id, user_id, url) values (${bubble.id}, ${owner.id}, ${`https://example.com/r/${tag}`}) returning id`;
      const [dead] = await tx`insert into public.shared_links (bubble_id, user_id, url) values (${bubble.id}, ${owner.id}, ${`https://example.com/d/${tag}`}) returning id`;
      await tx`update public.shared_links set preview_status = 'pending', preview_requested_at = now() - interval '3 minutes' where id = ${old.id}`;
      await tx`update public.shared_links set preview_status = 'pending', preview_requested_at = now() - interval '2 days' where id = ${dead.id}`;
      const [{ n }] = await tx`select public.retry_link_previews() as n`;
      const q = await tx`select 1 from net.http_request_queue where convert_from(body, 'utf8') like ${`%${old.id}%`}`;
      const [d] = await tx`select preview_status from public.shared_links where id = ${dead.id}`;
      throw Object.assign(new Error("rollback"), { result: { n, queued: q.length, dead: d.preview_status } });
    }).catch((e) => e.result);
    assert(retried.n >= 1, "re-queued at least one");
    assertEq([retried.queued, retried.dead], [1, "failed"], "old pending re-queued, day-old one failed");

    // Throttle: 30 requested previews per user per hour, then links stay plain.
    await sql`update public.shared_links set preview_requested_at = now() where user_id = ${owner.id}`;
    const rows = Array.from({ length: 29 }, (_, i) => ({ bubble_id: bubble.id, user_id: owner.id, url: `https://example.com/${tag}/${i}` }));
    assert(!(await owner.c.from("shared_links").insert(rows as never)).error, "bulk insert");
    const over = await owner.c.from("shared_links").insert({ bubble_id: bubble.id, user_id: owner.id, url: `https://example.com/${tag}/over` } as never).select("preview_status").single();
    assertEq(over.data?.preview_status, "none", "31st link has no preview");
  } finally {
    await cleanupUsers();
  }
});

Deno.test("link previews: handler end to end with the real DB and Storage; members see the card live; stale results discarded", opts, async () => {
  const tag = `${Date.now()}`;
  const img = await new Image(1600, 900).fill(0x22aa66ff).encode();
  const fixture = (url: string) => {
    const u = new URL(url);
    if (u.pathname === "/article") {
      return new Response(`<html><head><title>Fallback</title>
        <meta property="og:title" content="Sourdough &amp; friends">
        <meta property="og:description" content="<b>Bake</b> it slow.">
        <meta property="og:site_name" content="Bread Weekly">
        <meta property="og:image" content="/cover.png"></head><body>…</body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (u.pathname === "/cover.png") return new Response(img, { headers: { "content-type": "image/png" } });
    return new Response("missing", { status: 404, headers: { "content-type": "text/html" } });
  };
  const deps = {
    resolve: () => Promise.resolve(["93.184.216.34"]),
    fetchImpl: (url: string) => Promise.resolve(fixture(url)),
    async claim(linkId: string) {
      const { data, error } = await admin.rpc("claim_link_preview", { p_link_id: linkId });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return row?.url ? { url: row.url as string } : null;
    },
    async store(linkId: string, url: string, status: "ready" | "failed", p?: { title: string | null; description: string | null; siteName: string | null; imagePath: string | null }) {
      const { data, error } = await admin.rpc("store_link_preview", {
        p_link_id: linkId, p_url: url, p_status: status, p_title: p?.title ?? null, p_description: p?.description ?? null,
        p_site_name: p?.siteName ?? null, p_image_path: p?.imagePath ?? null,
      });
      if (error) throw error;
      return data === true;
    },
    async upload(path: string, jpeg: Uint8Array) {
      const { error } = await admin.storage.from("link.previews").upload(path, jpeg, { contentType: "image/jpeg" });
      if (error) throw error;
    },
    async remove(path: string) {
      await admin.storage.from("link.previews").remove([path]);
    },
  };
  const handler = createHandler(deps);
  const call = async (id: string) =>
    (await (await handler(new Request("http://x/", { method: "POST", body: JSON.stringify({ link_id: id }) }))).json()).status;
  const uploaded: string[] = [];
  try {
    const { bubble, members: [owner, friend] } = await bubbleWith(tag, ["Friend"]);
    const updates: Record<string, unknown>[] = [];
    await friend.c.realtime.setAuth(await token(friend.c));
    const ch = friend.c.channel(`shared_links:${bubble.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "shared_links", filter: `bubble_id=eq.${bubble.id}` },
        (p) => updates.push(p.new as Record<string, unknown>));
    await new Promise<void>((res) => ch.subscribe((s) => s === "SUBSCRIBED" && res()));
    await sleep(1500);

    // Rows are made pending through SQL (no trigger call), so a running link-preview function in the
    // local edge runtime can't race this in-process handler for the claim.
    const pendingLink = async (url: string) => {
      const [l] = await sql`insert into public.shared_links (bubble_id, user_id, url, title)
                            values (${bubble.id}, ${owner.id}, ${url}, 'Bread') returning id`;
      await sql`update public.shared_links set preview_status = 'pending', preview_requested_at = now() where id = ${l.id}`;
      return { id: l.id as string };
    };
    const link = await pendingLink("https://bread.example.org/article");
    assertEq(await call(link.id), "ready", "preview built");
    assertEq(await call(link.id), "skipped", "fetched once");

    const { data: row } = await friend.c.from("shared_links").select("*").eq("id", link.id).single();
    assertEq([row.preview_status, row.preview_title, row.preview_description, row.preview_site_name],
      ["ready", "Sourdough & friends", "Bake it slow.", "Bread Weekly"], "stored text");
    assert(new RegExp(`^${link.id}/[0-9a-f-]{36}\\.jpg$`).test(row.preview_image_path), "image path");
    uploaded.push(row.preview_image_path);
    // Private bucket (20261123210000_private_photos.sql): members read it through a signed URL.
    const { data: signed } = await friend.c.storage.from("link.previews").createSignedUrl(row.preview_image_path, 60);
    const pub = await fetch(signed!.signedUrl);
    const bytes = new Uint8Array(await pub.arrayBuffer());
    assertEq([pub.status, sniff(bytes)], [200, "jpeg"], "JPEG copy served from our Storage");
    const anon = await fetch(`${API}/storage/v1/object/public/link.previews/${row.preview_image_path}`);
    await anon.body?.cancel();
    assert(!anon.ok, "no public URL");
    assert(await until(() => updates.some((u) => u.id === link.id && u.preview_status === "ready" && u.preview_title === "Sourdough & friends")), "friend gets the card live");

    // Changing the URL while a fetch is in flight: the old result is discarded with its image.
    const l2 = await pendingLink("https://bread.example.org/article");
    const claimed = await deps.claim(l2.id);
    assert(claimed, "claimed");
    await sql`update public.shared_links set url = 'https://bread.example.org/other' where id = ${l2.id}`;
    assertEq(await deps.store(l2.id, claimed.url, "ready", { title: "old", description: null, siteName: null, imagePath: null }), false, "stale store refused");
    const [after] = await sql`select preview_title from public.shared_links where id = ${l2.id}`;
    assertEq(after.preview_title, null, "stale title not stored");
    await sql`update public.shared_links set preview_status = 'pending' where id = ${l2.id}`;
    assertEq(await call(l2.id), "failed", "404 page -> failed");
    const [failed] = await sql`select preview_status from public.shared_links where id = ${l2.id}`;
    assertEq(failed.preview_status, "failed", "failed stored");

    // Orphans: an object no link points at is listed for the sweep.
    const orphan = `${crypto.randomUUID()}/${crypto.randomUUID()}.jpg`;
    await deps.upload(orphan, bytes);
    uploaded.push(orphan);
    const orphans = await sql`select public.link_preview_orphans(1000, interval '0 seconds') as n`;
    const names = orphans.map((o) => o.n);
    assert(names.includes(orphan), "orphan listed");
    assert(!names.includes(row.preview_image_path), "referenced image not listed");
    await friend.c.removeChannel(ch);
  } finally {
    if (uploaded.length) await admin.storage.from("link.previews").remove(uploaded);
    await cleanupUsers();
  }
});
