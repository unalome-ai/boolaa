// Past events (migration 20261123220000_past_events_export_check.sql, docs/boolaa-spec.md "Events"):
// an event has ended once its start + 1 hour has passed, and toggle_rsvp refuses it both ways.
//
//   deno test -A --no-check supabase/tests/past_events.test.ts
//
// Throwaway users and bubbles only. Never changes app_settings flags.
import { assert, assertEq, cleanupUsers, createUser, sha256Hex, signIn, sql, TEST_DEVICE } from "./helpers.ts";

const opts = { sanitizeOps: false, sanitizeResources: false };

async function member(name: string) {
  const u = await createUser({ name });
  await sql`select public.trust_device(${u.id}::uuid, ${await sha256Hex(TEST_DEVICE)}, 'test')`;
  const c = await signIn(u.email);
  const st = await c.rpc("start_device_check", { p_device_id: TEST_DEVICE });
  assertEq(st.data?.status, "verified", `device check for ${name}`);
  return { ...u, c };
}

Deno.test({ name: "toggle_rsvp: past events are refused, upcoming and just-started ones work", ...opts, fn: async () => {
  const owner = await member("Pia");
  const { data: bubble, error } = await owner.c.rpc("create_bubble", { p_name: `Past ${Date.now()}` });
  assert(!error, `create_bubble: ${error?.message}`);
  const at = (minutesFromNow: number) => new Date(Date.now() + minutesFromNow * 60_000).toISOString();
  const ins = async (title: string, datetime: string) => {
    const { data, error } = await owner.c.from("events")
      .insert({ bubble_id: bubble.id, creator_id: owner.id, title, datetime }).select("id").single();
    assert(!error, `insert ${title}: ${error?.message}`);
    return data!.id as string;
  };
  const upcoming = await ins("Tomorrow", at(24 * 60));
  const started = await ins("Started 30 min ago", at(-30)); // still within its hour
  const ended = await ins("Ended", at(-61));
  const endedGoing = await ins("Ended, was going", at(-3 * 24 * 60));
  await sql`update public.events set rsvp_list = array[${owner.id}::uuid] where id = ${endedGoing}`;

  const up = await owner.c.rpc("toggle_rsvp", { p_event_id: upcoming });
  assert(!up.error, `upcoming: ${up.error?.message}`);
  assertEq(up.data, [owner.id], "RSVP to an upcoming event");
  const st = await owner.c.rpc("toggle_rsvp", { p_event_id: started });
  assert(!st.error, `started within the hour: ${st.error?.message}`);

  const r1 = await owner.c.rpc("toggle_rsvp", { p_event_id: ended });
  assert(r1.error?.message.includes("event has ended"), `RSVP to an ended event: ${r1.error?.message}`);
  const r2 = await owner.c.rpc("toggle_rsvp", { p_event_id: endedGoing });
  assert(r2.error?.message.includes("event has ended"), `un-RSVP from an ended event: ${r2.error?.message}`);
  const rows = await sql`select id, rsvp_list from public.events where id in (${ended}, ${endedGoing})`;
  for (const r of rows) assertEq(r.rsvp_list, r.id === endedGoing ? [owner.id] : [], "ended events unchanged");

  // The helper the rule is built on.
  const h = await sql`select public.event_has_ended(now() - interval '59 minutes') as a, public.event_has_ended(now() - interval '61 minutes') as b`;
  assertEq([h[0].a, h[0].b], [false, true], "event_has_ended");

  // Non-members still get 'event not found' first (no leak that it ended).
  const outsider = await member("Oli");
  const r3 = await outsider.c.rpc("toggle_rsvp", { p_event_id: ended });
  assert(r3.error?.message.includes("event not found"), `outsider: ${r3.error?.message}`);
}});

Deno.test({ name: "cleanup", ...opts, fn: async () => {
  await cleanupUsers();
  await sql.end();
}});
