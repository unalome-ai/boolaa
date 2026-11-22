// Data export (migration 20261123200000_data_export.sql, Edge Function `data-export`,
// docs/boolaa-spec.md "Data export"):
//
//   deno test -A --no-check supabase/tests/data_export.test.ts
//
// The RPC is tested through the real GoTrue + PostgREST + Storage of the LOCAL stack, and the
// sensitive-action code through the running `device-code` function and Mailpit. The new
// `data-export` function is NOT loaded by the local edge runtime (functions are registered when the
// stack starts, and the stack may not be restarted), so its handler runs in-process here with the
// same wiring as index.ts, against the local API. Throwaway users and bubbles only; never changes
// app_settings flags.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  admin, ANON_KEY, API, assert, assertEq, client, cleanupUsers, codeOf, createUser, deviceCode, sha256Hex, signIn,
  sql, TEST_DEVICE, token, waitMail,
} from "./helpers.ts";
import { createHandler, type Deps, fileName, mapRpcError, orderKeys } from "../functions/data-export/handler.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const opts = { sanitizeOps: false, sanitizeResources: false };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const tag = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

/** The handler with index.ts's wiring, but in-process and pointed at the local API. */
function localHandler() {
  const o = { auth: { persistSession: false, autoRefreshToken: false } };
  return createHandler({
    async getUser(jwt) {
      const { data, error } = await admin.auth.getUser(jwt);
      return error || !data?.user ? null : { id: data.user.id };
    },
    async exportData(jwt) {
      const user = createClient(API, ANON_KEY, { ...o, global: { headers: { Authorization: `Bearer ${jwt}` } } });
      const { data, error } = await user.rpc("export_my_data");
      return { data, error };
    },
    async signUrls(bucket, paths, expiresIn) {
      const { data, error } = await admin.storage.from(bucket).createSignedUrls(paths, expiresIn);
      if (error) throw error;
      const out = new Map<string, string>();
      for (const r of data ?? []) if (!r.error && r.path && r.signedUrl) out.set(r.path, r.signedUrl);
      return out;
    },
    publicUrl: (bucket, path) => admin.storage.from(bucket).getPublicUrl(path).data.publicUrl,
  });
}
const handler = localHandler();
const callExport = async (c: SupabaseClient) =>
  await handler(new Request("http://local/functions/v1/data-export", { method: "POST", headers: { Authorization: `Bearer ${await token(c)}` } }));

async function member(name: string) {
  const u = await createUser({ name });
  await sql`select public.trust_device(${u.id}::uuid, ${await sha256Hex(TEST_DEVICE)}, 'test')`;
  const c = await signIn(u.email);
  const st = await c.rpc("start_device_check", { p_device_id: TEST_DEVICE });
  assertEq(st.data?.status, "verified", `device check for ${name}`);
  return { ...u, c };
}
type Member = Awaited<ReturnType<typeof member>>;

/** Emails an `export_data` code to the user and verifies it in this client's session. */
async function confirm(m: { email: string; c: SupabaseClient }) {
  const sent = await deviceCode(m.c, { action: "send", purpose: "sensitive_action", sensitive_action: "export_data" });
  assertEq(sent.status, 200, `send code: ${JSON.stringify(sent.body)}`);
  const mail = await waitMail(m.email, { subject: /confirmation code/i });
  const ok = await deviceCode(m.c, { action: "verify", purpose: "sensitive_action", code: codeOf(mail) });
  assertEq(ok.status, 200, `verify code: ${JSON.stringify(ok.body)}`);
}

async function must<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p;
  assert(!error, `${what}: ${error?.message}`);
  return data;
}

// --- Scenario: U is the exporter; V shares U's bubble; W shares it too and gets blocked by U;
// X is in another bubble only. ---------------------------------------------------------------
let U: Member, V: Member, W: Member, X: Member;
let bubbleId = "", otherBubbleId = "", chatPhoto = "";
const S = {
  uMsg: `u-message-${tag}`, uGone: `u-deleted-${tag}`, vMsg: `v-private-${tag}`, wMsg: `w-private-${tag}`,
  xMsg: `x-other-bubble-${tag}`, uFood: `u-food-${tag}`, uItem: `u-item-${tag}`, uLink: `https://example.com/u-${tag}`,
  vEvent: `v-event-${tag}`, wEvent: `w-event-${tag}`, uEvent: `u-event-${tag}`, uReport: `u-report-${tag}`,
  vReport: `v-report-about-u-${tag}`, pushToken: `apnsTOKEN${tag}SECRETPART9z7Q`,
};

