// link-preview: called by the AFTER INSERT/UPDATE OF url trigger on public.shared_links (pg_net)
// with {"link_id": "..."}. Claims the link (pending -> fetching), fetches the page through the SSRF
// guard, extracts Open Graph text, copies the image into the public `link.previews` bucket as a
// re-encoded JPEG, and stores the result. docs/boolaa-spec.md, "Link previews".
import { type FetchImpl, GuardError, readCapped, type Resolver, safeFetch } from "./guard.ts";
import { decodeHtml, isHtml, LIMITS, parseOpenGraph } from "./og.ts";
import { IMAGE_MAX_BYTES, ImageRejected, toPreviewJpeg } from "./image.ts";

export const HTML_MAX_BYTES = 512 * 1024; // the head is all we need; longer pages are cut
export const PAGE_TIMEOUT_MS = 8000;
export const IMAGE_TIMEOUT_MS = 6000;

export interface PreviewResult {
  title: string | null;
  description: string | null;
  siteName: string | null;
  image: Uint8Array | null;
}

export interface Deps {
  resolve?: Resolver;
  fetchImpl?: FetchImpl;
  claim(linkId: string): Promise<{ url: string } | null>;
  store(linkId: string, url: string, status: "ready" | "failed", p?: Omit<PreviewResult, "image"> & { imagePath: string | null }): Promise<boolean>;
  upload(path: string, jpeg: Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
  secret?: string;
  log?: (msg: string) => void;
}

/** Fetches and parses one page. Throws GuardError / Error when there is no usable page. */
export async function buildPreview(url: string, deps: Pick<Deps, "resolve" | "fetchImpl" | "log">): Promise<PreviewResult> {
  const { res, url: finalUrl } = await safeFetch(url, {
    resolve: deps.resolve,
    fetchImpl: deps.fetchImpl,
    signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
  });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new GuardError("http_status", `HTTP ${res.status}`);
  }
  const type = res.headers.get("content-type");
  if (!isHtml(type)) {
    await res.body?.cancel().catch(() => {});
    throw new GuardError("not_html");
  }
  const html = decodeHtml(await readCapped(res, HTML_MAX_BYTES, true), type);
  const og = parseOpenGraph(html, finalUrl.href);

  let image: Uint8Array | null = null;
  if (og.imageUrl) {
    try {
      const { res: ir } = await safeFetch(og.imageUrl, {
        resolve: deps.resolve,
        fetchImpl: deps.fetchImpl,
        signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
        accept: "image/jpeg,image/png,image/webp,image/gif;q=0.8",
      });
      if (!ir.ok || !(ir.headers.get("content-type") ?? "").toLowerCase().startsWith("image/")) {
        await ir.body?.cancel().catch(() => {});
        throw new ImageRejected("not an image response");
      }
      image = await toPreviewJpeg(await readCapped(ir, IMAGE_MAX_BYTES, false));
    } catch (e) {
      deps.log?.(`image skipped: ${(e as Error).message}`);
      image = null; // a preview without an image is still a preview
    }
  }
  return { title: og.title, description: og.description, siteName: og.siteName, image };
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const enc = new TextEncoder();
function timingSafeEqual(a: string, b: string): boolean {
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
    // Optional shared secret (production sets it). Without it the endpoint is still harmless:
    // it only fetches a link that is waiting for its preview, once.
    if (deps.secret && !timingSafeEqual(req.headers.get("x-link-preview-secret") ?? "", deps.secret)) {
      return json(401, { error: "unauthorized" });
    }
    let linkId: unknown;
    try {
      linkId = (await req.json()).link_id;
    } catch {
      return json(400, { error: "invalid_request" });
    }
    if (typeof linkId !== "string" || !UUID.test(linkId)) return json(400, { error: "invalid_request" });

    const claimed = await deps.claim(linkId);
    if (!claimed) return json(200, { status: "skipped" });

    let preview: PreviewResult;
    try {
      preview = await buildPreview(claimed.url, deps);
    } catch (e) {
      deps.log?.(`preview failed: ${e instanceof GuardError ? e.code : (e as Error).name}`);
      await deps.store(linkId, claimed.url, "failed");
      return json(200, { status: "failed" });
    }
    if (!preview.title && !preview.description && !preview.image) {
      await deps.store(linkId, claimed.url, "failed");
      return json(200, { status: "failed" });
    }

    let imagePath: string | null = null;
    if (preview.image) {
      const path = `${linkId.toLowerCase()}/${crypto.randomUUID()}.jpg`;
      try {
        await deps.upload(path, preview.image);
        imagePath = path;
      } catch (e) {
        deps.log?.(`upload failed: ${(e as Error).message}`);
      }
    }
    const stored = await deps.store(linkId, claimed.url, "ready", {
      title: preview.title?.slice(0, LIMITS.title) ?? null,
      description: preview.description,
      siteName: preview.siteName,
      imagePath,
    });
    if (!stored && imagePath) await deps.remove(imagePath).catch(() => {});
    return json(200, { status: stored ? "ready" : "stale" });
  };
}
