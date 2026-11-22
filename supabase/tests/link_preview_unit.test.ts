// Unit tests for the link-preview function (no Supabase needed): SSRF guard (URLs, IPv4/IPv6
// ranges, DNS answers, redirects), size caps, Open Graph parsing and the image pipeline.
//
//   deno test -A --no-check supabase/tests/link_preview_unit.test.ts
import {
  checkUrl, GuardError, isPublicIp, parseIPv6, readCapped, type Resolver, safeFetch,
} from "../functions/link-preview/guard.ts";
import { cleanText, decodeHtml, parseOpenGraph } from "../functions/link-preview/og.ts";
import { dimensions, ImageRejected, sniff, toPreviewJpeg } from "../functions/link-preview/image.ts";
import { buildPreview, createHandler, type Deps } from "../functions/link-preview/handler.ts";
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}
function assertEq<T>(a: T, b: T, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
async function rejects(fn: () => unknown, code: string, msg: string) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof GuardError) {
      assertEq(e.code, code, msg);
      return;
    }
    throw new Error(`${msg}: expected GuardError ${code}, got ${e}`);
  }
  throw new Error(`${msg}: expected GuardError ${code}, got success`);
}

// --- IP ranges -------------------------------------------------------------
Deno.test("IPv4: private, loopback, link-local, metadata, CGNAT, reserved are refused", () => {
  const blocked = [
    "0.0.0.0", "0.1.2.3", "10.0.0.1", "10.255.255.255", "100.64.0.1", "100.127.255.254", "127.0.0.1", "127.1.2.3",
    "169.254.169.254", "169.254.0.1", "172.16.0.1", "172.31.255.255", "192.0.0.8", "192.0.2.1", "192.88.99.1",
    "192.168.1.1", "198.18.0.1", "198.19.255.255", "198.51.100.7", "203.0.113.9", "224.0.0.1", "239.255.255.250",
    "240.0.0.1", "255.255.255.255",
  ];
  for (const ip of blocked) assert(!isPublicIp(ip), `${ip} refused`);
  const allowed = ["1.1.1.1", "8.8.8.8", "93.184.216.34", "172.15.255.255", "172.32.0.1", "100.63.255.255", "100.128.0.1",
    "169.253.1.1", "192.169.0.1", "198.17.255.255", "223.255.255.255"];
  for (const ip of allowed) assert(isPublicIp(ip), `${ip} allowed`);
});

Deno.test("IPv6: loopback, ULA, link-local, multicast, mapped/embedded IPv4, special ranges are refused", () => {
  const blocked = [
    "::", "::1", "0:0:0:0:0:0:0:1", "fc00::1", "fd00:ec2::254", "fe80::1", "febf::1", "fec0::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.0.0.1", "::ffff:169.254.169.254", "::127.0.0.1",
    "64:ff9b::8.8.8.8", "64:ff9b:1::1", "2001::1", "2001:0:4136:e378::1", "2001:db8::1", "2002:7f00:1::1",
    "100::1", "3fff::1", "5f00::1", "fe80::1%25eth0",
  ];
  for (const ip of blocked) assert(!isPublicIp(ip), `${ip} refused`);
  const allowed = ["2606:4700:4700::1111", "2001:4860:4860::8888", "2a00:1450:4001:80b::200e", "::ffff:8.8.8.8", "2400:cb00::1"];
  for (const ip of allowed) assert(isPublicIp(ip), `${ip} allowed`);
});

Deno.test("IPv6 parser: compressed forms, embedded IPv4 and garbage", () => {
  assertEq(parseIPv6("::1")?.[15], 1, "::1");
  assertEq(parseIPv6("[::1]")?.[15], 1, "bracketed");
  assertEq(parseIPv6("::ffff:1.2.3.4")?.slice(10), [0xff, 0xff, 1, 2, 3, 4], "mapped");
  for (const bad of ["1::2::3", "12345::1", "1:2:3:4:5:6:7:8:9", "gggg::1", ":::", "1.2.3.4", "", "::1.2.3"]) {
    assertEq(parseIPv6(bad), null, `${bad} rejected`);
  }
  assert(!isPublicIp("not-an-ip"), "garbage is not public");
});