Deno.test({ name: "setup: two bubbles with content from four users", ...opts, fn: async () => {
  [U, V, W, X] = await Promise.all([member(`Ula ${tag}`), member(`Vic ${tag}`), member(`Wes ${tag}`), member(`Xan ${tag}`)]);
  const b = await must(U.c.rpc("create_bubble", { p_name: `Export ${tag}`.slice(0, 60) }), "create_bubble");
  bubbleId = b.id;
  for (const m of [V, W]) {
    const req = await must(m.c.rpc("request_to_join", { p_invite_code: b.invite_code }), "request_to_join");
    for (const voter of [U, V, W]) if (voter !== m) await voter.c.rpc("approve_join_request", { p_request_id: req.id });
  }
  const members = await sql`select count(*)::int as n from public.bubble_members where bubble_id = ${bubbleId} and approved`;
  assertEq(members[0].n, 3, "three members");
  const ob = await must(X.c.rpc("create_bubble", { p_name: `Other ${tag}`.slice(0, 60) }), "create other bubble");
  otherBubbleId = ob.id;

  // U's content.
  await must(U.c.from("chat_messages").insert({ bubble_id: bubbleId, sender_id: U.id, content: S.uMsg }), "u msg");
  const gone = await must(U.c.from("chat_messages").insert({ bubble_id: bubbleId, sender_id: U.id, content: S.uGone }).select("id").single(), "u msg 2");
  await must(U.c.rpc("delete_chat_message", { p_message_id: gone.id }), "delete own message");
  chatPhoto = `${U.id}/${crypto.randomUUID()}.jpg`;
  await must(U.c.storage.from("chat.images").upload(chatPhoto, JPEG, { contentType: "image/jpeg" }), "upload chat photo");
  await must(U.c.from("chat_messages").insert({ bubble_id: bubbleId, sender_id: U.id, content: "", image_path: chatPhoto }), "photo msg");
  await must(U.c.from("events").insert({ bubble_id: bubbleId, creator_id: U.id, title: S.uEvent, datetime: new Date(Date.now() + 864e5).toISOString() }), "u event");
  await must(U.c.from("food_posts").insert({ bubble_id: bubbleId, user_id: U.id, image: "https://example.com/f.jpg", description: S.uFood }), "food");
  await must(U.c.from("market_items").insert({ bubble_id: bubbleId, owner_id: U.id, image: "https://example.com/m.jpg", title: S.uItem }), "item");
  await must(U.c.from("shared_links").insert({ bubble_id: bubbleId, user_id: U.id, url: S.uLink, title: "link", tags: ["t"] }), "link");
  await must(U.c.from("bubble_mutes").insert({ user_id: U.id, bubble_id: bubbleId }), "mute");

  // Other people's content in the same bubble and in the other bubble.
  const vm = await must(V.c.from("chat_messages").insert({ bubble_id: bubbleId, sender_id: V.id, content: S.vMsg }).select("id").single(), "v msg");
  await must(W.c.from("chat_messages").insert({ bubble_id: bubbleId, sender_id: W.id, content: S.wMsg }), "w msg");
  await must(X.c.from("chat_messages").insert({ bubble_id: otherBubbleId, sender_id: X.id, content: S.xMsg }), "x msg");
  const ve = await must(V.c.from("events").insert({ bubble_id: bubbleId, creator_id: V.id, title: S.vEvent, datetime: new Date(Date.now() + 2 * 864e5).toISOString() }).select("id").single(), "v event");
  const we = await must(W.c.from("events").insert({ bubble_id: bubbleId, creator_id: W.id, title: S.wEvent, datetime: new Date(Date.now() + 3 * 864e5).toISOString() }).select("id").single(), "w event");
  await must(U.c.rpc("toggle_rsvp", { p_event_id: ve.id }), "rsvp v event");
  await must(U.c.rpc("toggle_rsvp", { p_event_id: we.id }), "rsvp w event");
  await must(V.c.rpc("toggle_rsvp", { p_event_id: ve.id }), "v rsvps own event");

  // U reacts, reports V's message, blocks W. V reports U and X blocks U (neither may show up).
  await must(U.c.rpc("toggle_reaction", { p_target_type: "chat_message", p_target_id: vm.id, p_reaction: "love" }), "reaction");
  await must(U.c.rpc("report_content", { p_target_type: "chat_message", p_target_id: vm.id, p_reason: "spam", p_details: S.uReport }), "u report");
  await must(U.c.from("blocks").insert({ blocker_id: U.id, blocked_id: W.id }), "u blocks w");
  await must(V.c.rpc("report_content", { p_target_type: "user", p_target_id: U.id, p_reason: "harassment", p_details: S.vReport }), "v reports u");
  await must(X.c.from("blocks").insert({ blocker_id: X.id, blocked_id: U.id }), "x blocks u");

  // A push token for U (service role; the device hash is optional).
  await sql`insert into public.push_tokens (user_id, platform, token, apns_env, locale) values (${U.id}, 'ios', ${S.pushToken}, 'sandbox', 'en')`;
}});

