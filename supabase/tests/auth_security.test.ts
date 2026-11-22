// End-to-end tests for custom emails, device verification, OTP password reset,
// sensitive-action re-confirmation, age confirmation and moderation alerts.
// Runs against the LOCAL stack (supabase start, edge runtime, Mailpit):
//
//   deno test -A supabase/tests/auth_security.test.ts
//
// Flags in app_settings are switched per test and always restored to OFF.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  admin, API, assert, assertEq, claims, cleanupUsers, client, codeOf, countMail, createUser, deviceCode, MAILPIT,
  PASSWORD, setFlags, sha256Hex, signIn, sleep, sql, TEST_DEVICE, token, trackUser, uniqueEmail, waitMail,
} from "./helpers.ts";

const FLATMATES = "aaaaaaaa-0000-0000-0000-000000000001";
const ALICE = "11111111-1111-1111-1111-111111111111";
const opts = { sanitizeOps: false, sanitizeResources: false };

async function withFlags(f: { device?: boolean; age?: boolean }, fn: () => Promise<void>) {
  await setFlags(f);
  try {
    await fn();
  } finally {
    await setFlags({ device: false, age: false });
    await cleanupUsers();
  }
}

async function verifyDeviceByEmail(c: SupabaseClient, email: string, device: string, label = "Test device") {
  const s = await deviceCode(c, { action: "send", purpose: "device", device_id: device, label });
  assertEq(s.status, 200, `device code send ${JSON.stringify(s.body)}`);
  const m = await waitMail(email, { subject: /sign-in code|autentificare|connexion|iniciar|accesso/i });
  const v = await deviceCode(c, { action: "verify", purpose: "device", device_id: device, code: codeOf(m), label });
  assertEq(v.status, 200, `device code verify ${JSON.stringify(v.body)}`);
  return m;
}

const rowsOf = async (c: SupabaseClient, table: string) => {
  const { data, error } = await c.from(table).select("*");
  if (error) throw new Error(`${table}: ${error.message}`);
  return data!.length;
};

// ---------------------------------------------------------------------------
Deno.test("session_id is stable across refresh; password sessions carry amr=password", opts, async () => {
  const c = await signIn("bob@boolaa.test");
  const a = claims(await token(c));
  const { data } = await c.auth.refreshSession();
  const b = claims(data.session!.access_token);
  assertEq(b.session_id, a.session_id, "session_id after refresh");
  assertEq(a.amr.map((x: { method: string }) => x.method), ["password"], "amr");
  assertEq(b.amr.map((x: { method: string }) => x.method), ["password"], "amr after refresh");
});

Deno.test("signup confirmation: localized ro and fr emails arrive and the code confirms", opts, async () => {
  for (const [locale, subject] of [["ro", "Confirmă-ți emailul pentru Boolaa"], ["fr", "Confirme ton e-mail pour Boolaa"]]) {
    const u = await createUser({ locale, confirmed: false });
    const { error } = await client().auth.resend({ type: "signup", email: u.email });
    assert(!error, `resend: ${error?.message}`);
    const m = await waitMail(u.email);
    assertEq(m.subject, subject, `${locale} subject`);
    assertEq(m.from, "Boolaa <noreply@boolaa.ro>", "sender");
    assert(m.html.includes("https://boolaa.ro/privacy"), "privacy link in footer");
    assert(m.html.includes(`lang="${locale}"`), "html lang");
    assert(/\/auth\/v1\/verify\?token=/.test(m.html), "confirmation link present");
    assert(!/[şţ]/.test(m.text), "no cedilla diacritics");
    const c = client();
    const r = await c.auth.verifyOtp({ email: u.email, token: codeOf(m), type: "signup" });
    assert(!r.error && r.data.session, `confirm: ${r.error?.message}`);
    assertEq(claims(r.data.session!.access_token).amr[0].method, "otp", "amr of a confirmation session");
    const { data } = await admin.auth.admin.getUserById(u.id);
    assert(data.user?.email_confirmed_at, "email confirmed");
  }
  // The link in the email works too (GET /verify -> redirect with tokens).
  const u = await createUser({ locale: "it", confirmed: false });
  await client().auth.resend({ type: "signup", email: u.email });
  const m = await waitMail(u.email);
  assertEq(m.subject, "Conferma la tua email per Boolaa", "it subject");
  const link = m.text.match(/(http:\/\/127\.0\.0\.1:55321\/auth\/v1\/verify\?\S+)/)![1];
  const res = await fetch(link, { redirect: "manual" });
  assert((res.headers.get("location") ?? "").includes("access_token="), "link redirects with a session");
  await cleanupUsers();
});