// --- URLs ------------------------------------------------------------------
Deno.test("URL guard: schemes, credentials, ports, local names and IP literals", async () => {
  checkUrl("https://example.com/a?b=c#d");
  checkUrl("http://example.com:80/");
  checkUrl("https://example.com:443/");
  checkUrl("https://8.8.8.8/");
  checkUrl("https://[2606:4700:4700::1111]/");
  const cases: [string, string][] = [
    ["file:///etc/passwd", "bad_scheme"], ["ftp://example.com/", "bad_scheme"], ["gopher://example.com/", "bad_scheme"],
    ["javascript:alert(1)", "bad_scheme"], ["data:text/html,hi", "bad_scheme"], ["ws://example.com/", "bad_scheme"],
    ["https://user:pw@example.com/", "credentials"], ["https://user@example.com/", "credentials"],
    ["https://example.com:8443/", "bad_port"], ["http://example.com:22/", "bad_port"], ["http://example.com:443/", "bad_port"],
    ["http://localhost/", "bad_host"], ["http://LOCALHOST./", "bad_host"], ["http://foo.localhost/", "bad_host"],
    ["http://printer.local/", "bad_host"], ["http://metadata.google.internal/", "bad_host"], ["http://intranet/", "bad_host"],
    ["http://kong/", "bad_host"], ["http://router.home.arpa/", "bad_host"],
    ["http://127.0.0.1/", "private_address"], ["http://2130706433/", "private_address"], ["http://0x7f.1/", "private_address"],
    ["http://017700000001/", "private_address"], ["http://127.1/", "private_address"], ["http://0/", "private_address"],
    ["http://169.254.169.254/latest/meta-data/", "private_address"], ["http://[::1]/", "private_address"],
    ["http://[::ffff:127.0.0.1]/", "private_address"], ["http://[fd00:ec2::254]/", "private_address"],
    ["http://10.0.0.1/", "private_address"], ["http://192.168.0.1/", "private_address"],
    ["not a url", "bad_url"], ["", "bad_url"], [`https://example.com/${"a".repeat(2100)}`, "bad_url"],
  ];
  for (const [u, code] of cases) await rejects(() => checkUrl(u), code, u);
});

// --- Fetch with DNS and redirects -----------------------------------------
const PUBLIC = "93.184.216.34";
function fakeDns(map: Record<string, string[]>): Resolver {
  return (host) => Promise.resolve(map[host] ?? []);
}
type Route = (url: URL) => Response;
function fakeFetch(routes: Record<string, Route>, seen: string[] = []) {
  return (url: string, init: RequestInit) => {
    seen.push(url);
    assertEq(init.redirect, "manual", "redirects are handled by the guard");
    const u = new URL(url);
    const r = routes[u.host + u.pathname];
    return Promise.resolve(r ? r(u) : new Response("nope", { status: 404 }));
  };
}
const html = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, { headers: { "content-type": "text/html; charset=utf-8", ...headers } });
const redirect = (to: string, status = 302) => new Response(null, { status, headers: { location: to } });

Deno.test("DNS: every answer must be public; rebinding names and empty answers are refused", async () => {
  const resolve = fakeDns({
    "good.example.org": [PUBLIC, "2606:4700::6810:84e5"],
    "mixed.example.org": [PUBLIC, "10.0.0.5"],
    "v6local.example.org": ["::1"],
    "meta.example.org": ["169.254.169.254"],
    "mapped.example.org": ["::ffff:192.168.1.1"],
  });
  const fetchImpl = fakeFetch({ "good.example.org/": () => html("<title>ok</title>") });
  const { res } = await safeFetch("https://good.example.org/", { resolve, fetchImpl });
  assertEq(res.status, 200, "public host fetched");
  await res.body?.cancel();
  for (const h of ["mixed", "v6local", "meta", "mapped"]) {
    await rejects(() => safeFetch(`https://${h}.example.org/`, { resolve, fetchImpl }), "private_address", h);
  }
  await rejects(() => safeFetch("https://nxdomain.example.org/", { resolve, fetchImpl }), "dns_failed", "no answer");
});

