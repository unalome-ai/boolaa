// @mentions in chat (migration 20261124200000_chat_mentions.sql, docs/boolaa-spec.md "Mentions"),
// against the LOCAL stack:
//
//   deno test -A --no-check supabase/tests/chat_mentions.test.ts
//
// Throwaway users and bubbles only. Never changes app_settings flags. The push end-to-end case
// needs the dry-run dispatcher (PUSH_DRY_RUN=1, see push.test.ts).
import type { RealtimeChannel, SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  admin, assert, assertEq, cleanupUsers, codeOf, createUser, deviceCode, sha256Hex, signIn, sleep, sql, TEST_DEVICE, token,
  waitMail,
} from "./helpers.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };
const tag = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

async function member(name: string) {
  const u = await createUser({ name });
  await sql`select public.trust_device(${u.id}::uuid, ${await sha256Hex(TEST_DEVICE)}, 'test')`;
  const c = await signIn(u.email);
  const st = await c.rpc("start_device_check", { p_device_id: TEST_DEVICE });
  assertEq(st.data?.status, "verified", `device check for ${name}`);
  const r = await c.rpc("register_push_token", { p_platform: "android", p_token: `cm-${crypto.randomUUID()}`, p_device_id: TEST_DEVICE });
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
async function fails(p: PromiseLike<{ error: { message: string; code?: string } | null }>, text: string, what: string) {
  const { error } = await p;
  assert(error, `${what}: expected "${text}", got success`);
  assert(error.message.includes(text), `${what}: expected "${text}", got "${error.message}"`);
  return error;
}
async function until(fn: () => boolean | Promise<boolean>, ms = 8000) {
  for (let t = 0; t < ms; t += 200) {
    if (await fn()) return true;
    await sleep(200);
  }
  return await fn();
}

type Mention = { start: number; length: number; user_id: string };
/** A mention of `m` at the first "@<name>" in text, offsets in code points (like the clients). Keys in
 *  the order jsonb returns them (shorter keys first), so results compare with assertEq. */
function at(text: string, m: { id: string; name: string }, label = m.name): Mention {
  const cps = Array.from(text);
  const needle = Array.from(`@${label}`);
  for (let i = 0; i + needle.length <= cps.length; i++) {
    if (needle.every((ch, k) => cps[i + k] === ch)) return { start: i, length: needle.length, user_id: m.id };
  }
  throw new Error(`@${label} not in ${text}`);
}
async function send(m: Member, bubbleId: string, content: string, mentions: unknown, id = crypto.randomUUID()) {
  return await m.c.from("chat_messages").insert({ id, bubble_id: bubbleId, sender_id: m.id, content, mentions })
    .select("id, content, mentions").single();
}
const stored = async (id: string) => (await sql`select content, mentions, deleted_at from public.chat_messages where id = ${id}`)[0];
const outbox = (recipient: string, bubbleId: string) =>
  sql`select type, target_id, collapse_key, dedupe_key from public.notification_outbox
       where recipient_id = ${recipient} and bubble_id = ${bubbleId} order by id`;

Deno.test("schema: column, constraints, pref, push type, grants", opts, async () => {
  const [col] = await sql`select data_type, is_nullable, column_default from information_schema.columns
                           where table_schema = 'public' and table_name = 'chat_messages' and column_name = 'mentions'`;
  assertEq([col.data_type, col.is_nullable, col.column_default], ["jsonb", "NO", "'[]'::jsonb"], "mentions column");
  const [np] = await sql`select column_default from information_schema.columns
                          where table_schema = 'public' and table_name = 'notification_prefs' and column_name = 'mentions'`;
  assertEq(np.column_default, "true", "mentions pref defaults on");
  const [chk] = await sql`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'notification_outbox_type_check'`;
  assert(chk.d.includes("chat_mention"), "outbox accepts chat_mention");
  const [p] = await sql`select has_function_privilege('authenticated', 'public.mention_candidates(uuid)', 'execute') c,
                               has_function_privilege('anon', 'public.mention_candidates(uuid)', 'execute') a,
                               has_function_privilege('authenticated', 'public.chat_mention_user_ids(jsonb)', 'execute') i`;
  assertEq([p.c, p.a, p.i], [true, false, false], "grants");
});

Deno.test("insert: valid mentions stored normalised; structural errors refused; cap 10", opts, async () => {
  try {
    const A = await member(`CM Ana ${tag}`);
    const B = await member(`CM Ben ${tag}`);
    const C = await member(`CM Cy ${tag}`);
    const b = await bubbleWith(A, [B, C], `CM insert ${tag}`);

    // Code points: the pizza emoji is one code point (two UTF-16 units), so @Ben starts at 2.
    const text = `🍕 @${B.name} and @${C.name}, dinner?`;
    const mB = at(text, B), mC = at(text, C);
    assertEq(mB.start, 2, "code-point offset after an emoji");
    // Given out of order, with an extra key and an upper-case uuid: stored sorted and normalised.
    const ins = await must(send(A, b.id, text, [
      { ...mC, extra: "x" },
      { user_id: B.id.toUpperCase(), start: mB.start, length: mB.length },
    ]), "insert");
    assertEq(ins.mentions, [mB, mC], "sorted, normalised");
    assertEq(ins.content, text, "text untouched");
    // Same user twice is kept (two spans).
    const twice = `@${B.name} @${B.name}`;
    const t2 = await must(send(A, b.id, twice, [at(twice, B), { user_id: B.id, start: B.name.length + 2, length: B.name.length + 1 }]), "twice");
    assertEq(t2.mentions.length, 2, "two spans of the same person");
    // No mentions at all: [] (also when sent as null).
    assertEq((await must(send(A, b.id, "plain", null), "null mentions")).mentions, [], "null -> []");
    assertEq((await must(A.c.from("chat_messages").insert({ bubble_id: b.id, sender_id: A.id, content: "no key" }).select("mentions").single(), "default")).mentions, [], "default []");

    const bad: [unknown, string][] = [
      [{ user_id: B.id, start: 0, length: 4 }, "not an array"],
      [["x"], "entry not an object"],
      [[{ user_id: "nope", start: 2, length: mB.length }], "bad uuid"],
      [[{ user_id: B.id, start: "2", length: mB.length }], "start as string"],
      [[{ user_id: B.id, start: 2.5, length: mB.length }], "fractional start"],
      [[{ user_id: B.id, start: -1, length: 2 }], "negative start"],
      [[{ user_id: B.id, length: mB.length }], "missing start"],
      [[{ user_id: B.id, start: 3, length: mB.length }], "span not starting with @"],
      [[{ user_id: B.id, start: 2, length: 1 }], "length 1"],
      [[{ user_id: B.id, start: 2, length: 500 }], "past the end"],
      [[mB, { user_id: C.id, start: mB.start + 1, length: 3 }], "overlap"],
    ];
    for (const [m, what] of bad) await fails(send(A, b.id, text, m), "invalid mentions", what);
    await fails(send(A, b.id, `@x\ny`, [{ user_id: B.id, start: 0, length: 4 }]), "invalid mentions", "line break in a span");
    const many = Array.from({ length: 11 }, (_, i) => `@${i}`).join(" ");
    const elevenSpans = Array.from({ length: 11 }, (_, i) => ({ user_id: B.id, start: i * 3, length: 2 }));
    const e = await fails(send(A, b.id, many, elevenSpans), "too many mentions", "11 spans");
    assertEq(e.code, "22023", "SQLSTATE");
    assertEq((await must(send(A, b.id, many, elevenSpans.slice(0, 10)), "10 spans")).mentions.length, 10, "10 is fine");
  } finally {
    await cleanupUsers();
  }
});

Deno.test("insert: self, non-members, pending requesters and blocks (either way) are dropped, the text stays", opts, async () => {
  try {
    const A = await member(`CMD Ana ${tag}`);
    const B = await member(`CMD Ben ${tag}`);
    const C = await member(`CMD Cy ${tag}`); // A blocks C
    const D = await member(`CMD Dee ${tag}`); // D blocks A
    const X = await member(`CMD Xan ${tag}`); // other bubble
    const P = await member(`CMD Pia ${tag}`); // pending request
    const b = await bubbleWith(A, [B, C, D], `CMD ${tag}`);
    await bubbleWith(X, [], `CMD other ${tag}`);
    await must(P.c.rpc("request_to_join", { p_invite_code: b.invite_code }), "P asks to join");
    assert(!(await A.c.from("blocks").insert({ blocker_id: A.id, blocked_id: C.id })).error, "A blocks C");
    assert(!(await D.c.from("blocks").insert({ blocker_id: D.id, blocked_id: A.id })).error, "D blocks A");

    const text = `@${A.name} @${B.name} @${C.name} @${D.name} @${X.name} @${P.name} @Ghost`;
    const ghost = { id: crypto.randomUUID(), name: "Ghost" };
    const all = [A, B, C, D, X, P, ghost].map((m) => at(text, m));
    const row = await must(send(A, b.id, text, all), "insert");
    assertEq(row.mentions, [at(text, B)], "only Ben survives");
    assertEq(row.content, text, "text as written");

    // mention_candidates: the composer list = the rendering rule.
    const names = async (c: SupabaseClient) =>
      (await must(c.rpc("mention_candidates", { p_bubble_id: b.id }), "candidates")).map((r: { name: string }) => r.name);
    assertEq(await names(A.c), [B.name], "A: not self, not C (A blocked), not D (blocked A), not pending P");
    assertEq((await names(B.c)).sort(), [A.name, C.name, D.name].sort(), "B sees everyone else");
    assertEq(await names(X.c), [], "non-member gets nothing");
    const [cand] = await must(A.c.rpc("mention_candidates", { p_bubble_id: b.id }), "row shape");
    assertEq(Object.keys(cand).sort(), ["avatar", "name", "user_id"], "columns");
  } finally {
    await cleanupUsers();
  }
});

Deno.test("outbox retry, realtime, pages, soft delete, leaving and deleted accounts", opts, async () => {
  let ch: RealtimeChannel | null = null;
  try {
    const A = await member(`CMR Ana ${tag}`);
    const B = await member(`CMR Ben ${tag}`);
    const C = await member(`CMR Cy ${tag}`);
    const b = await bubbleWith(A, [B, C], `CMR ${tag}`);

    // Live: the INSERT carries mentions (no extra subscription).
    const live: Record<string, unknown>[] = [];
    await B.c.realtime.setAuth(await token(B.c));
    ch = B.c.channel(`chat-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `bubble_id=eq.${b.id}` },
        (p) => live.push(p.new as Record<string, unknown>));
    await new Promise<void>((res, rej) =>
      ch!.subscribe((s) => (s === "SUBSCRIBED" ? res() : s === "CHANNEL_ERROR" || s === "TIMED_OUT" ? rej(new Error(s)) : null)));
    await sleep(1500); // the change subscription registers just after SUBSCRIBED

    // Outbox retry: same client id twice -> 23505, row read back by id with its mentions.
    const id = crypto.randomUUID();
    const text = `@${B.name} @${C.name} see you`;
    const first = await must(send(A, b.id, text, [at(text, B), at(text, C)], id), "first try");
    const retry = await send(A, b.id, text, [at(text, B), at(text, C)], id);
    assertEq(retry.error?.code, "23505", "retry = duplicate key = sent");
    const back = await must(A.c.from("chat_messages").select("id, mentions").eq("id", id).single(), "read back");
    assertEq(back.mentions, first.mentions, "same mentions");
    assert(await until(() => live.some((m) => m.id === id)), "live INSERT arrived");
    assertEq(live.find((m) => m.id === id)!.mentions, first.mentions, "live payload has mentions");

    // Pages and jump-to-message return them too.
    const page = await must(B.c.rpc("chat_messages_page", { p_bubble_id: b.id }), "page");
    assertEq(page.find((m: { id: string }) => m.id === id)?.mentions, first.mentions, "chat_messages_page");
    const around = await must(B.c.rpc("chat_messages_around", { p_bubble_id: b.id, p_message_id: id }), "around");
    assertEq(around.find((m: { id: string }) => m.id === id)?.mentions, first.mentions, "chat_messages_around");

    // Queued offline while C was a member, sent after C left: the mention of C is dropped, B kept.
    assert(!(await C.c.from("bubble_members").delete().eq("bubble_id", b.id).eq("user_id", C.id)).error, "C leaves");
    const late = await must(send(A, b.id, text, [at(text, B), at(text, C)]), "late send");
    assertEq(late.mentions, [at(text, B)], "C dropped after leaving");
    // Older messages keep C's span; C is no longer a candidate, so clients render "@CMR Cy" plain.
    assertEq((await stored(id)).mentions.length, 2, "history unchanged");
    assert(!(await must(A.c.rpc("mention_candidates", { p_bubble_id: b.id }), "cands")).some((r: { user_id: string }) => r.user_id === C.id),
      "C not a candidate");

    // B deletes their account: the span stays (text "@CMR Ben ..." as written), B's user row is gone,
    // so the reader can't resolve it and shows the plain text.
    await admin.auth.admin.deleteUser(B.id);
    const after = await stored(id);
    assertEq([after.content, after.mentions], [text, first.mentions], "message unchanged");
    assertEq((await A.c.from("users").select("id").eq("id", B.id)).data, [], "no user row to resolve");
    assertEq(await must(A.c.rpc("mention_candidates", { p_bubble_id: b.id }), "cands after deletion"), [], "no candidates left");

    // Soft delete wipes the mentions with the text.
    await must(A.c.rpc("delete_chat_message", { p_message_id: id }), "delete");
    const del = await stored(id);
    assertEq([del.content, del.mentions, Boolean(del.deleted_at)], ["", [], true], "wiped");
    // Clients still can't update rows directly.
    const upd = await A.c.from("chat_messages").update({ mentions: [] }).eq("id", late.id).select("id");
    assert(upd.error || (upd.data ?? []).length === 0, "no direct update");
  } finally {
    if (ch) await ch.unsubscribe();
    await cleanupUsers();
  }
});

Deno.test("push: chat_mention for the mentioned only, deduped against the chat push, prefs and mutes", opts, async () => {
  try {
    const A = await member(`CMP Ana ${tag}`); // sender
    const B = await member(`CMP Ben ${tag}`); // mentioned, defaults
    const C = await member(`CMP Cy ${tag}`); // mentioned, mentions off (chat on)
    const D = await member(`CMP Dee ${tag}`); // mentioned, bubble muted
    const E = await member(`CMP Eve ${tag}`); // mentioned, chat off, mentions on ("only mentions")
    const M = await member(`CMP Max ${tag}`); // not mentioned
    const b = await bubbleWith(A, [B, C, D, E, M], `CMP ${tag}`);
    await sql`update public.notification_prefs set mentions = false where user_id = ${C.id}`;
    await sql`update public.notification_prefs set chat = false where user_id = ${E.id}`;
    assert(!(await D.c.from("bubble_mutes").insert({ user_id: D.id, bubble_id: b.id, until: null })).error, "D mutes");
    await sql`delete from public.notification_outbox where bubble_id = ${b.id}`;

    const text = `@${B.name} @${C.name} @${D.name} @${E.name} @${B.name} dinner at 8?`;
    const row = await must(send(A, b.id, text, [B, C, D, E].map((m) => at(text, m)).concat([
      { start: Array.from(text).lastIndexOf("@"), length: B.name.length + 1, user_id: B.id },
    ])), "send");
    const types = async (m: Member) => (await outbox(m.id, b.id)).map((r) => `${r.type}:${r.target_id === row.id}`);
    assertEq(await types(B), ["chat_mention:true"], "B: one mention push (two spans), no chat push");
    const [bRow] = await outbox(B.id, b.id);
    assertEq([bRow.collapse_key, bRow.dedupe_key], [`mention:${row.id}`, `mention:${row.id}`], "keys");
    assertEq(await types(C), ["chat:true"], "C: mentions off -> regular chat push");
    assertEq(await types(D), [], "D: muted -> nothing");
    assertEq(await types(E), ["chat_mention:true"], "E: chat off, mentions on -> the mention still comes");
    assertEq(await types(M), ["chat:true"], "M: regular chat push");
    assertEq(await types(A), [], "sender: nothing");

    // Claim in a rolled-back transaction: data rendered while live, content_gone once deleted.
    const claim = async () => await sql.begin(async (tx) => {
      await tx`update public.notification_outbox set status = 'pending', claimed_at = null, claimed_until = null, attempts = 0, next_attempt_at = now()
                where recipient_id = ${B.id} and type = 'chat_mention' and target_id = ${row.id}`;
      await tx`update public.notification_outbox set next_attempt_at = now() + interval '1 day'
                where status = 'pending' and not (recipient_id = ${B.id} and type = 'chat_mention' and target_id = ${row.id})`;
      const [r] = await tx`select public.claim_push_batch(500) as items`;
      const [st] = await tx`select status, last_error from public.notification_outbox
                             where recipient_id = ${B.id} and type = 'chat_mention' and target_id = ${row.id}`;
      throw { rollback: true, items: r.items, st };
    }).catch((e) => e);
    const live = await claim();
    assert(live.rollback, `claim ran: ${live}`);
    // deno-lint-ignore no-explicit-any
    const mine = (live.items as any[]).filter((i) => i.type === "chat_mention" && i.target_id === row.id);
    assertEq(mine.map((i) => [i.data, i.actor_name, i.collapse_key]), [[{ text, photo: false }, A.name, `mention:${row.id}`]], "rendered data");
    await must(A.c.rpc("delete_chat_message", { p_message_id: row.id }), "delete");
    const gone = await claim();
    assertEq([gone.st.status, gone.st.last_error], ["skipped", "content_gone"], "deleted message is not pushed");

    // A block after sending filters the push at send time (push_should_notify, both ways).
    const text2 = `@${B.name} ping`;
    const row2 = await must(send(A, b.id, text2, [at(text2, B)]), "send 2");
    assert(!(await B.c.from("blocks").insert({ blocker_id: B.id, blocked_id: A.id })).error, "B blocks A");
    assert(!(await sql`select public.push_should_notify(${B.id}, 'chat_mention', ${b.id}, ${A.id}) ok`)[0].ok, "filtered after the block");
    assert(row2.id, "second message");
  } finally {
    await cleanupUsers();
  }
});

Deno.test("push-dispatch (dry run): the mentioned person gets 'X mentioned you in <bubble>' with a message deep link", opts, async () => {
  try {
    const A = await member(`CMX Ana ${tag}`);
    const B = await member(`CMX Ben ${tag}`);
    const b = await bubbleWith(A, [B], `CMX ${tag}`);
    const tok = (await sql`select token from public.push_tokens where user_id = ${B.id}`)[0].token as string;
    const text = `@${B.name} are you home?`;
    const row = await must(send(A, b.id, text, [at(text, B)]), "send");
    // deno-lint-ignore no-explicit-any
    const logs = async () => (await sql<any[]>`select * from public.push_debug_log where token = ${tok} order by id`)
      .filter((l) => l.request?.payload?.message?.data?.target_id === row.id);
    assert(await until(async () => (await logs()).length > 0, 20000), "push went out");
    await sleep(1500);
    const all = await logs();
    assertEq(all.length, 1, "exactly one notification for this message");
    assertEq([all[0].title, all[0].body], [`CMX Ana ${tag} mentioned you in CMX ${tag}`, text], "text");
    assertEq(all[0].request.payload.message.data,
      { type: "chat_mention", bubble_id: b.id, target_id: row.id, collapse_key: `mention:${row.id}` }, "deep link");
  } finally {
    await cleanupUsers();
  }
});

Deno.test("search: text as written, and mentions by the member's current name", opts, async () => {
  try {
    const A = await member(`CMS Ana ${tag}`);
    const B = await member(`CMS Ben ${tag}`);
    const C = await member(`CMS Cy ${tag}`);
    const b = await bubbleWith(A, [B, C], `CMS ${tag}`);
    const text = `@${B.name} bring the speaker`;
    const row = await must(send(A, b.id, text, [at(text, B)]), "send");
    const plain = await must(send(A, b.id, "Zorblax speaker is broken", []), "plain");
    const search = async (c: SupabaseClient, q: string) =>
      (await must(c.rpc("search_bubble", { p_bubble_id: b.id, p_query: q }), `search ${q}`)).map((r: { id: string }) => r.id);

    assert((await search(C.c, "cms ben")).includes(row.id), "the written name matches");
    const newName = `Quillon ${tag}`;
    assert(!(await search(C.c, "quillon")).includes(row.id), "not yet renamed");
    assert(!(await B.c.from("users").update({ name: newName }).eq("id", B.id)).error, "B renames");
    const hits = await must(C.c.rpc("search_bubble", { p_bubble_id: b.id, p_query: "quillon" }), "by new name");
    assertEq(hits.map((h: { id: string }) => h.id), [row.id], "found by the mentioned member's current name");
    assertEq([hits[0].kind, hits[0].snippet, hits[0].author_id, hits[0].matched_words], ["chat_message", text, A.id, ["quillon"]], "row shape");
    assert(!(await search(C.c, "quillon")).includes(plain.id), "unrelated message not returned");
    assertEq(await must(C.c.rpc("search_bubble", { p_bubble_id: b.id, p_query: "quillon", p_kinds: ["event"] }), "kinds"), [], "p_kinds respected");
    // A member the reader is blocked with doesn't count.
    assert(!(await C.c.from("blocks").insert({ blocker_id: C.id, blocked_id: B.id })).error, "C blocks B");
    assertEq(await search(C.c, "quillon"), [], "blocked member's name doesn't match");
    assert((await search(A.c, "quillon")).includes(row.id), "others still find it");
    // Deleted messages never match.
    await must(A.c.rpc("delete_chat_message", { p_message_id: row.id }), "delete");
    assertEq(await search(A.c, "quillon"), [], "deleted message gone");
  } finally {
    await cleanupUsers();
  }
});

Deno.test("data export: own messages carry their mentions", opts, async () => {
  try {
    const A = await member(`CME Ana ${tag}`);
    const B = await member(`CME Ben ${tag}`);
    const b = await bubbleWith(A, [B], `CME ${tag}`);
    const text = `@${B.name} thanks!`;
    const mine = await must(send(A, b.id, text, [at(text, B)]), "A mentions B");
    const theirs = `@${A.name} welcome`;
    await must(send(B, b.id, theirs, [at(theirs, A)]), "B mentions A");

    const sent = await deviceCode(A.c, { action: "send", purpose: "sensitive_action", sensitive_action: "export_data" });
    assertEq(sent.status, 200, `send code: ${JSON.stringify(sent.body)}`);
    const mail = await waitMail(A.email, { subject: /confirmation code/i });
    const ok = await deviceCode(A.c, { action: "verify", purpose: "sensitive_action", code: codeOf(mail) });
    assertEq(ok.status, 200, `verify: ${JSON.stringify(ok.body)}`);
    const doc = await must(A.c.rpc("export_my_data"), "export");
    // deno-lint-ignore no-explicit-any
    const msgs = doc.chat_messages.filter((m: any) => m.bubble_id === b.id);
    assertEq(msgs.map((m: { id: string; content: string; mentions: Mention[] }) => [m.id, m.content, m.mentions]),
      [[mine.id, text, [at(text, B)]]], "own message with mentions; B's message about A is not included");
    assert(Array.isArray(doc.item_requests) && Array.isArray(doc.food_posts) && doc.format === "boolaa-data-export", "rest intact");
  } finally {
    await cleanupUsers();
  }
});
