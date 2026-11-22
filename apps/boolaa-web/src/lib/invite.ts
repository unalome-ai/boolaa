import { SITE_URL } from "@/lib/site";

/**
 * Invite links (docs/boolaa-spec.md, "Invite links"): https://boolaa.ro/join/CODE, where CODE is the
 * bubble's invite code. The apps open /join/* (universal links / App Links, lib/app-links.ts).
 */

/** Remembers the code while a signed-out visitor signs in or registers (email confirmation may take a while). */
export const PENDING_INVITE_COOKIE = "boolaa_invite";

/** Same as public.normalize_invite_code: upper-case, letters and digits only. */
export function normalizeInviteCode(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/** 4-32 letters/digits after normalising; anything else can't be a code. */
export function isPlausibleInviteCode(code: string): boolean {
  return /^[A-Z0-9]{4,32}$/.test(code);
}

export function invitePath(code: string): string {
  return `/join/${encodeURIComponent(normalizeInviteCode(code))}`;
}

/** Absolute link to share. Always the public site (the apps only claim boolaa.ro links). */
export function inviteUrl(code: string): string {
  return `${SITE_URL}${invitePath(code)}`;
}

/** "/login?next=/join/CODE" and friends: where to go after sign-in. */
export function withNext(path: string, next: string | null): string {
  return next ? `${path}?next=${encodeURIComponent(next)}` : path;
}