Deno.test("redirects: each hop is re-checked, capped at 3, relative locations resolved", async () => {
  const resolve = fakeDns({ "a.example.org": [PUBLIC], "b.example.org": [PUBLIC], "evil.example.org": ["127.0.0.1"] });
  const seen: string[] = [];
  const fetchImpl = fakeFetch({
    "a.example.org/start": () => redirect("/next", 301),
    "a.example.org/next": () => redirect("https://b.example.org/final", 307),
    "b.example.org/final": () => html("<title>final</title>"),
    "a.example.org/to-local": () => redirect("http://127.0.0.1/admin"),
    "a.example.org/to-meta": () => redirect("http://169.254.169.254/latest/meta-data/"),
    "a.example.org/to-evil": () => redirect("https://evil.example.org/"),
    "a.example.org/to-file": () => redirect("file:///etc/passwd"),
    "a.example.org/to-port": () => redirect("https://b.example.org:8443/"),
    "a.example.org/loop": () => redirect("/loop"),
  }, seen);
  const { res, url } = await safeFetch("https://a.example.org/start", { resolve, fetchImpl });
  assertEq(url.href, "https://b.example.org/final", "followed two hops");
  await res.body?.cancel();
  await rejects(() => safeFetch("https://a.example.org/to-local", { resolve, fetchImpl }), "private_address", "redirect to loopback");
  await rejects(() => safeFetch("https://a.example.org/to-meta", { resolve, fetchImpl }), "private_address", "redirect to metadata");
  await rejects(() => safeFetch("https://a.example.org/to-evil", { resolve, fetchImpl }), "private_address", "redirect to a name resolving locally");
  await rejects(() => safeFetch("https://a.example.org/to-file", { resolve, fetchImpl }), "bad_scheme", "redirect to file:");
  await rejects(() => safeFetch("https://a.example.org/to-port", { resolve, fetchImpl }), "bad_port", "redirect to another port");
  seen.length = 0;
  await rejects(() => safeFetch("https://a.example.org/loop", { resolve, fetchImpl }), "too_many_redirects", "redirect loop");
  assertEq(seen.length, 4, "first request + 3 redirects, then stop");
  assert(!seen.some((u) => u.includes("127.0.0.1") || u.includes("169.254")), "never connected to a refused address");
});

Deno.test("size caps: HTML is truncated, images over the cap are refused", async () => {
  const big = new Uint8Array(100_000).fill(65);
  const cut = await readCapped(new Response(big), 1000, true);
  assertEq(cut.length, 1000, "truncated to the cap");
  await rejects(() => readCapped(new Response(big), 1000, false), "too_large", "image over the cap");
  await rejects(() => readCapped(new Response("x", { headers: { "content-length": "5000000" } }), 1000, false), "too_large", "declared length");
  // A stream that never ends is cut too.
  let n = 0;
  const endless = new ReadableStream<Uint8Array>({ pull(c) { n++; c.enqueue(new Uint8Array(4096)); } });
  const got = await readCapped(new Response(endless), 64 * 1024, true);
  assertEq(got.length, 64 * 1024, "endless body cut");
  assert(n < 40, "stopped reading");
});

// --- Open Graph --------------------------------------------------------------
Deno.test("Open Graph: og > twitter > title, entities decoded, tags stripped, limits applied", () => {
  const page = `<!doctype html><html><head>
    <meta charset="utf-8"><title>Fallback &amp; title</title>
    <meta property="og:title" content="Caf&eacute; &lt;b&gt;bold&lt;/b&gt; &#x1F600; &quot;q&quot;">
    <meta name="twitter:title" content="Twitter title">
    <meta content="A  description&#10;on two lines‮ reversed" property="og:description">
    <meta property='og:site_name' content='Site'>
    <meta property="og:image" content="/img/cover.png?a=1&amp;b=2">
    <script>var x = '<meta property="og:title" content="evil">';</script>
    </head><body><meta property="og:title" content="body meta"></body></html>`;
  const og = parseOpenGraph(page, "https://www.example.org/post/1");
  assertEq(og.title, 'Café bold 😀 "q"', "og:title cleaned");
  assertEq(og.description, "A description on two lines reversed", "whitespace + bidi stripped");
  assertEq(og.siteName, "Site", "site name");
  assertEq(og.imageUrl, "https://www.example.org/img/cover.png?a=1&b=2", "relative image resolved");

  const plain = parseOpenGraph("<html><head><title>\n  Just a <i>title</i>\n</title></head></html>", "https://x.org/");
  assertEq(plain.title, "Just a title", "<title> fallback");
  assertEq(plain.imageUrl, null, "no image");

  const js = parseOpenGraph(`<head><meta property="og:image" content="javascript:alert(1)"></head>`, "https://x.org/");
  assertEq(js.imageUrl, null, "non-http image dropped");

  const long = cleanText("x".repeat(500), 200)!;
  assertEq(Array.from(long).length, 200, "cut to 200 code points");
  assert(long.endsWith("…"), "ellipsis");
  assertEq(cleanText("  \u0000​ ", 10), null, "empty after cleaning");
  assertEq(cleanText("<script>alert(1)</script>Hi", 50), "alert(1) Hi", "tags removed, text kept as plain text");
});

