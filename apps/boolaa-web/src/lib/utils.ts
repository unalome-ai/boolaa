import { type ImageBucket, prepareImage } from "@/lib/image";
import type { BoolaaClient } from "@/lib/supabase/client";

export const BUBBLE_COOKIE = "boolaa_bubble";

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export function initials(name?: string | null) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

export function writeCookie(name: string, value: string, maxAgeDays = 365) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeDays * 86400}; samesite=lax`;
}

/** ISO -> value for <input type="datetime-local"> in local time. */
export function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export type { ImageBucket } from "@/lib/image";

/**
 * Resizes and re-encodes the picked file (lib/image.ts: upright, no EXIF/GPS, JPEG), uploads it to
 * `<folder>/<uuid>.jpg` and returns the public URL. The folder is required by storage policy: the
 * user's id, except in `bubble.images`, where it is the bubble's id (the photo belongs to the bubble).
 */
export async function uploadImage(supabase: BoolaaClient, bucket: ImageBucket, folderId: string, file: Blob) {
  const jpeg = await prepareImage(file, bucket);
  const path = `${folderId}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from(bucket).upload(path, jpeg, { contentType: "image/jpeg", upsert: false });
  if (error) throw error;
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/** Best-effort removal of an image we uploaded earlier (ignores external URLs). */
export async function removeImage(supabase: BoolaaClient, bucket: ImageBucket, publicUrl: string | null | undefined) {
  if (!publicUrl) return;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const i = publicUrl.indexOf(marker);
  if (i < 0) return;
  await supabase.storage.from(bucket).remove([decodeURIComponent(publicUrl.slice(i + marker.length))]);
}

/** Full page load (not client navigation) so the proxy re-evaluates auth cookies and gating. */
export function hardNavigate(path: string) {
  window.location.assign(new URL(path, window.location.origin).toString());
}

/**
 * Where the app goes after a sign-out event (account deletion goes to the landing page instead).
 * `leaving` is set while the user is signing out or deleting their account, so live membership
 * changes caused by that (e.g. cascaded bubble_members deletes) do not trigger their own navigation.
 */
export const signOutTarget: { path: string; leaving: boolean } = { path: "/login", leaving: false };
