/**
 * Bubble roles (docs/boolaa-spec.md, "Roles"; migration 20261123190000_bubble_roles.sql). The UI uses
 * these only to hide what a role can't do; the RPCs and RLS enforce the same rules.
 */
export type BubbleRole = "owner" | "admin" | "member";

export function roleOf(role: string | null | undefined): BubbleRole | null {
  return role === "owner" || role === "admin" || role === "member" ? role : null;
}

/** Edit name, description and photo, and rotate the invite code (can_manage_bubble). */
export function canManage(role: BubbleRole | null): boolean {
  return role === "owner" || role === "admin";
}

/** remove_member: the owner removes anyone else, an admin removes plain members only. */
export function canRemove(me: BubbleRole | null, target: BubbleRole | null): boolean {
  if (me === "owner") return target === "admin" || target === "member";
  if (me === "admin") return target === "member";
  return false;
}