Deno.test("charset: header, meta and fallback", () => {
  const latin = new Uint8Array([...new TextEncoder().encode("<title>Caf"), 0xe9, ...new TextEncoder().encode("</title>")]);
  assert(decodeHtml(latin, "text/html; charset=ISO-8859-1").includes("Café"), "header charset");
  const meta = new Uint8Array([...new TextEncoder().encode('<meta charset="windows-1252"><title>Caf'), 0xe9]);
  assert(decodeHtml(meta, "text/html").includes("Café"), "meta charset");
  assert(decodeHtml(new TextEncoder().encode("ok"), "text/html; charset=bogus-xyz") === "ok", "unknown charset falls back");
});

// --- Images ----------------------------------------------------------------
async function png(w: number, h: number, color = 0x3366ccff) {
  return await new Image(w, h).fill(color).encode();
}

Deno.test("images: sniffing, header dimensions, re-encode to JPEG <= 1200 px", async () => {
  const p = await png(2400, 1200);
  assertEq(sniff(p), "png", "png sniffed");
  assertEq(dimensions(p, "png"), { w: 2400, h: 1200 }, "png dims");
  const j = await new Image(300, 200).fill(0xff0000ff).encodeJPEG(80);
  assertEq(sniff(j), "jpeg", "jpeg sniffed");
  assertEq(dimensions(j, "jpeg"), { w: 300, h: 200 }, "jpeg dims");
  assertEq(sniff(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>")), null, "svg refused");
  assertEq(sniff(new TextEncoder().encode("<html>")), null, "html refused");

  const out = await toPreviewJpeg(p);
  assertEq(sniff(out), "jpeg", "output is JPEG");
  assertEq(dimensions(out, "jpeg"), { w: 1200, h: 600 }, "long edge 1200");
  // No metadata: only SOI + APP0 (JFIF) at most, no APP1 (Exif/XMP).
  let hasApp1 = false;
  for (let i = 2; i < out.length - 1 && !(out[i] === 0xff && out[i + 1] === 0xda); i++) if (out[i] === 0xff && out[i + 1] === 0xe1) hasApp1 = true;
  assert(!hasApp1, "no APP1 segment");
});

Deno.test("images: decompression bombs, tiny pixels and junk are rejected before decoding", async () => {
  // A PNG header claiming 20000 x 20000 pixels.
  const bomb = await png(64, 64);
  const v = new DataView(bomb.buffer, bomb.byteOffset);
  v.setUint32(16, 20000);
  v.setUint32(20, 20000);
  for (const [bytes, why] of [[bomb, "bomb"], [await png(1, 1), "tracking pixel"], [new Uint8Array([0xff, 0xd8, 0xff, 0, 0]), "truncated jpeg"],
    [new TextEncoder().encode("GIF89a"), "truncated gif"]] as [Uint8Array, string][]) {
    let rejected = false;
    try {
      await toPreviewJpeg(bytes);
    } catch (e) {
      rejected = e instanceof ImageRejected;
    }
    assert(rejected, `${why} rejected`);
  }
});

// --- Whole preview, handler --------------------------------------------------
Deno.test("buildPreview: HTML only, image copied through the guard, bad images skipped", async () => {
  const resolve = fakeDns({ "news.example.org": [PUBLIC], "cdn.example.org": [PUBLIC], "inner.example.org": ["192.168.0.10"] });
  const img = await png(800, 400);
  const seen: string[] = [];
  const fetchImpl = fakeFetch({
    "news.example.org/a": () => html(`<head><meta property="og:title" content="Story"><meta property="og:image" content="https://cdn.example.org/i.png"></head>`),
    "cdn.example.org/i.png": () => new Response(img, { headers: { "content-type": "image/png" } }),
    "news.example.org/internal-img": () => html(`<head><meta property="og:title" content="T"><meta property="og:image" content="https://inner.example.org/x.png"></head>`),
    "news.example.org/svg": () => html(`<head><meta property="og:title" content="S"><meta property="og:image" content="https://cdn.example.org/x.svg"></head>`),
    "cdn.example.org/x.svg": () => new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } }),
    "news.example.org/pdf": () => new Response("%PDF-1.7", { headers: { "content-type": "application/pdf" } }),
    "news.example.org/500": () => new Response("err", { status: 500, headers: { "content-type": "text/html" } }),
  }, seen);
  const a = await buildPreview("https://news.example.org/a", { resolve, fetchImpl });
  assertEq(a.title, "Story", "title");
  assert(a.image && sniff(a.image) === "jpeg", "image re-encoded");
  const b = await buildPreview("https://news.example.org/internal-img", { resolve, fetchImpl });
  assertEq(b.image, null, "image on a private address skipped");
  assert(!seen.some((u) => u.includes("inner.example.org")), "never fetched the private image");
  const c = await buildPreview("https://news.example.org/svg", { resolve, fetchImpl });
  assertEq(c.image, null, "svg skipped");
  await rejects(() => buildPreview("https://news.example.org/pdf", { resolve, fetchImpl }), "not_html", "only HTML is parsed");
  await rejects(() => buildPreview("https://news.example.org/500", { resolve, fetchImpl }), "http_status", "error status");
});

