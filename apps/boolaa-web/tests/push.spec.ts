import { createClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { Database } from "../src/lib/database.types";
import { SUPABASE_URL, apiUser, bubbleChip, deleteUsers, login, serviceRoleKey, throwaway } from "./helpers";

// Web Push client (docs/push-notifications.md §5, §8 Web, §9): Settings → Notifications
// (notification_prefs), bubble mute (bubble_mutes), subscribing from a click, the service worker,
// notification deep links, and proof that a registered subscription gets a queued push.
//
// Headless Chromium has no push service and answers "denied" without asking, so the page sees a
// stubbed permission ("default" until the click; the context itself is granted so the service worker
// can show notifications) and a stubbed PushManager whose subscription looks real to the backend
// (fcm.googleapis.com endpoint, fresh P-256 key, 16-byte auth).
// Pushes are never sent: the local push-dispatch runs with PUSH_DRY_RUN=1 (push_debug_log).

const RUN = Date.now().toString(36);
const ANA = throwaway("PushAna", RUN);
const BEN = throwaway("PushBen", RUN);
const STRANGER = throwaway("PushOut", RUN);

test.afterAll(async () => {
  const key = serviceRoleKey();
  if (key) await deleteUsers(key, [ANA.email, BEN.email, STRANGER.email]);
});

const SUB_KEY = "__e2e_push_sub";

/** Fake PushManager: subscribe() makes (and remembers) a backend-valid subscription. */
async function stubPush(context: BrowserContext) {
  await context.addInitScript((key) => {
    const PERM = "__e2e_perm";
    Object.defineProperty(Notification, "permission", { configurable: true, get: () => localStorage.getItem(PERM) ?? "default" });
    Notification.requestPermission = async () => {
      if (!localStorage.getItem(PERM)) localStorage.setItem(PERM, "granted");
      return localStorage.getItem(PERM) as NotificationPermission;
    };
    const b64 = (buf: ArrayBuffer | Uint8Array) =>
      btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    type J = { endpoint: string; expirationTime: null; keys: { p256dh: string; auth: string } };
    const make = (j: J) =>
      ({
        endpoint: j.endpoint,
        expirationTime: null,
        options: { userVisibleOnly: true },
        toJSON: () => j,
        getKey: () => null,
        unsubscribe: async () => {
          localStorage.removeItem(key);
          return true;
        },
      }) as unknown as PushSubscription;
    PushManager.prototype.getSubscription = async function () {
      const j = localStorage.getItem(key);
      return j ? make(JSON.parse(j)) : null;
    };
    PushManager.prototype.subscribe = async function (opts?: PushSubscriptionOptionsInit) {
      const k = opts?.applicationServerKey as Uint8Array | undefined;
      (window as unknown as { __e2eVapidLength: number }).__e2eVapidLength = k?.byteLength ?? 0;
      const kp = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
      const j: J = {
        endpoint: `https://fcm.googleapis.com/fcm/send/e2e-${crypto.randomUUID()}`,
        expirationTime: null,
        keys: { p256dh: b64(await crypto.subtle.exportKey("raw", kp.publicKey)), auth: b64(crypto.getRandomValues(new Uint8Array(16))) },
      };
      localStorage.setItem(key, JSON.stringify(j));
      return make(j);
    };
  }, SUB_KEY);
}

const endpointOf = (page: Page) =>
  page.evaluate((key) => (JSON.parse(localStorage.getItem(key) ?? "null") as { endpoint: string } | null)?.endpoint ?? null, SUB_KEY);

async function poll<T>(fn: () => Promise<T | null | undefined>, timeout = 20_000): Promise<T> {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 500));
  }
}

