"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";

type ErrorKey =
  | "invalidInviteCode"
  | "alreadyMember"
  | "bubbleFull"
  | "notMember"
  | "requestNotFound"
  | "eventNotFound"
  | "onlyOwnerCanRemove"
  | "cannotRemoveSelf"
  | "memberNotFound"
  | "cannotReportYourself"
  | "reportTargetNotFound"
  | "notAuthenticated"
  | "forbidden"
  | "network"
  | "invalidCredentials"
  | "emailTaken"
  | "weakPassword"
  | "invalidEmail"
  | "tooManyRequests"
  | "invalidInput"
  | "uploadFailed"
  | "pickPhoto"
  | "generic";

type ErrorLike = { message?: unknown; code?: unknown; status?: unknown; statusCode?: unknown; name?: unknown };

/**
 * Maps Supabase / Postgres / network failures to a message key. Raw backend text is never shown:
 * anything unrecognised becomes "generic".
 */
export function errorKey(e: unknown): ErrorKey {
  if (typeof e === "string") return e === "pickPhoto" ? "pickPhoto" : "generic";
  const err = (e && typeof e === "object" ? e : {}) as ErrorLike;
  const msg = String(err.message ?? "").toLowerCase();
  const code = String(err.code ?? "");
  const status = Number(err.status ?? err.statusCode ?? 0);

  // RPC exceptions raised by the migration (exact texts).
  if (msg.includes("invalid invite code")) return "invalidInviteCode";
  if (msg.includes("already a member")) return "alreadyMember";
  if (msg.includes("bubble is full")) return "bubbleFull";
  if (msg.includes("not a member of this bubble")) return "notMember";
  if (msg.includes("request not found")) return "requestNotFound";
  if (msg.includes("event not found")) return "eventNotFound";
  if (msg.includes("only the owner can remove members")) return "onlyOwnerCanRemove";
  if (msg.includes("use leave to remove yourself")) return "cannotRemoveSelf";
  if (msg.includes("member not found")) return "memberNotFound";
  if (msg.includes("cannot report yourself")) return "cannotReportYourself";
  if (msg.includes("report target not found") || msg.includes("invalid report target")) return "reportTargetNotFound";
  if (msg.includes("not authenticated") || msg.includes("jwt expired") || code === "PGRST301") return "notAuthenticated";

  // Auth (GoTrue) errors.
  if (code === "invalid_credentials" || msg.includes("invalid login credentials")) return "invalidCredentials";
  if (code === "user_already_exists" || code === "email_exists" || msg.includes("already registered")) return "emailTaken";
  if (code === "weak_password" || msg.includes("password should be")) return "weakPassword";
  if (code === "email_address_invalid" || msg.includes("invalid format") || msg.includes("email address") && msg.includes("invalid"))
    return "invalidEmail";
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit" || status === 429) return "tooManyRequests";

  // RLS / permission failures (Postgres 42501, storage policy violations, 401/403).
  if (code === "42501" || msg.includes("row-level security") || msg.includes("permission denied") || status === 403 || status === 401)
    return "forbidden";
  // Check constraints / bad input (23514 check_violation, 22xxx data exceptions, 23502 not null).
  if (code === "23514" || code === "23502" || code.startsWith("22")) return "invalidInput";

  // Network: fetch failures surface as TypeError / AuthRetryableFetchError / StorageUnknownError.
  if (
    err.name === "AuthRetryableFetchError" ||
    msg.includes("failed to fetch") ||
    msg.includes("fetch failed") ||
    msg.includes("networkerror") ||
    msg.includes("load failed")
  )
    return "network";
  if (err.name === "StorageApiError" || err.name === "StorageUnknownError") return "uploadFailed";
  return "generic";
}

/** `const errorText = useErrorText(); setError(errorText(e))` */
export function useErrorText() {
  const t = useTranslations("errors");
  return useCallback((e: unknown) => t(errorKey(e)), [t]);
}