Deno.test("handler: secret, input validation, claim once, stale results discard the image", async () => {
  const resolve = fakeDns({ "site.example.org": [PUBLIC], "cdn.example.org": [PUBLIC] });
  const img = await png(600, 300);
  const fetchImpl = fakeFetch({
    "site.example.org/": () => html(`<head><title>Home</title><meta property="og:image" content="https://cdn.example.org/a.png"></head>`),
    "cdn.example.org/a.png": () => new Response(img, { headers: { "content-type": "image/png" } }),
    "site.example.org/empty": () => html("<head></head>"),
  });
  const id = crypto.randomUUID();
  const state = { claims: 0, stored: [] as unknown[], uploads: [] as string[], removed: [] as string[], url: "https://site.example.org/", stale: false };
  const deps: Deps = {
    resolve, fetchImpl, secret: "s3cret",
    claim: (linkId) => Promise.resolve(linkId === id && state.claims++ === 0 ? { url: state.url } : null),
    store: (_l, _u, status, p) => { state.stored.push({ status, ...p }); return Promise.resolve(!state.stale); },
    upload: (path) => { state.uploads.push(path); return Promise.resolve(); },
    remove: (path) => { state.removed.push(path); return Promise.resolve(); },
  };
  const h = createHandler(deps);
  const call = (body: unknown, secret = "s3cret", method = "POST") =>
    h(new Request("http://x/", { method, headers: { "x-link-preview-secret": secret }, body: method === "POST" ? JSON.stringify(body) : undefined }));

  assertEq((await call({ link_id: id }, "wrong")).status, 401, "wrong secret");
  assertEq((await call({ link_id: id }, "s3cret", "GET")).status, 405, "GET");
  assertEq((await call({ link_id: "not-a-uuid" })).status, 400, "bad id");
  const r1 = await (await call({ link_id: id })).json();
  assertEq(r1.status, "ready", "first call stores");
  assertEq((state.stored[0] as { title: string }).title, "Home", "title stored");
  assert(state.uploads[0].startsWith(`${id}/`) && state.uploads[0].endsWith(".jpg"), "image path <link id>/<uuid>.jpg");
  const r2 = await (await call({ link_id: id })).json();
  assertEq(r2.status, "skipped", "second call finds nothing to claim");

  state.claims = 0;
  state.stale = true;
  const r3 = await (await call({ link_id: id })).json();
  assertEq(r3.status, "stale", "URL changed meanwhile");
  assertEq(state.removed.length, 1, "uploaded image removed again");

  state.claims = 0;
  state.stale = false;
  state.url = "https://site.example.org/empty";
  const r4 = await (await call({ link_id: id })).json();
  assertEq(r4.status, "failed", "nothing to show");
  state.claims = 0;
  state.url = "http://169.254.169.254/latest/meta-data/";
  const r5 = await (await call({ link_id: id })).json();
  assertEq(r5.status, "failed", "metadata address refused");
});