Deno.test({ name: "export needs a sensitive_action code verified in this session", ...opts, fn: async () => {
  const r1 = await U.c.rpc("export_my_data");
  assert(r1.error?.message.includes("reauthentication required"), `rpc without code: ${r1.error?.message}`);
  const h1 = await callExport(U.c);
  assertEq(h1.status, 403, "handler without code");
  assertEq((await h1.json()).error, "reauthentication_required", "error code");

  // A code verified in ANOTHER session of the same user doesn't count.
  const other = await signIn(U.email);
  await confirm({ email: U.email, c: other });
  const r2 = await U.c.rpc("export_my_data");
  assert(r2.error?.message.includes("reauthentication required"), `code from another session: ${r2.error?.message}`);
  await other.auth.signOut({ scope: "local" });

  // Anonymous callers can't run it at all.
  const anon = await client().rpc("export_my_data");
  assert(anon.error, "anon refused");
  const h2 = await handler(new Request("http://local/x", { method: "POST" }));
  assertEq(h2.status, 401, "no JWT");
  const h3 = await handler(new Request("http://local/x", { method: "POST", headers: { Authorization: "Bearer not-a-jwt" } }));
  assertEq(h3.status, 401, "bad JWT");
}});

let file: Record<string, any> = {};
let fileText = "";

