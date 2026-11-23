/* Boolaa service worker: Web Push only (docs/push-notifications.md §5 and §8, Web). No caching. */

// What each open tab shows, reported by the app (src/lib/push.ts reportView): { path, bubbleId }.
const views = new Map();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("message", (event) => {
  const d = event.data;
  if (d && d.type === "boolaa:view" && event.source && event.source.id) {
    views.set(event.source.id, { path: String(d.path || ""), bubbleId: d.bubbleId ? String(d.bubbleId) : null });
  }
});

/** Same-origin path the notification opens; falls back to the route table of §5. */
function targetUrl(d) {
  const url = baseUrl(d);
  // Owner-side request pushes also open the Requests sheet on the item (spec "Requests and picking").
  if ((d.type === "item_request" || d.type === "item_request_withdrawn") && !/[?&]requests=/.test(url))
    return url + (url.includes("?") ? "&" : "?") + "requests=" + encodeURIComponent(d.target_id || "");
  return url;
}

function baseUrl(d) {
  if (typeof d.url === "string" && d.url.startsWith("/") && !d.url.startsWith("//")) return d.url;
  const b = encodeURIComponent(d.bubble_id || "");
  const t = encodeURIComponent(d.target_id || "");
  switch (d.type) {
    case "chat": return `/chat?bubble=${b}`;
    case "join_request": return `/settings?bubble=${b}`;
    case "approval": return `/home?bubble=${b}`;
    case "new_event":
    case "event_reminder": return `/events?bubble=${b}&event=${t}`;
    case "food": return `/food?bubble=${b}&post=${t}`;
    case "market": return `/marketplace?bubble=${b}&item=${t}`;
    case "item_request":
    case "item_request_withdrawn":
    case "item_picked":
    case "item_missed":
      return d.item_kind === "food" ? `/food?bubble=${b}&post=${t}` : `/marketplace?bubble=${b}&item=${t}`;
    default: return "/home";
  }
}

/** The bubble a tab shows: its ?bubble= parameter, what the tab reported, or the bubble cookie. */
async function bubbleOf(client) {
  const url = new URL(client.url);
  const fromUrl = url.searchParams.get("bubble");
  if (fromUrl) return fromUrl;
  const view = views.get(client.id);
  if (view && view.bubbleId) return view.bubbleId;
  try {
    if (self.cookieStore) {
      const c = await self.cookieStore.get("boolaa_bubble");
      if (c && c.value) return decodeURIComponent(c.value);
    }
  } catch {
    /* no cookie access */
  }
  return null;
}

/** A chat push for the chat that's on screen right now (focused, visible tab) shows no banner. */
async function chatOnScreen(d) {
  if (d.type !== "chat" || !d.bubble_id) return false;
  const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const c of tabs) {
    if (!c.focused || c.visibilityState !== "visible") continue;
    const url = new URL(c.url);
    if (url.origin !== self.location.origin) continue;
    const view = views.get(c.id);
    const path = view ? view.path : url.pathname;
    if (path !== "/chat") continue;
    if ((await bubbleOf(c)) === d.bubble_id) return true;
  }
  return false;
}

async function handlePush(d) {
  if (!d || !d.title) return null;
  if (await chatOnScreen(d)) return null;
  const options = {
    body: d.body || "",
    tag: d.tag || undefined,
    renotify: !!d.tag && d.type === "chat",
    data: { ...d, url: targetUrl(d) },
    icon: "/icon-192.png",
    badge: "/badge-72.png",
    lang: d.lang || undefined,
  };
  await self.registration.showNotification(d.title, options);
  return options;
}

self.addEventListener("push", (event) => {
  let d = null;
  try {
    d = event.data ? event.data.json() : null;
  } catch {
    d = null;
  }
  event.waitUntil(handlePush(d));
});

async function openTarget(url) {
  const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const tab = tabs.find((c) => new URL(c.url).origin === self.location.origin);
  if (tab) {
    await tab.focus();
    // A full navigation: the app reads ?bubble= (and the target) on load.
    if ("navigate" in tab) return tab.navigate(url).catch(() => self.clients.openWindow(url));
    return tab;
  }
  return self.clients.openWindow(url);
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  event.waitUntil(openTarget(new URL(d.url || "/home", self.location.origin).href));
});

// Exposed for the end-to-end test (tests/push.spec.ts), which can't send a real push.
self.boolaaPush = { handlePush, targetUrl, chatOnScreen };