Deno.test("invite, magic link and email change emails are localized; email change mails both addresses", opts, async () => {
  const inv = uniqueEmail("inv");
  const r = await admin.auth.admin.inviteUserByEmail(inv, { data: { locale: "it" } });
  assert(!r.error, `invite: ${r.error?.message}`);
  trackUser(r.data.user!.id);
  assertEq((await waitMail(inv)).subject, "Sei stato invitato su Boolaa", "invite subject");

  const u = await createUser({ locale: "es" });
  await client().auth.signInWithOtp({ email: u.email, options: { shouldCreateUser: false } });
  const ml = await waitMail(u.email);
  assertEq(ml.subject, "Tu código para iniciar sesión en Boolaa", "magic link subject");
  const s = await client().auth.verifyOtp({ email: u.email, token: codeOf(ml), type: "email" });
  assert(!s.error, "magic link code signs in");

  const v = await createUser({ locale: "fr" });
  const c = await signIn(v.email);
  const newEmail = `new-${v.email}`;
  const up = await c.auth.updateUser({ email: newEmail });
  assert(!up.error, `email change: ${up.error?.message}`);
  const toOld = await waitMail(v.email, { subject: /nouvelle adresse/ });
  const toNew = await waitMail(newEmail, { subject: /nouvelle adresse/ });
  assert(toOld.text.includes(v.email) && toOld.text.includes(newEmail), "old-address mail names both addresses");
  assert(toNew.text.includes(newEmail), "new-address mail");
  assert(codeOf(toOld) !== codeOf(toNew), "two different codes");
  await cleanupUsers();
});