Deno.test({ name: "export contains the user's own rows and photo links, nobody else's private data", ...opts, fn: async () => {
  await confirm(U);
  const res = await callExport(U.c);
  assertEq(res.status, 200, `export status ${res.status}`);
  assertEq(res.headers.get("content-type"), "application/json; charset=utf-8", "content type");
  assertEq(res.headers.get("content-disposition"), `attachment; filename="${fileName(new Date())}"`, "file name");
  fileText = await res.text();
  file = JSON.parse(fileText);

  assertEq(Object.keys(file).slice(0, 6), ["format", "version", "generated_at", "user_id", "about", "profile"], "readable key order");
  assertEq(file.user_id, U.id, "user id");
  assertEq(file.profile.name, `Ula ${tag}`, "profile");
  assertEq(file.account.email, U.email, "auth email");
  assertEq(file.account.sign_in_providers, ["email"], "providers");
  assert(file.sign_in_identities.length === 1 && file.sign_in_identities[0].provider === "email", "identities");
  assert(file.sessions.some((s: any) => s.this_session), "current session marked");
  assert(file.security_codes.some((c: any) => c.purpose === "sensitive_action" && c.used_at), "code log");

  // Memberships: only the bubble U is in; bubble name is there.
  assertEq(file.bubble_memberships.map((m: any) => [m.bubble_id, m.bubble_name, m.role]), [[bubbleId, `Export ${tag}`, "owner"]], "memberships");

  // Chat: own messages only; the deleted one is metadata only; the photo has a working signed link.
  const msgs = file.chat_messages as any[];
  assertEq(msgs.length, 3, "three own messages");
  assert(msgs.some((m) => m.content === S.uMsg), "own text");
  const deleted = msgs.find((m) => m.deleted_at);
  assert(deleted && deleted.content === null && deleted.photo_path === null, "deleted message: metadata only");
  const photoMsg = msgs.find((m) => m.photo_path === chatPhoto);
  assert(photoMsg?.photo_url?.includes("/storage/v1/object/sign/chat.images/"), "signed chat photo link");
  const dl = await fetch(photoMsg.photo_url);
  assertEq(dl.status, 200, "signed link downloads");
  assertEq(new Uint8Array(await dl.arrayBuffer()).length, JPEG.length, "photo bytes");
  const f = (file.files as any[]).find((x) => x.path === chatPhoto);
  assert(f && f.bucket === "chat.images" && f.url && f.url_expires_at, "file entry with signed url");
  const days = (Date.parse(f.url_expires_at) - Date.now()) / 864e5;
  assert(days > 6.9 && days <= 7.01, `link valid 7 days (${days})`);

  // Own content in every section.
  assertEq(file.events.map((e: any) => e.title), [S.uEvent], "own events only");
  assertEq(file.food_posts.map((x: any) => x.description), [S.uFood], "food");
  assertEq(file.market_items.map((x: any) => x.title), [S.uItem], "items");
  assertEq(file.shared_links.map((x: any) => x.url), [S.uLink], "links");
  assertEq(file.reactions.map((x: any) => [x.reaction, x.target_type]), [["love", "chat_message"]], "reactions");
  assertEq(file.reports_filed.map((x: any) => x.details), [S.uReport], "reports filed");
  assert(!("handled_note" in file.reports_filed[0]), "no moderator note");
  assertEq(file.blocks.map((x: any) => x.blocked_user_id), [W.id], "blocks made by U only");
  assertEq(file.muted_bubbles.map((x: any) => x.bubble_id), [bubbleId], "mutes");
  assert(file.notification_preferences && "enabled" in file.notification_preferences, "prefs");
  assertEq(file.consent.age_confirmed_at !== undefined, true, "consent section");

  // RSVPs: V's event keeps its title; W's (blocked) doesn't. Nobody else's RSVPs are listed.
  const rsvps = file.rsvps as any[];
  assertEq(rsvps.length, 2, "two rsvps");
  assertEq(rsvps.find((r) => r.title === S.vEvent)?.bubble_id, bubbleId, "visible event title");
  assert(rsvps.some((r) => r.title === null), "blocked author's event title hidden");

  // Push token redacted.
  assertEq(file.push_tokens.map((p: any) => p.token_hint), ["…9z7Q"], "token hint");

  // Nothing private of anyone else, nothing from the other bubble, no reports about U, no secrets.
  for (const s of [S.vMsg, S.wMsg, S.xMsg, S.wEvent, S.vReport, S.uGone, S.pushToken, otherBubbleId, V.email, W.email, X.email]) {
    assert(!fileText.includes(s), `export must not contain ${s}`);
  }
  assert(!/encrypted_password|refresh_token|code_hash|\$2[aby]\$/.test(fileText), "no password hash / token fields");
  assert(!fileText.includes(await sha256Hex(TEST_DEVICE)), "no full device hash");
  assert(Array.isArray(file.not_included) && file.not_included.length >= 4, "not_included explains exclusions");
}});

Deno.test({ name: "rate limit: one export per hour", ...opts, fn: async () => {
  // A fresh code doesn't lift the limit.
  await confirm(U);
  const r = await U.c.rpc("export_my_data");
  assert(r.error?.message.includes("export rate limited"), `second export: ${r.error?.message}`);
  const secs = Number(r.error?.details);
  assert(secs > 3500 && secs <= 3600, `retry seconds in DETAIL (${r.error?.details})`);
  const h = await callExport(U.c);
  assertEq(h.status, 429, "handler 429");
  const body = await h.json();
  assertEq(body.error, "export_rate_limited", "error code");
  assert(body.retry_after > 3500 && body.retry_after <= 3600, "retry_after");
  assertEq(h.headers.get("retry-after"), String(body.retry_after), "Retry-After header");
  const rows = await sql`select count(*)::int as n from public.data_export_requests where user_id = ${U.id}`;
  assertEq(rows[0].n, 1, "refused exports are not logged");

  // Other users are not affected by U's limit (and V's export doesn't contain U's messages).
  await confirm(V);
  const vr = await callExport(V.c);
  assertEq(vr.status, 200, "V can export");
  const vText = await vr.text();
  assert(!vText.includes(S.uMsg) && vText.includes(S.vMsg), "V's export has V's message, not U's");
  const vFile = JSON.parse(vText);
  assertEq(vFile.reports_filed.map((r: any) => r.details), [S.vReport], "V's own report only");
  assert(!vText.includes(S.uReport), "the report U filed about V is not in V's export");
  assertEq(vFile.blocks, [], "V blocked nobody");
}});

Deno.test({ name: "clients can't read or write the export log", ...opts, fn: async () => {
  const { data, error } = await U.c.from("data_export_requests").select("*");
  assert(error || (data ?? []).length === 0, "no select");
  const ins = await U.c.from("data_export_requests").insert({ user_id: U.id });
  assert(ins.error, "no insert");
}});

