// Search inside a bubble (migration 20261123180000_bubble_search.sql, docs/boolaa-spec.md "Search"),
// through the real GoTrue + PostgREST of the LOCAL stack:
//
//   deno test -A --no-check supabase/tests/bubble_search.test.ts
//
// search_bubble() finds every content type, folds case and diacritics, matches word prefixes and
// fragments, and leaves visibility to RLS: blocked users' content, deleted messages, other bubbles
// and non-members never get rows. chat_messages_around() opens a hit in the chat. Throwaway users and
// bubbles only; never changes app_settings flags.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { assert, assertEq, cleanupUsers, client, createUser, sha256Hex, signIn, sql, TEST_DEVICE } from "./helpers.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };

async function member(name: string) {
  const u = await createUser({ name });
  await sql`select public.trust_device(${u.id}::uuid, ${await sha256Hex(TEST_DEVICE)}, 'test')`;
  const c = await signIn(u.email);
  const st = await c.rpc("start_device_check", { p_device_id: TEST_DEVICE });
  assertEq(st.data?.status, "verified", `device check for ${name}`);
  return { ...u, name, c };
}
type Member = Awaited<ReturnType<typeof member>>;

async function bubbleWith(tag: string, names: string[]) {
  const owner = await member(`Owner ${tag}`);
  const { data: bubble, error } = await owner.c.rpc("create_bubble", { p_name: `Search ${tag}`.slice(0, 60) });
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

type Hit = {
  kind: string;
  id: string;
  title: string | null;
  snippet: string | null;
  author_id: string;
  author_name: string | null;
  created_at: string;
  event_at: string | null;
  rank: number;
  matched_words: string[] | null;
};

async function search(c: SupabaseClient, bubbleId: string, q: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await c.rpc("search_bubble", { p_bubble_id: bubbleId, p_query: q, ...extra });
  if (error) throw new Error(`search_bubble(${JSON.stringify(q)}): ${error.message}`);
  return data as Hit[];
}

async function insert(c: SupabaseClient, table: string, row: Record<string, unknown>) {
  const { data, error } = await c.from(table).insert(row).select("id").single();
  if (error) throw new Error(`insert ${table}: ${error.message}`);
  return (data as { id: string }).id;
}

const say = (m: Member, bubbleId: string, content: string) =>
  insert(m.c, "chat_messages", { bubble_id: bubbleId, sender_id: m.id, content });

/** One of each type by `a`, with accented text. */
async function seedContent(a: Member, bubbleId: string) {
  const ids = {
    chat_message: await say(a, bubbleId, "Who's up for Sărmăluțe la bunica on Sunday?"),
    event: await insert(a.c, "events", {
      bubble_id: bubbleId, creator_id: a.id, title: "Climbing night", description: "Bouldering at the new gym",
      location: "Café Crème, Montréal", datetime: new Date(Date.now() + 86400_000).toISOString(),
    }),
    food_post: await insert(a.c, "food_posts", {
      bubble_id: bubbleId, user_id: a.id, image: "https://example.com/x.jpg", description: "Homemade crème brûlée and a big pizza",
    }),
    market_item: await insert(a.c, "market_items", {
      bubble_id: bubbleId, owner_id: a.id, image: "https://example.com/y.jpg", title: "Ñandú plush toy", description: "Barely used", status: "free",
    }),
    shared_link: await insert(a.c, "shared_links", {
      bubble_id: bubbleId, user_id: a.id, url: "https://github.com/supabase/supabase", title: "Backend repo", tags: ["dev", "ops"],
    }),
  };
  return ids;
}

Deno.test("search_bubble: finds every content type with title, snippet and author", opts, async () => {
  const tag = `${Date.now()}`;
  try {
    const { bubble, members: [a, b] } = await bubbleWith(tag, ["Bea"]);
    const ids = await seedContent(a, bubble.id);
    // Link preview text is server-written; set it like the Edge Function would.
    await sql`update public.shared_links set preview_status = 'ready', preview_title = 'Postgres development platform',
              preview_description = 'Build in a weekend, scale to millions' where id = ${ids.shared_link}`;

    const one = async (q: string, kind: string) => {
      const hits = await search(b.c, bubble.id, q);
      const hit = hits.find((h) => h.kind === kind);
      assert(hit, `${kind} found by ${JSON.stringify(q)}; got ${JSON.stringify(hits.map((h) => h.kind))}`);
      assertEq(hit.id, ids[kind as keyof typeof ids], `${kind} id`);
      assertEq(hit.author_id, a.id, `${kind} author`);
      assertEq(hit.author_name, a.name, `${kind} author name`);
      return hit;
    };
    const chat = await one("bunica", "chat_message");
    assertEq(chat.title, null, "chat has no title");
    assert(chat.snippet?.includes("Sărmăluțe"), "chat snippet keeps the original accents");
    assertEq(chat.matched_words, ["bunica"], "matched words");

    const ev = await one("climbing", "event");
    assertEq(ev.title, "Climbing night", "event title");
    assert(ev.event_at, "event_at set");
    await one("bouldering", "event"); // description
    await one("montreal", "event"); // location, accent-free query

    const food = await one("pizza", "food_post");
    assertEq(food.title, null, "food has no title");
    assert(food.snippet?.includes("pizza"), "food snippet");

    const item = await one("nandu", "market_item");
    assertEq(item.title, "Ñandú plush toy", "item title");

    const link = await one("backend", "shared_link");
    assertEq(link.title, "Backend repo", "link title");
    await one("github", "shared_link"); // URL
    await one("ops", "shared_link"); // tag
    const prev = await one("weekend", "shared_link"); // preview description
    assert(prev.snippet?.includes("weekend"), "snippet from the preview text");
    await one("postgres development", "shared_link"); // preview title, two words

    // Kinds filter, limit, and ordering: title hits first.
    const onlyEvents = await search(b.c, bubble.id, "cr", { p_kinds: ["event"] });
    assert(onlyEvents.every((h) => h.kind === "event") && onlyEvents.length === 1, "p_kinds filters");
    await say(a, bubble.id, "climbing climbing climbing");
    const ranked = await search(b.c, bubble.id, "climbing");
    assertEq(ranked[0].kind, "event", "a title hit ranks first");
    assertEq((await search(b.c, bubble.id, "climbing", { p_limit: 1 })).length, 1, "p_limit");
  } finally {
    await cleanupUsers();
  }
});

Deno.test("search_bubble: case, diacritics, prefixes and fragments", opts, async () => {
  const tag = `${Date.now()}`;
  try {
    const { bubble, members: [a] } = await bubbleWith(tag, []);
    const ids = await seedContent(a, bubble.id);
    // Romanian with the cedilla forms, French and Italian accents.
    const ro = await say(a, bubble.id, "Ştiu că mâine e şedinţă la Ţară");
    const it = await say(a, bubble.id, "Perché no? Città più bella");
    const has = async (q: string, id: string) => {
      const hits = await search(a.c, bubble.id, q);
      assert(hits.some((h) => h.id === id), `${JSON.stringify(q)} finds ${id}; got ${JSON.stringify(hits.map((h) => h.snippet))}`);
    };
    await has("sarmalute", ids.chat_message); // no accents in the query
    await has("SĂRMĂLUȚE", ids.chat_message); // upper case with accents
    await has("sarmă", ids.chat_message); // prefix
    await has("creme brulee", ids.food_post);
    await has("crème", ids.event); // accent in the query and the row
    await has("zza", ids.food_post); // fragment inside a word (trigram)
    await has("climb gym", ids.event); // prefixes of two words, in any field
    await has("ștIU", ro); // comma-below query finds cedilla text
    await has("sedinta", ro);
    await has("tara", ro);
    await has("perche", it);
    await has("citta piu", it);
    assertEq((await search(a.c, bubble.id, "climbing  pizza")).length, 0, "all words must match");
  } finally {
    await cleanupUsers();
  }
});

Deno.test("search_bubble: RLS decides: blocks, deleted messages, other bubbles, non-members", opts, async () => {
  const tag = `${Date.now()}`;
  try {
    const { bubble, members: [a, b, c] } = await bubbleWith(tag, ["Bea", "Cy"]);
    const word = `zebra${tag.slice(-5)}`;
    const fromA = await seedContent(a, bubble.id);
    const aMsg = await say(a, bubble.id, `${word} from Ana`);
    const cMsg = await say(c, bubble.id, `${word} from Cy`);
    await insert(c.c, "events", { bubble_id: bubble.id, creator_id: c.id, title: `${word} party`, datetime: new Date().toISOString() });

    const ids = async (m: Member, q = word, bubbleId = bubble.id) => (await search(m.c, bubbleId, q)).map((h) => h.id);
    assertEq((await ids(b)).length, 3, "Bea sees all three before the block");

    // Deleted messages: gone from search right away (the text is wiped).
    const del = await a.c.rpc("delete_chat_message", { p_message_id: aMsg });
    assert(!del.error, `delete: ${del.error?.message}`);
    assert(!(await ids(b)).includes(aMsg), "deleted message not returned");
    assert(!(await ids(a)).includes(aMsg), "not even to its author");

    // Blocks, both ways: Bea blocks Cy -> neither sees the other's content.
    await b.c.from("blocks").insert({ blocker_id: b.id, blocked_id: c.id });
    assertEq((await ids(b)).length, 0, "Bea gets none of Cy's content");
    const cSees = await search(c.c, bubble.id, "pizza");
    assert(cSees.some((h) => h.id === fromA.food_post), "Cy still sees Ana's post");
    await say(b, bubble.id, `${word} from Bea`);
    assert(!(await search(c.c, bubble.id, word)).some((h) => h.author_id === b.id), "Cy gets nothing from Bea (two-way)");
    assert((await ids(c)).includes(cMsg), "Cy sees own message");

    // Other bubbles: Ana's second bubble content never shows up in the first, and vice versa.
    const { data: other } = await a.c.rpc("create_bubble", { p_name: `Other ${tag}` });
    const otherMsg = await say(a, other.id, `${word} elsewhere`);
    assert(!(await ids(a)).includes(otherMsg), "other bubble's message not in this bubble's results");
    assert((await ids(a, word, other.id)).includes(otherMsg), "found in its own bubble");
    assertEq((await ids(b, word, other.id)).length, 0, "Bea isn't in the other bubble: nothing");

    // Non-members get nothing, whatever bubble id they pass; anon can't call it at all.
    const outsider = await member(`Out ${tag}`);
    assertEq((await ids(outsider)).length, 0, "non-member: nothing");
    assertEq((await ids(outsider, "pizza")).length, 0, "non-member: nothing for any word");
    const anon = await client().rpc("search_bubble", { p_bubble_id: bubble.id, p_query: "pizza" });
    assert(anon.error, "anon can't call search_bubble");
    // A member who left loses access at once.
    await c.c.from("bubble_members").delete().eq("bubble_id", bubble.id).eq("user_id", c.id);
    assertEq((await search(c.c, bubble.id, "pizza")).length, 0, "left member: nothing");
  } finally {
    await cleanupUsers();
  }
});

Deno.test("search_bubble: injection-ish and tiny input is harmless", opts, async () => {
  const tag = `${Date.now()}`;
  try {
    const { bubble, members: [a] } = await bubbleWith(tag, []);
    const ids = await seedContent(a, bubble.id);
    const lit = await say(a, bubble.id, "50% off_today \\o/ (really) a&b");
    const before = await sql`select count(*)::int as n from public.events`;
    for (const q of [
      "'; drop table public.events; --", "' or '1'='1", "pizza' or 1=1 --", "%", "%%", "%%%", "_", "___", "\\", "\\\\%",
      "a:* | b:*", "!(pizza)", "pizza & !x", "<script>alert(1)</script>", "pizza:*", "''", "\"pizza\"", "-pizza",
      "😀😀", "x".repeat(5000), "\u0000pizza", "$$ select 1 $$", "pizza\\", "or", "*",
    ]) {
      const { data, error } = await a.c.rpc("search_bubble", { p_bubble_id: bubble.id, p_query: q });
      if (error) {
        // A NUL byte is refused by PostgREST/Postgres before the function runs: harmless.
        assert(q.includes("\u0000"), `${JSON.stringify(q.slice(0, 40))} errored: ${error.message}`);
        continue;
      }
      const hits = data as Hit[];
      // Wildcards are literals: "%" or "_" never match everything.
      if (/^[%_\\]+$/.test(q)) assert(hits.every((h) => h.id === lit), `${JSON.stringify(q)} matches only literal text`);
    }
    assertEq((await sql`select count(*)::int as n from public.events`)[0].n, before[0].n, "events table intact");
    assert((await search(a.c, bubble.id, "50% off")).some((h) => h.id === lit), "literal % matches");
    assert((await search(a.c, bubble.id, "off_to")).some((h) => h.id === lit), "literal _ matches");
    assert(!(await search(a.c, bubble.id, "off_x")).some((h) => h.id === lit), "_ is not a wildcard");
    assert((await search(a.c, bubble.id, "pizza' or 1=1 --")).length === 0, "quote input: all words must match");
    assert((await search(a.c, bubble.id, "!(pizza)")).some((h) => h.id === ids.food_post), "operators are stripped to words");
    // Minimum length 2 after trimming; whitespace only is nothing.
    assertEq((await search(a.c, bubble.id, "p")).length, 0, "1 character: nothing");
    assertEq((await search(a.c, bubble.id, "   p   ")).length, 0, "1 character after trim: nothing");
    assertEq((await search(a.c, bubble.id, "      ")).length, 0, "blank: nothing");
    assert((await search(a.c, bubble.id, "pi")).some((h) => h.id === ids.food_post), "2 characters work");
    // Limits are clamped.
    for (let i = 0; i < 4; i++) await say(a, bubble.id, `clamp ${i}`);
    assertEq((await search(a.c, bubble.id, "clamp", { p_limit: 0 })).length, 1, "limit at least 1");
    assertEq((await search(a.c, bubble.id, "clamp", { p_limit: 100000 })).length, 4, "huge limit clamped, all 4");
  } finally {
    await cleanupUsers();
  }
});

Deno.test("chat_messages_around: window to the newest, start of chat, visibility", opts, async () => {
  const tag = `${Date.now()}`;
  try {
    const { bubble, members: [a, b, c] } = await bubbleWith(tag, ["Bea", "Cy"]);
    const sent: string[] = [];
    for (let i = 0; i < 60; i++) sent.push(await say(a, bubble.id, `msg ${i}`));
    const around = async (m: Member, id: string, extra: Record<string, unknown> = {}) => {
      const { data, error } = await m.c.rpc("chat_messages_around", { p_bubble_id: bubble.id, p_message_id: id, ...extra })
        .select("*, sender:users!sender_id(id, name, avatar)");
      if (error) throw new Error(`chat_messages_around: ${error.message}`);
      return data as { id: string; content: string; sender: { name: string } | null }[];
    };
    // Target #10: 10 older (start reached: fewer than 25), the target, 49 newer = all 60, newest first.
    let rows = await around(b, sent[10]);
    assertEq(rows.length, 60, "whole chat when the target is near the start");
    assertEq(rows[0].id, sent[59], "newest first");
    assertEq(rows.length - 1 - rows.findIndex((r) => r.id === sent[10]), 10, "10 older than the target: start reached");
    assert(rows[0].sender?.name, "sender embed works");
    // Target #40: 25 older (#15..#39), target, 19 newer.
    rows = await around(b, sent[40]);
    assertEq(rows.length, 45, "25 older + target + 19 newer");
    assertEq(rows[rows.length - 1].id, sent[15], "oldest row is 25 before the target");
    // Cap from the newest end: the target can fall outside.
    rows = await around(b, sent[10], { p_limit: 20 });
    assertEq(rows.length, 20, "capped");
    assert(!rows.some((r) => r.id === sent[10]), "target too far back for the cap");

    // Blocked sender, other bubble, non-member: no rows.
    await c.c.from("blocks").insert({ blocker_id: c.id, blocked_id: a.id });
    assertEq((await around(c, sent[40])).length, 0, "blocked sender's message: nothing");
    const outsider = await member(`Out ${tag}`);
    assertEq((await around(outsider, sent[40])).length, 0, "non-member: nothing");
    const { data: other } = await b.c.rpc("create_bubble", { p_name: `Other ${tag}` });
    const { data: wrong } = await b.c.rpc("chat_messages_around", { p_bubble_id: other.id, p_message_id: sent[40] });
    assertEq((wrong as unknown[]).length, 0, "message of another bubble: nothing");
    assertEq((await around(b, crypto.randomUUID())).length, 0, "unknown id: nothing");
  } finally {
    await cleanupUsers();
  }
});