Deno.test("unknown device: code_required, no data, no realtime; code by email unlocks; same device passes later", opts, () =>
  withFlags({ device: true }, async () => {
    const device = `alice-new-${crypto.randomUUID()}`;
    const alice = await signIn("alice@boolaa.test");
    const bob = await signIn("bob@boolaa.test");
    assertEq((await bob.rpc("start_device_check", { p_device_id: TEST_DEVICE, p_label: "seed" })).data.status, "verified", "bob via seeded device");

    const st = await alice.rpc("start_device_check", { p_device_id: device, p_label: "Alice laptop" });
    assertEq(st.data, { status: "code_required", needs_age_confirmation: false }, "start_device_check");
    for (const t of ["chat_messages", "events", "food_posts", "market_items", "shared_links", "users", "bubbles", "bubble_members", "join_requests", "blocks", "reports"]) {
      assertEq(await rowsOf(alice, t), 0, `unverified ${t} rows`);
    }
    const rpc = await alice.rpc("create_bubble", { p_name: "Nope" });
    assertEq(rpc.error?.message, "session not verified", "create_bubble refused");
    const ins = await alice.from("chat_messages").insert({ bubble_id: FLATMATES, sender_id: ALICE, content: "x" });
    assert(ins.error, "insert refused while unverified");

    // Realtime: subscribe as the unverified session.
    const got: string[] = [];
    await alice.realtime.setAuth(await token(alice));
    const ch = alice.channel(`rt-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `bubble_id=eq.${FLATMATES}` },
        (p) => got.push((p.new as { content: string }).content));
    await new Promise<void>((res, rej) => ch.subscribe((s) => s === "SUBSCRIBED" ? res() : s === "CHANNEL_ERROR" ? rej(new Error(s)) : null));
    await sleep(1500);
    const hidden = `hidden-${Date.now()}`;
    assert(!(await bob.from("chat_messages").insert({ bubble_id: FLATMATES, sender_id: "22222222-2222-2222-2222-222222222222", content: hidden })).error, "bob insert");
    await sleep(2500);
    assertEq(got.includes(hidden), false, "unverified subscriber received nothing");

    const m = await verifyDeviceByEmail(alice, "alice@boolaa.test", device, "Alice laptop");
    assert(m.text.includes("Alice laptop"), "device label in email");
    assert(await rowsOf(alice, "chat_messages") > 0, "chat visible after verification");
    assert(await rowsOf(alice, "users") > 0, "users visible after verification");

    const shown = `shown-${Date.now()}`;
    await bob.from("chat_messages").insert({ bubble_id: FLATMATES, sender_id: "22222222-2222-2222-2222-222222222222", content: shown });
    for (let i = 0; i < 20 && !got.includes(shown); i++) await sleep(250);
    assertEq(got.includes(shown), true, "same subscription receives once verified");
    assertEq(got.includes(hidden), false, "earlier hidden message was never delivered");
    await alice.removeAllChannels();

    // Later sign-in on the same device: straight through, no email.
    const again = await signIn("alice@boolaa.test");
    assertEq((await again.rpc("start_device_check", { p_device_id: device })).data.status, "verified", "trusted device passes");
    assert(await rowsOf(again, "chat_messages") > 0, "data visible");

    const devs = await again.rpc("list_my_devices");
    const hash = await sha256Hex(device);
    assert(devs.data.some((d: { device_hash: string; label: string }) => d.device_hash === hash && d.label === "Alice laptop"), "new device listed");
    assert(devs.data.some((d: { device_hash: string }) => d.device_hash === "" ) === false, "hashes only");

    await sql`delete from public.chat_messages where content in (${hidden}, ${shown})`;
    await sql`delete from public.trusted_devices where user_id = ${ALICE} and label is distinct from 'Seeded test device'`;
  }));

Deno.test("wrong code x5 locks; expired code rejected; 5 sends per hour", opts, () =>
  withFlags({ device: true }, async () => {
    const u = await createUser({ locale: "ro" });
    const c = await signIn(u.email);
    const device = `dev-${crypto.randomUUID()}`;
    assertEq((await deviceCode(c, { action: "send", purpose: "device", device_id: device })).status, 200, "send 1");
    const m = await waitMail(u.email);
    assertEq(m.subject, "Codul tău de autentificare Boolaa", "ro device subject");
    const good = codeOf(m);
    const bad = good === "000000" ? "111111" : "000000";
    for (let i = 4; i >= 1; i--) {
      const r = await deviceCode(c, { action: "verify", purpose: "device", device_id: device, code: bad });
      assertEq([r.status, r.body.error, r.body.attempts_left], [400, "invalid_code", i], `wrong attempt, ${i} left`);
    }
    let r = await deviceCode(c, { action: "verify", purpose: "device", device_id: device, code: bad });
    assertEq([r.status, r.body.error], [423, "too_many_attempts"], "5th wrong attempt locks");
    r = await deviceCode(c, { action: "verify", purpose: "device", device_id: device, code: good });
    assertEq([r.status, r.body.error], [423, "too_many_attempts"], "correct code after lock");
    const stored = await sql`select code_hash from public.email_challenges where user_id = ${u.id}`;
    assert(stored.every((x) => x.code_hash !== good && /^[0-9a-f]{64}$/.test(x.code_hash)), "only HMAC stored");

    // Expired.
    assertEq((await deviceCode(c, { action: "send", purpose: "device", device_id: device })).status, 200, "send 2");
    const code2 = codeOf(await waitMail(u.email));
    await sql`update public.email_challenges set expires_at = now() - interval '1 second'
               where user_id = ${u.id} and consumed_at is null and created_at = (select max(created_at) from public.email_challenges where user_id = ${u.id})`;
    r = await deviceCode(c, { action: "verify", purpose: "device", device_id: device, code: code2 });
    assertEq([r.status, r.body.error], [410, "code_expired"], "expired code");

    // A code for another device does not verify this one.
    assertEq((await deviceCode(c, { action: "send", purpose: "device", device_id: device })).status, 200, "send 3");
    const code3 = codeOf(await waitMail(u.email));
    r = await deviceCode(c, { action: "verify", purpose: "device", device_id: `other-${device}`, code: code3 });
    assertEq([r.status, r.body.error], [404, "no_active_code"], "code bound to its device");

    assertEq((await deviceCode(c, { action: "send", purpose: "device", device_id: device })).status, 200, "send 4");
    assertEq((await deviceCode(c, { action: "send", purpose: "device", device_id: device })).status, 200, "send 5");
    r = await deviceCode(c, { action: "send", purpose: "device", device_id: device });
    assertEq([r.status, r.body.error], [429, "rate_limited"], "6th send in an hour");

    // Bad input / no auth.
    r = await deviceCode(c, { action: "verify", purpose: "device", device_id: device, code: "12ab56" });
    assertEq(r.status, 400, "malformed code");
    const anon = await fetch(`${API}/functions/v1/device-code`, { method: "POST", body: "{}" });
    assertEq(anon.status, 401, "no JWT");
    await anon.body?.cancel();
  }));

Deno.test("password reset by code: email, verifyOtp, new password; recovery session counts as verified", opts, () =>
  withFlags({ device: true }, async () => {
    const u = await createUser({ locale: "es" });
    const { error } = await client().auth.resetPasswordForEmail(u.email);
    assert(!error, `reset: ${error?.message}`);
    const m = await waitMail(u.email);
    assertEq(m.subject, "Tu código para restablecer la contraseña de Boolaa", "es recovery subject");
    assert(/font-size:38px[^>]*>\d{6}</.test(m.html), "code shown prominently");
    assert(m.html.includes("type=recovery"), "link kept as secondary option");
    const c = client();
    const v = await c.auth.verifyOtp({ email: u.email, token: codeOf(m), type: "recovery" });
    assert(!v.error && v.data.session, `verifyOtp: ${v.error?.message}`);
    assertEq((await c.rpc("is_session_verified")).data, true, "recovery session is verified");
    const st = await c.rpc("start_device_check", { p_device_id: `reset-${crypto.randomUUID()}` });
    assertEq(st.data.status, "verified", "and trusts the device it ran on");
    const up = await c.auth.updateUser({ password: "brand-new-pass-1" });
    assert(!up.error, `new password: ${up.error?.message}`);
    assert(!(await client().auth.signInWithPassword({ email: u.email, password: "brand-new-pass-1" })).error, "new password works");
    assert((await client().auth.signInWithPassword({ email: u.email, password: PASSWORD })).error, "old password fails");
  }));

Deno.test("reauthenticate() code then updateUser({ password, nonce })", opts, async () => {
  const u = await createUser({ locale: "it" });
  const c = await signIn(u.email);
  // GoTrue only demands the nonce from sessions older than 24 h (see docs). Age this one.
  await sql`update auth.sessions set created_at = now() - interval '25 hours' where id = ${claims(await token(c)).session_id}`;
  const none = await c.auth.updateUser({ password: "another-pass-2" });
  assertEq(none.error?.code, "reauthentication_needed", "old session without nonce refused");
  const r = await c.auth.reauthenticate();
  assert(!r.error, `reauthenticate: ${r.error?.message}`);
  const m = await waitMail(u.email);
  assertEq(m.subject, "Il tuo codice di conferma Boolaa", "it reauth subject");
  const wrong = await c.auth.updateUser({ password: "another-pass-2", nonce: codeOf(m) === "000000" ? "111111" : "000000" });
  assert(wrong.error, "wrong nonce refused");
  const ok = await c.auth.updateUser({ password: "another-pass-2", nonce: codeOf(m) });
  assert(!ok.error, `with nonce: ${ok.error?.message}`);
  assert(!(await client().auth.signInWithPassword({ email: u.email, password: "another-pass-2" })).error, "new password works");
  // Documented GoTrue behaviour: a session younger than 24 h may change the password
  // without (or with any) nonce, even with secure_password_change on.
  const fresh = await signIn(u.email, "another-pass-2");
  const noNonce = await fresh.auth.updateUser({ password: "third-pass-3" });
  assert(!noNonce.error, "GoTrue: recent session may skip the nonce (see docs)");
  await cleanupUsers();
});

Deno.test("delete_my_account needs a fresh sensitive_action code from the same session", opts, () =>
  withFlags({ device: true }, async () => {
    const u = await createUser({ locale: "fr" });
    const device = `del-${crypto.randomUUID()}`;
    const a = await signIn(u.email);
    await verifyDeviceByEmail(a, u.email, device);
    let d = await a.rpc("delete_my_account");
    assertEq(d.error?.message, "reauthentication required", "refused without code");

    let s = await deviceCode(a, { action: "send", purpose: "sensitive_action", sensitive_action: "delete_account" });
    assertEq(s.status, 200, "send sensitive code");
    const m = await waitMail(u.email, { subject: /confirmation/ });
    assert(m.text.includes("la suppression de ton compte"), "action named in email");

    // A second session of the same user can't use session A's proof.
    const b = await signIn(u.email);
    assertEq((await b.rpc("start_device_check", { p_device_id: device })).data.status, "verified", "b trusted device");
    const wrongSession = await deviceCode(b, { action: "verify", purpose: "sensitive_action", code: codeOf(m) });
    assertEq(wrongSession.body.error, "no_active_code", "code bound to the session that asked for it");

    const v = await deviceCode(a, { action: "verify", purpose: "sensitive_action", code: codeOf(m) });
    assertEq(v.status, 200, `verify sensitive ${JSON.stringify(v.body)}`);
    d = await b.rpc("delete_my_account");
    assertEq(d.error?.message, "reauthentication required", "other session still refused");

    // Too old (> 10 min) does not count.
    await sql`update public.email_challenges set consumed_at = now() - interval '11 minutes' where user_id = ${u.id} and purpose = 'sensitive_action'`;
    d = await a.rpc("delete_my_account");
    assertEq(d.error?.message, "reauthentication required", "stale proof refused");
    await sql`update public.email_challenges set consumed_at = now() where user_id = ${u.id} and purpose = 'sensitive_action'`;

    d = await a.rpc("delete_my_account");
    assert(!d.error, `delete: ${d.error?.message}`);
    assertEq((await admin.auth.admin.getUserById(u.id)).data.user, null, "user deleted");

    // An unverified session can't even ask for a sensitive code.
    const w = await createUser();
    const wc = await signIn(w.email);
    s = await deviceCode(wc, { action: "send", purpose: "sensitive_action" });
    assertEq([s.status, s.body.error], [403, "session_not_verified"], "sensitive code needs a verified session");
  }));

Deno.test("revoking a device forces re-verification on it", opts, () =>
  withFlags({ device: true }, async () => {
    const u = await createUser();
    const d1 = `one-${crypto.randomUUID()}`, d2 = `two-${crypto.randomUUID()}`;
    const a = await signIn(u.email);
    await verifyDeviceByEmail(a, u.email, d1, "Phone");
    const b = await signIn(u.email);
    await verifyDeviceByEmail(b, u.email, d2, "Laptop");
    assertEq((await b.rpc("is_session_verified")).data, true, "b verified");

    const list = await a.rpc("list_my_devices");
    assertEq(list.data.map((x: { label: string }) => x.label).sort(), ["Laptop", "Phone"], "two devices");
    const rv = await a.rpc("revoke_device", { p_device_hash: await sha256Hex(d2) });
    assertEq(rv.data, true, "revoked");

    assertEq((await b.rpc("is_session_verified")).data, false, "b no longer verified");
    assertEq(await rowsOf(b, "users"), 0, "b sees nothing");
    assertEq((await b.rpc("start_device_check", { p_device_id: d2 })).data.status, "code_required", "b needs a code again");
    assertEq((await a.rpc("is_session_verified")).data, true, "revoking session stays verified");

    // Signing out removes the verified session row (cascade from auth.sessions).
    const sid = claims(await token(a)).session_id;
    await a.auth.signOut();
    assertEq((await sql`select count(*)::int n from public.verified_sessions where session_id = ${sid}`)[0].n, 0, "row gone on sign-out");
  }));

Deno.test("trusted devices are capped at 10 per user", opts, () =>
  withFlags({ device: true }, async () => {
    const u = await createUser();
    for (let i = 0; i < 12; i++) {
      await sql`select public.trust_device(${u.id}::uuid, ${await sha256Hex("d" + i)}, ${"d" + i})`;
      await sleep(5);
    }
    const rows = await sql`select label from public.trusted_devices where user_id = ${u.id} order by last_seen_at`;
    assertEq(rows.length, 10, "10 kept");
    assertEq(rows[0].label, "d2", "two oldest removed");
  }));

Deno.test("enforcement OFF: everything behaves as before", opts, () =>
  withFlags({ device: false }, async () => {
    const alice = await signIn("alice@boolaa.test"); // no device check at all
    for (const t of ["chat_messages", "events", "food_posts", "market_items", "shared_links", "users", "bubbles", "bubble_members", "join_requests"]) {
      assert(await rowsOf(alice, t) > 0, `alice reads ${t}`);
    }
    const carol = await signIn("carol@boolaa.test");
    assertEq(await rowsOf(carol, "join_requests"), 1, "carol sees her pending request");
    assertEq(await rowsOf(carol, "chat_messages"), 0, "carol sees no Flatmates chat");
    const ev = await sql`select id from public.events where bubble_id = ${FLATMATES} limit 1`;
    const t1 = await alice.rpc("toggle_rsvp", { p_event_id: ev[0].id });
    assert(!t1.error, "toggle_rsvp");
    await alice.rpc("toggle_rsvp", { p_event_id: ev[0].id });
    // start_device_check still answers code_required for unknown devices (devices get
    // trusted before the flip), but nothing is blocked.
    assertEq((await alice.rpc("start_device_check", { p_device_id: `off-${crypto.randomUUID()}` })).data.status, "code_required", "check still reports");
    assertEq(await rowsOf(alice, "chat_messages") > 0, true, "and data stays readable");
    // delete_my_account works without a code, as before.
    const u = await createUser();
    const c = await signIn(u.email);
    assert(!(await c.rpc("delete_my_account")).error, "delete without code while OFF");
  }));

Deno.test("age confirmation: stored at sign-up; flag ON rejects sign-up without it and gates old accounts", opts, async () => {
  // Flag OFF.
  await withFlags({ age: false }, async () => {
    const e1 = uniqueEmail("age1"), e2 = uniqueEmail("age2");
    const r1 = await client().auth.signUp({ email: e1, password: PASSWORD, options: { data: { name: "No Age", locale: "en" } } });
    assert(!r1.error, "sign-up without age while OFF");
    trackUser(r1.data.user!.id);
    const r2 = await client().auth.signUp({ email: e2, password: PASSWORD, options: { data: { name: "Aged", locale: "ro", age_confirmed: true, terms_version: "2026-11-22" } } });
    assert(!r2.error, "sign-up with age");
    trackUser(r2.data.user!.id);
    const rows = await sql`select id, age_confirmed_at, terms_version from public.users where id in (${r1.data.user!.id}, ${r2.data.user!.id})`;
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    assertEq(byId[r1.data.user!.id].age_confirmed_at, null, "no age stored");
    assert(byId[r2.data.user!.id].age_confirmed_at, "age stored");
    assertEq(byId[r2.data.user!.id].terms_version, "2026-11-22", "terms version stored");
    const c = await signIn(e2);
    const own = await c.from("users").select("age_confirmed_at, terms_version").eq("id", r2.data.user!.id).single();
    assert(own.data?.age_confirmed_at, "user can read own age_confirmed_at");
    const write = await c.from("users").update({ age_confirmed_at: null }).eq("id", r2.data.user!.id);
    assert(write.error, "client can't write age_confirmed_at");
    assert(!(await c.from("users").update({ name: "Renamed" }).eq("id", r2.data.user!.id)).error, "name still writable");
  });
  // Flag ON.
  await withFlags({ age: true }, async () => {
    const e3 = uniqueEmail("age3");
    const r3 = await client().auth.signUp({ email: e3, password: PASSWORD, options: { data: { name: "Kid" } } });
    assertEq([r3.error?.status, r3.error?.message], [400, "age confirmation required"], "rejected sign-up");
    const r4 = await client().auth.signUp({ email: uniqueEmail("age4"), password: PASSWORD, options: { data: { name: "Ok", age_confirmed: true, terms_version: "2026-11-22" } } });
    assert(!r4.error, "accepted sign-up");
    trackUser(r4.data.user!.id);
    // Existing account without age (carol is seeded without it).
    const carol = await signIn("carol@boolaa.test");
    assertEq(await rowsOf(carol, "join_requests"), 0, "unconfirmed account sees nothing");
    assertEq((await carol.rpc("request_to_join", { p_invite_code: "CLIMB123" })).error?.message, "age confirmation required", "RPC refused");
    assertEq((await carol.rpc("start_device_check", { p_device_id: TEST_DEVICE })).data, { status: "verified", needs_age_confirmation: true }, "client learns it");
    const ca = await carol.rpc("confirm_age", { p_terms_version: "2026-11-22" });
    assert(!ca.error && ca.data, "confirm_age");
    assertEq(await rowsOf(carol, "join_requests"), 1, "data visible after confirm_age");
    await sql`update public.users set age_confirmed_at = null, terms_version = null where id = '33333333-3333-3333-3333-333333333333'`;
  });
});

Deno.test("moderation alert: emailed once per target per 10 min, URGENT for self-harm, never blocks the report", opts, async () => {
  const MOD = "moderation@boolaa.ro";
  // Earlier runs (and moderation.test.ts) leave alerts with the same subjects in Mailpit.
  await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${MOD}"`)}`, { method: "DELETE" })).body?.cancel();
  const alice = await signIn("alice@boolaa.test");
  const msg = await sql`select id from public.chat_messages where sender_id = '22222222-2222-2222-2222-222222222222' and bubble_id = ${FLATMATES} limit 1`;
  const before = await countMail(MOD);
  const r1 = await alice.rpc("report_content", { p_target_type: "chat_message", p_target_id: msg[0].id, p_reason: "spam", p_details: "test details" });
  assert(!r1.error, `report: ${r1.error?.message}`);
  const m = await waitMail(MOD, { subject: /spam report on a chat message in "Flatmates"/, timeoutMs: 15000 });
  assert(m.text.includes("Flatmates") && m.text.includes("Guilty. Buying more today.") && m.text.includes("test details"), "content in alert");
  assert(m.text.includes("Bob (22222222-2222-2222-2222-222222222222)") && m.text.includes(`Alice (${ALICE})`), "names and ids");
  assert(/Open reports against this user \(30 days\): \d+/.test(m.text), "open count");
  assert(!/@boolaa\.test/.test(m.text + m.html), "no email addresses in the body");
  assert(m.text.includes(`https://boolaa.ro/admin?report=${r1.data}`), "link to the admin view");

  const r2 = await alice.rpc("report_content", { p_target_type: "chat_message", p_target_id: msg[0].id, p_reason: "harassment" });
  assert(!r2.error, "second report");
  const r3 = await alice.rpc("report_content", { p_target_type: "chat_message", p_target_id: msg[0].id, p_reason: "self_harm" });
  assert(!r3.error, "self-harm report");
  const urgent = await waitMail(MOD, { subject: /^URGENT: .*self_harm/, timeoutMs: 15000 });
  assert(urgent.text.includes("URGENT"), "urgent flagged");
  await sleep(2000);
  assertEq(await countMail(MOD) - before, 2, "harassment duplicate within 10 min was only counted");

  // Function unreachable: the report still succeeds.
  await sql`select vault.update_secret((select id from vault.secrets where name = 'report_alert_url'), 'http://127.0.0.1:1/nowhere')`;
  try {
    const r4 = await alice.rpc("report_content", { p_target_type: "user", p_target_id: "22222222-2222-2222-2222-222222222222", p_reason: "other" });
    assert(!r4.error && r4.data, "report stored even though the alert can't be delivered");
  } finally {
    await sql`select vault.update_secret((select id from vault.secrets where name = 'report_alert_url'), 'http://kong:8000/functions/v1/report-alert')`;
    await sql`delete from public.reports where reporter_id = ${ALICE}`;
  }
  const bad = await fetch(`${API}/functions/v1/report-alert`, { method: "POST", headers: { "x-report-alert-secret": "wrong" }, body: "{}" });
  assertEq(bad.status, 401, "wrong secret refused");
  await bad.body?.cancel();
});

Deno.test("send-email hook rejects unsigned calls", opts, async () => {
  const res = await fetch(`${API}/functions/v1/send-email`, { method: "POST", body: JSON.stringify({ user: { email: "x@boolaa.test" }, email_data: {} }) });
  assertEq(res.status, 401, "unsigned hook call");
  await res.body?.cancel();
});

Deno.test({ name: "teardown", ...opts, fn: async () => {
  await setFlags({ device: false, age: false });
  await cleanupUsers();
  await sql.end();
} });