// --- Handler unit tests (fake deps) -------------------------------------------------------------
function fakeDeps(over: Partial<Deps> = {}): Deps {
  return {
    getUser: async (jwt) => (jwt === "good" ? { id: "u1" } : null),
    exportData: async () => ({
      data: {
        user_id: "u1", files: [
          { bucket: "chat.images", path: "u1/a.jpg" }, { bucket: "avatars", path: "u1/b.jpg" },
          { bucket: "chat.images", path: "u2/evil.jpg" }, { bucket: "bubble.images", path: "u1/c.jpg" },
          { bucket: "chat.images", path: "u1/../u2/x.jpg" },
        ],
        chat_messages: [{ id: "m1", photo_path: "u1/a.jpg" }, { id: "m2", photo_path: null }, { id: "m3", photo_path: "u2/evil.jpg" }],
        profile: {}, format: "boolaa-data-export",
      },
      error: null,
    }),
    signUrls: async (_b, paths) => new Map(paths.map((p) => [p, `https://signed/${p}`])),
    publicUrl: (b, p) => `https://public/${b}/${p}`,
    now: () => new Date("2026-11-23T10:00:00Z"),
    ...over,
  };
}
const post = (h: ReturnType<typeof createHandler>, jwt?: string) =>
  h(new Request("http://x/", { method: "POST", headers: jwt ? { Authorization: `Bearer ${jwt}` } : {} }));

Deno.test("handler: signs only the user's own private photos and orders keys", async () => {
  const signed: string[] = [];
  const h = createHandler(fakeDeps({
    signUrls: async (_b, paths) => {
      signed.push(...paths);
      return new Map(paths.map((p) => [p, `https://signed/${p}`]));
    },
  }));
  const res = await post(h, "good");
  assertEq(res.status, 200, "ok");
  assertEq(res.headers.get("content-disposition"), 'attachment; filename="boolaa-data-2026-11-23.json"', "filename");
  const doc = await res.json();
  assertEq(signed, ["u1/a.jpg"], "only own chat photo signed");
  assertEq(doc.files.map((f: any) => f.url), ["https://signed/u1/a.jpg", "https://public/avatars/u1/b.jpg"], "files filtered + linked");
  assertEq(doc.files[0].url_expires_at, "2026-11-30T10:00:00.000Z", "7-day expiry");
  assertEq(doc.chat_messages.map((m: any) => m.photo_url ?? null), ["https://signed/u1/a.jpg", null, null], "message links");
  assertEq(Object.keys(doc).slice(0, 3), ["format", "user_id", "about"], "ordered keys");
});

Deno.test("handler: error mapping", async () => {
  assertEq((await post(createHandler(fakeDeps()))).status, 401, "no jwt");
  assertEq((await post(createHandler(fakeDeps()), "bad")).status, 401, "invalid jwt");
  const cases: [string, string | null, number, string][] = [
    ["reauthentication required", null, 403, "reauthentication_required"],
    ["session not verified", null, 403, "session_not_verified"],
    ["export rate limited", "1234", 429, "export_rate_limited"],
    ["JWT expired", null, 401, "unauthorized"],
    ["boom", null, 500, "server_error"],
  ];
  for (const [message, details, status, code] of cases) {
    const h = createHandler(fakeDeps({ exportData: async () => ({ data: null, error: { message, details } }) }));
    const r = await post(h, "good");
    assertEq(r.status, status, message);
    const b = await r.json();
    assertEq(b.error, code, `${message} code`);
    if (status === 429) assertEq([b.retry_after, r.headers.get("retry-after")], [1234, "1234"], "retry after");
  }
  const mismatch = createHandler(fakeDeps({ exportData: async () => ({ data: { user_id: "someone-else" }, error: null }) }));
  assertEq((await post(mismatch, "good")).status, 500, "user mismatch refused");
  assertEq((await createHandler(fakeDeps())(new Request("http://x/", { method: "GET" }))).status, 405, "GET refused");
  assertEq(mapRpcError({ message: "export rate limited", details: "nope" }).headers.get("retry-after"), "3600", "default retry");
  assertEq(Object.keys(orderKeys({ zzz: 1, files: [], format: "x" })), ["format", "files", "zzz"], "unknown keys last");
});

Deno.test({ name: "cleanup", ...opts, fn: async () => {
  if (U) await admin.storage.from("chat.images").remove([chatPhoto]).catch(() => {});
  await cleanupUsers();
  await sql.end();
}});