test("settings, subscribe from a click, queued push, mute, deep links, service worker", async ({ browser, baseURL }) => {
  test.setTimeout(150_000);
  const key = serviceRoleKey();
  test.skip(!key, "needs the local service-role key");
  const admin = createClient<Database>(SUPABASE_URL, key!, { auth: { persistSession: false } });

  // Ana owns two bubbles; Ben is in both (Ana's approval is the majority).
  const ana = await apiUser(ANA);
  const ben = await apiUser(BEN);
  const mk = async (name: string) => {
    const { data: bubble, error } = await ana.sb.rpc("create_bubble", { p_name: name });
    expect(error).toBeNull();
    const { data: req } = await ben.sb.rpc("request_to_join", { p_invite_code: bubble!.invite_code });
    expect((await ana.sb.rpc("approve_join_request", { p_request_id: req!.id })).data).toBe(true);
    return bubble!;
  };
  const main = await mk(`Push ${RUN}`);
  const side = await mk(`Push side ${RUN}`);
  const stranger = await apiUser(STRANGER);
  const { data: foreign } = await stranger.sb.rpc("create_bubble", { p_name: `Push foreign ${RUN}` });

  const context = await browser.newContext();
  await context.grantPermissions(["notifications"], { origin: baseURL! });
  await stubPush(context);
  const page = await context.newPage();
  await login(page, BEN.email);

  // /sw.js is served to everyone (not caught by the auth proxy) and never cached.
  const sw = await page.request.get("/sw.js", { maxRedirects: 0 });
  expect(sw.status()).toBe(200);
  expect(sw.headers()["content-type"]).toContain("javascript");

  // Home: dismissible card while the browser hasn't been asked; dismissing it sticks.
  await page.goto("/home");
  const card = page.getByTestId("push-card");
  await expect(card).toBeVisible();
  await card.getByTestId("push-card-dismiss").click();
  await expect(card).toBeHidden();
  await page.reload();
  await expect(page.getByTestId("home-hero")).toBeVisible();
  await expect(page.getByTestId("push-card")).toHaveCount(0);

  // Settings → Notifications: nothing is subscribed before the click (no prompt on load).
  await page.goto("/settings");
  const settings = page.getByTestId("notification-settings");
  await expect(settings).toHaveAttribute("data-loaded", "true");
  await expect(settings.getByTestId("push-enable")).toBeVisible();
  expect(await endpointOf(page)).toBeNull();

  // Blocked in the browser: explain how to re-enable instead of asking.
  await page.evaluate(() => localStorage.setItem("__e2e_perm", "denied"));
  await page.reload();
  await expect(settings.getByTestId("push-blocked")).toBeVisible();
  await page.evaluate(() => localStorage.removeItem("__e2e_perm"));
  await page.reload();

  // The click asks for permission (granted here), subscribes and registers the subscription.
  await settings.getByTestId("push-enable").click();
  await expect(settings.getByTestId("push-on")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __e2eVapidLength: number }).__e2eVapidLength)).toBe(65);
  const endpoint = (await endpointOf(page))!;
  expect(endpoint).toMatch(/^https:\/\/fcm\.googleapis\.com\//);
  const token = await poll(async () => (await admin.from("push_tokens").select("*").eq("user_id", ben.id).eq("token", endpoint).maybeSingle()).data);
  expect(token).toMatchObject({ platform: "web", endpoint, locale: "en", app_version: "web" });
  expect(token.p256dh).toBeTruthy();

  // A chat message from Ana queues a push for Ben's subscription (dry-run dispatcher, no real send).
  const text = `E2E push ${RUN}`;
  expect((await ana.sb.from("chat_messages").insert({ bubble_id: main.id, sender_id: ana.id, content: text })).error).toBeNull();
  const row = await poll(async () =>
    (await admin.from("notification_outbox").select("*").eq("recipient_id", ben.id).eq("type", "chat").eq("bubble_id", main.id).maybeSingle()).data,
  );
  expect(row).toMatchObject({ type: "chat", actor_id: ana.id, collapse_key: `chat:${main.id}` });
  // The dispatcher (woken by pg_net after commit) renders it for the web subscription.
  const debug = await poll(async () => (await admin.from("push_debug_log").select("*").eq("token", endpoint).maybeSingle()).data, 30_000);
  const payload = (debug.request as { payload?: Record<string, string> }).payload!;
  expect(payload).toMatchObject({ type: "chat", bubble_id: main.id, url: `/chat?bubble=${main.id}`, tag: `chat:${main.id}`, body: text });

  // Account-level prefs persist; the master switch greys out the rest.
  await settings.getByTestId("pref-chat").click();
  await expect(settings.getByTestId("pref-chat")).toHaveAttribute("aria-checked", "false");
  await expect.poll(async () => (await admin.from("notification_prefs").select("chat").eq("user_id", ben.id).single()).data?.chat).toBe(false);
  await settings.getByTestId("pref-enabled").click();
  await expect(settings.getByTestId("pref-food")).toBeDisabled();
  await expect.poll(async () => (await admin.from("notification_prefs").select("enabled").eq("user_id", ben.id).single()).data?.enabled).toBe(false);
  await page.reload();
  await expect(settings).toHaveAttribute("data-loaded", "true");
  await expect(settings.getByTestId("pref-chat")).toHaveAttribute("aria-checked", "false");
  await expect(settings.getByTestId("pref-enabled")).toHaveAttribute("aria-checked", "false");
  await settings.getByTestId("pref-enabled").click();
  await settings.getByTestId("pref-chat").click();
  await expect(settings.getByTestId("pref-chat")).toHaveAttribute("aria-checked", "true");
  await expect.poll(async () => (await admin.from("notification_prefs").select("enabled, chat").eq("user_id", ben.id).single()).data).toEqual({ enabled: true, chat: true });

  // Mute this bubble: 1 hour, then until turned back on, then unmute.
  const mute = page.getByTestId("bubble-mute");
  await mute.getByTestId("mute-1h").click();
  await expect(mute).toHaveAttribute("data-muted", "true");
  const until = await poll(async () => (await admin.from("bubble_mutes").select("until").eq("user_id", ben.id).eq("bubble_id", main.id).maybeSingle()).data);
  const ms = new Date(until.until!).getTime() - Date.now();
  expect(ms).toBeGreaterThan(55 * 60_000);
  expect(ms).toBeLessThan(61 * 60_000);
  await page.reload();
  await expect(mute).toHaveAttribute("data-muted", "true");
  await mute.getByTestId("unmute").click();
  await expect(mute).toHaveAttribute("data-muted", "false");
  await mute.getByTestId("mute-forever").click();
  await expect(mute).toHaveAttribute("data-muted", "true");
  await expect.poll(async () => (await admin.from("bubble_mutes").select("until").eq("user_id", ben.id).eq("bubble_id", main.id).maybeSingle()).data).toEqual({ until: null });
  await mute.getByTestId("unmute").click();
  await expect(mute).toHaveAttribute("data-muted", "false");
  await expect.poll(async () => (await admin.from("bubble_mutes").select("until").eq("user_id", ben.id).maybeSingle()).data).toBeNull();

  // Deep links: switch to the notification's bubble and highlight the event.
  const { data: ev } = await ana.sb
    .from("events")
    .insert({ bubble_id: side.id, creator_id: ana.id, title: `E2E push event ${RUN}`, datetime: new Date(Date.now() + 86_400_000).toISOString() })
    .select()
    .single();
  await page.goto(`/events?bubble=${side.id}&event=${ev!.id}`);
  await expect(bubbleChip(page, side.name)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(`[data-item-id="${ev!.id}"]`)).toHaveAttribute("data-highlight", "true");
  await expect(page).toHaveURL(/\/events$/); // parameters applied once, then dropped
  // A bubble I'm not in: Home, without switching.
  await page.goto(`/chat?bubble=${foreign!.id}`);
  await expect(page).toHaveURL(/\/home$/);
  await expect(bubbleChip(page, side.name)).toHaveAttribute("aria-pressed", "true");

  // Service worker: route table, notification shown with tag and url, none for the open chat.
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  expect(
    await worker.evaluate(() =>
      (self as unknown as { boolaaPush: { targetUrl: (d: object) => string } }).boolaaPush.targetUrl({ type: "event_reminder", bubble_id: "b1", target_id: "e1" }),
    ),
  ).toBe("/events?bubble=b1&event=e1");
  await page.goto("/home");
  await expect(page.getByTestId("home-hero")).toBeVisible();
  // Headless Chromium can't display notifications, so the worker's showNotification is recorded.
  const shown = await worker.evaluate(async (bubbleId) => {
    type Shown = { title: string; options: NotificationOptions & { data?: { url?: string } } };
    const sw = self as unknown as { registration: ServiceWorkerRegistration; boolaaPush: { handlePush: (d: object) => Promise<object | null> }; __shown: Shown[] };
    sw.__shown = [];
    sw.registration.showNotification = async (title: string, options?: NotificationOptions) => {
      sw.__shown.push({ title, options: options ?? {} });
    };
    const d = { title: "Ana in Push", body: "hi", tag: `chat:${bubbleId}`, url: `/chat?bubble=${bubbleId}`, type: "chat", bubble_id: bubbleId, target_id: "m1" };
    await sw.boolaaPush.handlePush(d);
    const n = sw.__shown[0];
    return { count: sw.__shown.length, title: n?.title, tag: n?.options.tag, renotify: (n?.options as { renotify?: boolean })?.renotify, url: n?.options.data?.url };
  }, side.id);
  expect(shown).toEqual({ count: 1, title: "Ana in Push", tag: `chat:${side.id}`, renotify: true, url: `/chat?bubble=${side.id}` });
  // Ben is now looking at the side bubble's chat: its chat pushes show no banner (focused tab only).
  await page.goto("/chat");
  await expect(page.getByTestId("page-title")).toBeVisible();
  await page.bringToFront();
  const suppressed = await worker.evaluate(async (bubbleId) => {
    type Tab = { focused: boolean };
    const sw = self as unknown as { boolaaPush: { chatOnScreen: (d: object) => Promise<boolean> }; clients: { matchAll: (o: object) => Promise<Tab[]> } };
    const tabs = await sw.clients.matchAll({ type: "window" });
    return { onScreen: await sw.boolaaPush.chatOnScreen({ type: "chat", bubble_id: bubbleId }), focused: tabs.some((c) => c.focused) };
  }, side.id);
  if (suppressed.focused) expect(suppressed.onScreen).toBe(true);
  else test.info().annotations.push({ type: "note", description: "headless tab not focused: chat suppression not asserted" });

  // Turn off on this browser: unregistered on the server, not re-subscribed on the next start.
  await page.goto("/settings");
  await settings.getByTestId("push-disable").click();
  await expect(settings.getByTestId("push-enable")).toBeVisible();
  await expect.poll(async () => (await admin.from("push_tokens").select("id").eq("user_id", ben.id)).data?.length).toBe(0);
  await page.reload();
  await expect(settings).toHaveAttribute("data-loaded", "true");
  await page.waitForTimeout(1500);
  expect((await admin.from("push_tokens").select("id").eq("user_id", ben.id)).data).toHaveLength(0);

  // Turn on again; the next app start registers again; sign-out unregisters.
  await settings.getByTestId("push-enable").click();
  await expect(settings.getByTestId("push-on")).toBeVisible();
  const again = (await endpointOf(page))!;
  await expect.poll(async () => (await admin.from("push_tokens").select("token").eq("user_id", ben.id)).data?.map((r) => r.token)).toEqual([again]);
  await admin.from("push_tokens").delete().eq("user_id", ben.id); // as if the server had dropped it
  await page.reload();
  await expect.poll(async () => (await admin.from("push_tokens").select("token").eq("user_id", ben.id)).data?.map((r) => r.token)).toEqual([again]);
  await page.getByTestId("profile-button").click();
  await page.getByRole("dialog").locator("button.btn-danger").first().click();
  await page.waitForURL(/\/login$/);
  await expect.poll(async () => (await admin.from("push_tokens").select("id").eq("user_id", ben.id)).data?.length).toBe(0);
  expect(await endpointOf(page)).toBeNull(); // browser subscription dropped too

  await context.close();
});
