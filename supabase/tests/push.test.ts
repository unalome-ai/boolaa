// End-to-end push notification tests on the LOCAL stack: client RPCs -> triggers ->
// notification_outbox -> pg_net -> push-dispatch (PUSH_DRY_RUN=1) -> push_debug_log.
//
//   deno test -A --no-check supabase/tests/push.test.ts
//
// Needs `supabase start` with supabase/functions/.env containing PUSH_DRY_RUN=1 and
// PUSH_DISPATCH_SECRET (see .env.example) and the seed's Vault entries. Uses throwaway
// users and bubbles; flags (device / age) are forced OFF and restored.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  API, assert, assertEq, cleanupUsers, createUser, setFlags, sha256Hex, signIn, sleep, sql, TEST_DEVICE,
} from "./helpers.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };
const SECRET = Deno.env.get("PUSH_DISPATCH_SECRET") ?? "local-push-dispatch-secret-change-me";
const b64url = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function run(fn: () => Promise<void>) {
  await setFlags({ device: false, age: false });
  try {
    await fn();
  } finally {
    await cleanupUsers();
  }
}

interface Member { id: string; email: string; c: SupabaseClient; name: string }

async function member(name: string, locale = "en"): Promise<Member> {
  const u = await createUser({ name, locale });
  await sql`select public.trust_device(${u.id}::uuid, ${await sha256Hex(TEST_DEVICE)}, 'test')`;
  const c = await signIn(u.email);
  const st = await c.rpc("start_device_check", { p_device_id: TEST_DEVICE, p_label: "test" });
  assertEq(st.data?.status, "verified", `device check ${name}`);
  return { ...u, c, name };
}

/** Owner + members in a fresh bubble (every member admitted by majority vote). */
async function bubble(owner: Member, members: Member[], name = `Push ${Date.now() % 100000}`) {
  const { data: b, error } = await owner.c.rpc("create_bubble", { p_name: name });
  assert(!error, `create_bubble: ${error?.message}`);
  const inside = [owner];
  for (const m of members) {
    const { data: jr } = await m.c.rpc("request_to_join", { p_invite_code: b.invite_code });
    for (const voter of inside) {
      const r = await voter.c.rpc("approve_join_request", { p_request_id: jr.id });
      if (r.data === true) break;
    }
    inside.push(m);
  }
  return b as { id: string; name: string; invite_code: string };
}

async function android(m: Member, token: string, locale: string | null = null) {
  const r = await m.c.rpc("register_push_token", { p_platform: "android", p_token: token, p_locale: locale, p_device_id: TEST_DEVICE, p_app_version: "1.0" });
  assert(!r.error, `register android: ${r.error?.message}`);
  return r.data as string;
}

