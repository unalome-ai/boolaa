"use client";

/**
 * Private photos (docs/boolaa-spec.md "Images", migration 20261123210000_private_photos.sql).
 *
 * Every photo bucket is private. Rows keep the `/storage/v1/object/public/<bucket>/<path>` form of a
 * photo (users.avatar, food_posts.image, market_items.image, bubbles.logo) only as its identifier;
 * the browser never loads that URL. Instead every <img> goes through useSignedUrl(), which:
 *   - batches: every photo asked for in the same tick is signed with ONE createSignedUrls call per
 *     bucket (a list renders N photos, the server sees one request);
 *   - caches per storage path (not per signed URL), so the same signed URL is reused until it is
 *     close to expiry: the browser cache keeps the bytes and refreshes don't re-download;
 *   - refreshes before expiry (a timer re-signs SIGNED_URL_REFRESH_MS early) and after a load
 *     failure (onError drops the cached URL and signs once more).
 * URLs that aren't ours (seed Unsplash photos, blob: previews) pass through unchanged.
 */
import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";

export const PHOTO_BUCKETS = ["avatars", "food.images", "market.images", "bubble.images", "link.previews", "chat.images"] as const;
export type PhotoBucket = (typeof PHOTO_BUCKETS)[number];
/** Signed URLs live an hour; they're re-signed 5 minutes before that. */
export const SIGNED_URL_TTL_S = 3600;
const SIGNED_URL_REFRESH_MS = 5 * 60 * 1000;

export type StorageRef = { bucket: PhotoBucket; path: string };

/** The stored (identifier) form of an object, as rows keep it; useSignedUrl() turns it into a signed URL. */
export const storageUrlOf = (bucket: PhotoBucket, path: string) => `/storage/v1/object/public/${bucket}/${path}`;

/** The bucket and path behind one of our storage URLs (public or signed form); null for anything else. */
export function storageRef(url: string | null | undefined): StorageRef | null {
  if (!url) return null;
  const m = /\/storage\/v1\/object\/(?:public|sign)\/([^/?#]+)\/([^?#]+)/.exec(url);
  if (!m || !(PHOTO_BUCKETS as readonly string[]).includes(m[1])) return null;
  const path = decodeURIComponent(m[2]);
  if (path.includes("..")) return null;
  return { bucket: m[1] as PhotoBucket, path };
}

type Entry = { url: string; until: number };
const cache = new Map<string, Entry>();
const pending = new Map<PhotoBucket, Map<string, ((url: string | null) => void)[]>>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const keyOf = (r: StorageRef) => `${r.bucket}\n${r.path}`;

function cached(r: StorageRef): Entry | null {
  const hit = cache.get(keyOf(r));
  return hit && hit.until > Date.now() ? hit : null;
}

async function flush() {
  flushTimer = null;
  const batches = [...pending];
  pending.clear();
  const supabase = getSupabase();
  for (const [bucket, waiting] of batches) {
    const paths = [...waiting.keys()];
    const now = Date.now();
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      const got = new Map<string, string>();
      try {
        const { data } = await supabase.storage.from(bucket).createSignedUrls(chunk, SIGNED_URL_TTL_S);
        for (const r of data ?? []) if (r.path && r.signedUrl && !r.error) got.set(r.path, r.signedUrl);
      } catch {
        // Offline or refused: the images show their fallback and retry on the next render.
      }
      for (const p of chunk) {
        const url = got.get(p) ?? null;
        if (url) cache.set(`${bucket}\n${p}`, { url, until: now + SIGNED_URL_TTL_S * 1000 - SIGNED_URL_REFRESH_MS });
        for (const resolve of waiting.get(p) ?? []) resolve(url);
      }
    }
  }
}

/** A signed URL for one object, batched with every other request made in the same tick. */
export function signRef(r: StorageRef): Promise<string | null> {
  const hit = cached(r);
  if (hit) return Promise.resolve(hit.url);
  return new Promise((resolve) => {
    let byPath = pending.get(r.bucket);
    if (!byPath) pending.set(r.bucket, (byPath = new Map()));
    byPath.set(r.path, [...(byPath.get(r.path) ?? []), resolve]);
    flushTimer ??= setTimeout(flush, 0);
  });
}

/** Signed URLs for several paths of one bucket (chat photos), keyed by path. Unreadable paths are left out. */
export async function signPaths(bucket: PhotoBucket, paths: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    [...new Set(paths)].map(async (path) => {
      const url = await signRef({ bucket, path });
      if (url) out[path] = url;
    }),
  );
  return out;
}

/** Forget a path's signed URL (its image failed to load: expired, or access changed). */
export function dropSigned(r: StorageRef) {
  cache.delete(keyOf(r));
}

/**
 * What an <img> should load for a stored photo URL: the signed URL for our storage objects (undefined
 * while signing, or when the caller may not read it), the URL itself for anything else.
 * `onError` goes on the <img>: it re-signs once after a failed load.
 */
export function useSignedUrl(src: string | null | undefined): { url: string | undefined; onError: () => void } {
  const ref = storageRef(src);
  const key = ref ? keyOf(ref) : null;
  const [state, setState] = useState<{ key: string | null; url: string | undefined; retried: boolean }>(() => ({
    key,
    url: ref ? cached(ref)?.url : undefined,
    retried: false,
  }));
  const [generation, setGeneration] = useState(0);
  const current = state.key === key ? state : { key, url: ref ? cached(ref)?.url : undefined, retried: false };

  useEffect(() => {
    if (!key) return;
    const r = storageRef(src)!;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      signRef(r).then((url) => {
        if (!alive) return;
        setState((s) => (s.key === key && s.url === (url ?? undefined) ? s : { key, url: url ?? undefined, retried: s.key === key && s.retried }));
        const hit = cached(r);
        if (hit) timer = setTimeout(run, Math.max(1000, hit.until - Date.now()));
      });
    };
    run();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
    // `src` maps to `key`; generation re-runs after a load failure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, generation]);

  const onError = useCallback(() => {
    const r = storageRef(src);
    if (!r || current.retried) return;
    dropSigned(r);
    setState({ key, url: undefined, retried: true });
    setGeneration((g) => g + 1);
  }, [src, key, current.retried]);

  return { url: ref ? current.url : (src ?? undefined), onError };
}