async function webSubscription(m: Member, locale: string | null = null) {
  const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${crypto.randomUUID()}`;
  const r = await m.c.rpc("register_push_token", {
    p_platform: "web", p_endpoint: endpoint,
    p_p256dh: b64url(await crypto.subtle.exportKey("raw", kp.publicKey)),
    p_auth: b64url(crypto.getRandomValues(new Uint8Array(16))), p_locale: locale,
  });
  assert(!r.error, `register web: ${r.error?.message}`);
  return endpoint;
}

async function ios(m: Member, token: string, env = "sandbox", locale: string | null = null) {
  const r = await m.c.rpc("register_push_token", { p_platform: "ios", p_token: token, p_apns_env: env, p_locale: locale });
  assert(!r.error, `register ios: ${r.error?.message}`);
}

const hex = () => [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");

async function kick() {
  const res = await fetch(`${API}/functions/v1/push-dispatch`, {
    method: "POST", headers: { "x-push-dispatch-secret": SECRET, "Content-Type": "application/json" }, body: "{}",
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

type Truthy<T> = Exclude<T, false | 0 | "" | null | undefined>;
async function waitFor<T>(what: string, fn: () => Promise<T>, ms = 20000): Promise<Truthy<T>> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v) return v as Truthy<T>;
    await sleep(300);
  }
  throw new Error(`timed out waiting for ${what}`);
}

// deno-lint-ignore no-explicit-any
const logFor = (token: string) => sql<any[]>`select * from public.push_debug_log where token = ${token} order by id`;
const outboxFor = (userId: string, bubbleId: string) =>
  // deno-lint-ignore no-explicit-any
  sql<any[]>`select * from public.notification_outbox where recipient_id = ${userId} and bubble_id = ${bubbleId} order by id`;

Deno.test("dispatcher refuses calls without the shared secret", opts, async () => {
  for (const headers of [{}, { "x-push-dispatch-secret": "wrong" }]) {
    const res = await fetch(`${API}/functions/v1/push-dispatch`, { method: "POST", headers, body: "{}" });
    assertEq(res.status, 401, "unauthorized");
    await res.body?.cancel();
  }
  const ok = await kick();
  assertEq([ok.status, ok.body.dry_run], [200, true], `dry-run dispatcher answers: ${JSON.stringify(ok.body)}`);
});

Deno.test("chat: every other member is notified in their own language, on every device", opts, () =>
  run(async () => {
    const ana = await member("Ana", "ro");
    const luc = await member("Luc", "fr");
    const tom = await member("Tom", "en");
    const b = await bubble(ana, [luc, tom], "Flatmates e2e");
    const anaTok = `e2e-ana-${crypto.randomUUID()}`;
    await android(ana, anaTok); // no token locale: user locale ro
    const lucWeb = await webSubscription(luc); // user locale fr
    const lucIos = hex();
    await ios(luc, lucIos, "sandbox", "it"); // token locale it wins
    // tom has no device

    await tom.c.from("chat_messages").insert({ bubble_id: b.id, sender_id: tom.id, content: "Pizza tonight? 🍕" });
    const [a] = await waitFor("ana's push", async () => (await logFor(anaTok)).length && logFor(anaTok));
    assertEq([a.provider, a.title, a.body, a.collapse_key], ["fcm", "Tom în Flatmates e2e", "Pizza tonight? 🍕", `chat:${b.id}`], "ana (ro, android)");
    assertEq(a.request.payload.message.android.notification.channel_id, "chat", "android channel");
    assertEq(a.request.payload.message.data, { type: "chat", bubble_id: b.id, target_id: a.request.payload.message.data.target_id, collapse_key: `chat:${b.id}` }, "deep link");

    const [w] = await waitFor("luc's web push", async () => (await logFor(lucWeb)).length && logFor(lucWeb));
    assertEq([w.provider, w.title, w.request.payload.url, w.request.headers.topic?.length], ["web", "Tom dans Flatmates e2e", `/chat?bubble=${b.id}`, 32], "luc web (fr)");
    assert(w.request.encrypted_bytes > 86, "web payload was really encrypted with the local VAPID keys");
    const [i] = await waitFor("luc's ios push", async () => (await logFor(lucIos)).length && logFor(lucIos));
    assertEq([i.provider, i.title, i.request.headers["apns-collapse-id"], i.request.payload.aps["thread-id"]],
      ["apns", "Tom in Flatmates e2e", `chat:${b.id}`, b.id], "luc ios (it)");
    assert(i.request.url.startsWith("https://api.sandbox.push.apple.com/3/device/"), "sandbox host for a sandbox token");

    assertEq((await outboxFor(tom.id, b.id)).length, 0, "author not notified");
    const rows = [...await outboxFor(ana.id, b.id), ...await outboxFor(luc.id, b.id)];
    await waitFor("rows sent", async () => (await sql`select bool_and(status = 'sent') ok from public.notification_outbox where id = any(${rows.map((r) => r.id)})`)[0].ok);
    const logs = await sql`select title, body, request::text r from public.push_debug_log where outbox_id = any(${rows.map((r) => r.id)})`;
    assert(logs.every((l) => !/@/.test(l.title + l.body + l.r)), "no email address in any payload");
  }));

Deno.test("join request, approval, new event: right people, right text", opts, () =>
  run(async () => {
    const ana = await member("Ana", "ro");
    const bob = await member("Bob", "en");
    const b = await bubble(ana, [bob], "Climbers e2e");
    const anaTok = `e2e-ana-${crypto.randomUUID()}`, bobTok = `e2e-bob-${crypto.randomUUID()}`, newTok = `e2e-new-${crypto.randomUUID()}`;
    await android(ana, anaTok);
    await android(bob, bobTok);
    const nina = await member("Nina", "es");
    await android(nina, newTok);

    const { data: jr } = await nina.c.rpc("request_to_join", { p_invite_code: b.invite_code });
    const [a] = await waitFor("ana: join request", async () => (await logFor(anaTok)).length && logFor(anaTok));
    assertEq([a.title, a.body], ["Climbers e2e", "Nina vrea să se alăture"], "join request (ro)");
    const [bb] = await waitFor("bob: join request", async () => (await logFor(bobTok)).length && logFor(bobTok));
    assertEq(bb.body, "Nina wants to join", "join request (en)");

    await ana.c.rpc("approve_join_request", { p_request_id: jr.id });
    assertEq((await bob.c.rpc("approve_join_request", { p_request_id: jr.id })).data, true, "admitted");
    const [n] = await waitFor("nina: approval", async () => (await logFor(newTok)).length && logFor(newTok));
    assertEq([n.title, n.request.payload.message.data.type], ["¡Ya formas parte de Climbers e2e!", "approval"], "approval (es)");

    await bob.c.from("events").insert({ bubble_id: b.id, creator_id: bob.id, title: "Boulder night", datetime: new Date(Date.now() + 3 * 86400_000).toISOString() });
    const ev = await waitFor("event pushes", async () => {
      const l = (await logFor(anaTok)).filter((x) => x.request.payload.message.data.type === "new_event");
      const m = (await logFor(newTok)).filter((x) => x.request.payload.message.data.type === "new_event");
      return l.length && m.length && [l[0], m[0]];
    });
    assertEq([ev[0].title, ev[0].body], ["Eveniment nou în Climbers e2e", "Bob a adăugat Boulder night"], "event (ro)");
    assertEq(ev[1].request.payload.message.android.notification.channel_id, "events", "events channel");
    assertEq((await logFor(bobTok)).filter((x) => x.request.payload.message.data.type === "new_event").length, 0, "creator not notified");
  }));

Deno.test("prefs, preview_content, mutes and blocks are respected", opts, () =>
  run(async () => {
    const ana = await member("Ana", "en");
    const bob = await member("Bob", "en");
    const cy = await member("Cy", "en");
    const b = await bubble(ana, [bob, cy], "Prefs e2e");
    const anaTok = `e2e-ana-${crypto.randomUUID()}`, cyTok = `e2e-cy-${crypto.randomUUID()}`;
    await android(ana, anaTok);
    await android(cy, cyTok);

    // ana: preview off. cy: blocks bob.
    assert(!(await ana.c.from("notification_prefs").update({ preview_content: false }).eq("user_id", ana.id)).error, "prefs update");
    assert(!(await cy.c.from("blocks").insert({ blocker_id: cy.id, blocked_id: bob.id })).error, "block");
    await bob.c.from("chat_messages").insert({ bubble_id: b.id, sender_id: bob.id, content: "secret plans" });
    const [a] = await waitFor("ana's private push", async () => (await logFor(anaTok)).length && logFor(anaTok));
    assertEq([a.title, a.body], ["Boolaa", "New message in Prefs e2e"], "no name, no text");
    assert(!JSON.stringify(a.request).includes("secret plans") && !JSON.stringify(a.request).includes("Bob"), "content not in the payload");
    assertEq((await outboxFor(cy.id, b.id)).length, 0, "cy blocked bob: nothing");

    // cy unblocks, mutes the bubble for an hour: still nothing. Food is off by default.
    await cy.c.from("blocks").delete().eq("blocked_id", bob.id);
    assert(!(await cy.c.from("bubble_mutes").insert({ user_id: cy.id, bubble_id: b.id, until: new Date(Date.now() + 3600_000).toISOString() })).error, "mute");
    await bob.c.from("chat_messages").insert({ bubble_id: b.id, sender_id: bob.id, content: "muted?" });
    await bob.c.from("food_posts").insert({ bubble_id: b.id, user_id: bob.id, image: "https://x.test/a.jpg", description: "Soup" });
    await sleep(1500);
    assertEq((await outboxFor(cy.id, b.id)).length, 0, "muted bubble");
    assertEq((await outboxFor(ana.id, b.id)).filter((r) => r.type === "food").length, 0, "food off by default");

    // Unmute; turn food on for cy.
    await cy.c.from("bubble_mutes").delete().eq("bubble_id", b.id);
    await cy.c.from("notification_prefs").update({ food: true }).eq("user_id", cy.id);
    await bob.c.from("food_posts").insert({ bubble_id: b.id, user_id: bob.id, image: "https://x.test/b.jpg", description: "Leftover soup" });
    const f = await waitFor("cy's food push", async () => (await logFor(cyTok)).find((x) => x.request.payload.message.data.type === "food"));
    assertEq([f.title, f.body], ["Food Circle · Prefs e2e", "Bob: Leftover soup"], "food");
  }));

Deno.test("chat bursts are coalesced: <= 1 push per 30 s per bubble, newest wins", opts, () =>
  run(async () => {
    const ana = await member("Ana", "en");
    const bob = await member("Bob", "en");
    const b = await bubble(ana, [bob], "Burst e2e");
    const tok = `e2e-ana-${crypto.randomUUID()}`;
    await android(ana, tok);
    for (const t of ["one", "two", "three", "four"]) {
      await bob.c.from("chat_messages").insert({ bubble_id: b.id, sender_id: bob.id, content: t });
    }
    await waitFor("first push", async () => (await logFor(tok)).length);
    await sleep(1000);
    const rows = await outboxFor(ana.id, b.id);
    assert(rows.length <= 2, `at most 2 outbox rows for 4 messages, got ${rows.length}`);
    assertEq(rows.reduce((n, r) => n + Number(r.payload.count), 0), 4, "every message counted once");
    assertEq((await logFor(tok)).length, 1, "only one push so far");
    if (rows.length === 2) {
      const [first, second] = rows;
      assertEq(second.status, "pending", "second waits");
      assert(new Date(second.next_attempt_at).getTime() >= new Date(first.claimed_at).getTime() + 29_900, "deferred to the end of the 30 s window");
      // Don't wait 30 s: make it due and wake the dispatcher.
      await sql`update public.notification_outbox set next_attempt_at = now() where id = ${second.id}`;
      await kick();
      const logs = await waitFor("second push", async () => { const l = await logFor(tok); return l.length === 2 && l; });
      const n = Number(second.payload.count) - 1;
      assertEq(logs[1].body, n === 0 ? "four" : `four +${n} more message${n > 1 ? "s" : ""}`, "newest text + count");
      assertEq(logs[1].collapse_key, logs[0].collapse_key, "same collapse key replaces the older one");
    } else {
      const [l] = await logFor(tok);
      assertEq(l.body, "four +3 more messages", "one push for the whole burst");
    }
  }));

Deno.test("concurrent senders: no deadlock, every message counted once, still <= 2 rows", opts, () =>
  run(async () => {
    const ana = await member("Ana", "en");
    const bob = await member("Bob", "en");
    const cy = await member("Cy", "en");
    const b = await bubble(ana, [bob, cy], "Race e2e");
    const tok = `e2e-ana-${crypto.randomUUID()}`;
    await android(ana, tok);
    const send = (m: Member, i: number) => m.c.from("chat_messages").insert({ bubble_id: b.id, sender_id: m.id, content: `${m.name} ${i}` });
    const res = await Promise.all([0, 1, 2, 3, 4, 5].flatMap((i) => [send(bob, i), send(cy, i)]));
    assert(res.every((r) => !r.error), `all 12 messages saved: ${res.find((r) => r.error)?.error?.message}`);
    await waitFor("first push", async () => (await logFor(tok)).length);
    await sleep(1000);
    const rows = await outboxFor(ana.id, b.id);
    assert(rows.length <= 2, `at most 2 rows, got ${rows.length}`);
    assertEq(rows.reduce((n, r) => n + Number(r.payload.count), 0), 12, "every message counted once");
    assertEq((await logFor(tok)).length, 1, "one push so far");
  }));

Deno.test("event reminders fire once, 1 hour before, for RSVPed members", opts, () =>
  run(async () => {
    const ana = await member("Ana", "it");
    const bob = await member("Bob", "en");
    const b = await bubble(ana, [bob], "Reminders e2e");
    const anaTok = `e2e-ana-${crypto.randomUUID()}`, bobTok = `e2e-bob-${crypto.randomUUID()}`;
    await android(ana, anaTok);
    await android(bob, bobTok);
    const { data: ev } = await ana.c.from("events").insert({
      bubble_id: b.id, creator_id: ana.id, title: "Cena", location: "Cucina",
      datetime: new Date(Date.now() + 40 * 60_000).toISOString(),
    }).select("id").single();
    await ana.c.rpc("toggle_rsvp", { p_event_id: ev!.id });
    await sql`select public.enqueue_event_reminders()`;
    await sql`select public.enqueue_event_reminders()`; // a second cron run
    const [r] = await waitFor("ana's reminder", async () => {
      const l = (await logFor(anaTok)).filter((x) => x.request.payload.message.data.type === "event_reminder");
      return l.length && l;
    });
    assertEq([r.title, r.body], ["Cena", "Inizia tra 1 ora · Cucina"], "reminder (it)");
    await sql`select public.enqueue_event_reminders()`;
    await kick();
    assertEq((await logFor(anaTok)).filter((x) => x.request.payload.message.data.type === "event_reminder").length, 1, "exactly once");
    assertEq((await logFor(bobTok)).filter((x) => x.request.payload.message.data.type === "event_reminder").length, 0, "bob did not RSVP");
  }));

Deno.test("invalid tokens are deleted, transient errors retried, sign-out drops tokens", opts, () =>
  run(async () => {
    const ana = await member("Ana", "en");
    const bob = await member("Bob", "en");
    const b = await bubble(ana, [bob], "Tokens e2e");
    const good = `e2e-good-${crypto.randomUUID()}`;
    const bad = `e2e-invalid-${crypto.randomUUID()}`;
    const flaky = `e2e-transient-${crypto.randomUUID()}`;
    const badIos = "dead" + hex().slice(4);
    // Different "devices": register without the device id so they don't replace each other.
    for (const t of [good, bad, flaky]) {
      const r = await ana.c.rpc("register_push_token", { p_platform: "android", p_token: t });
      assert(!r.error, r.error?.message ?? "");
    }
    await ios(ana, badIos, "production");
    await bob.c.from("chat_messages").insert({ bubble_id: b.id, sender_id: bob.id, content: "hi" });

    const [row] = await waitFor("row settled", async () => {
      const r = await outboxFor(ana.id, b.id);
      return r.length && r[0].claimed_until === null && r[0].attempts === 1 && r;
    });
    const tokens = (await sql`select token from public.push_tokens where user_id = ${ana.id}`).map((t) => t.token).sort();
    assertEq(tokens, [good, flaky].sort(), "FCM UNREGISTERED and APNs 410 tokens deleted");
    assertEq(row.status, "pending", "retry scheduled");
    const flakyId = (await sql`select id from public.push_tokens where token = ${flaky}`)[0].id;
    assertEq(row.token_ids, [flakyId], "only the transient token is retried");
    assert(new Date(row.next_attempt_at).getTime() > Date.now() + 20_000, "backoff ~30 s");
    assert(/transient|UNAVAILABLE/.test(row.last_error) || /fcm:/.test(row.last_error), `error kept: ${row.last_error}`);
    assertEq((await logFor(good)).length, 1, "the good device got it once");

    // Sign-out (this session) removes ana's tokens on the server.
    await ana.c.auth.signOut();
    await waitFor("tokens gone after sign-out", async () =>
      (await sql`select count(*)::int n from public.push_tokens where user_id = ${ana.id}`)[0].n === 0);
  }));
