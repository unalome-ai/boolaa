"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { hardNavigate } from "@/lib/utils";

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
  | "imageTooLarge"
  | "imageUnsupported"
  | "sessionNotVerified"
  | "ageConfirmationRequired"
  | "reauthenticationRequired"
  | "invalidDeviceId"
  | "invalidTermsVersion"
  | "codeWrong"
  | "codeWrongOrExpired"
  | "codeFormat"
  | "codeExpired"
  | "noActiveCode"
  | "tooManyCodeAttempts"
  | "tooManyCodes"
  | "emailSendFailed"
  | "emailRateLimited"
  | "samePassword"
  | "oauthFailed"
  | "generic";

/** Messages that take an argument: `codeWrong` shows how many tries are left. */
type ErrorArgs = { count?: number };

type ErrorLike = { message?: unknown; code?: unknown; status?: unknown; statusCode?: unknown; name?: unknown; attemptsLeft?: unknown };

/** `device-code` Edge Function `error` codes (docs/auth-security.md §3). */
const DEVICE_CODE_ERRORS: Record<string, ErrorKey> = {
  invalid_request: "codeFormat",
  invalid_code: "codeWrong",
  unauthorized: "notAuthenticated",
  session_not_verified: "sessionNotVerified",
  no_active_code: "noActiveCode",
  code_expired: "codeExpired",
  too_many_attempts: "tooManyCodeAttempts",
  rate_limited: "tooManyCodes",
  email_failed: "emailSendFailed",
  server_error: "generic",
};

/** Errors that mean "this session must pass the device / age gate first" (run it again). */
export function isGateError(e: unknown) {
  const key = errorKey(e);
  return key === "sessionNotVerified" || key === "ageConfirmationRequired";
}

/**
 * Maps Supabase / Postgres / network failures to a message key. Raw backend text is never shown:
 * anything unrecognised becomes "generic".
 */
export function errorKey(e: unknown): ErrorKey {
  if (typeof e === "string") return e === "pickPhoto" || e === "oauthFailed" || e === "codeFormat" ? (e as ErrorKey) : "generic";
  const err = (e && typeof e === "object" ? e : {}) as ErrorLike;
  const msg = String(err.message ?? "").toLowerCase();
  const code = String(err.code ?? "");
  const status = Number(err.status ?? err.statusCode ?? 0);

  if (err.name === "DeviceCodeError") return DEVICE_CODE_ERRORS[code] ?? "generic";
  // Image pipeline (lib/image.ts) and the bucket limits (20261123100000_image_limits.sql). Storage
  // answers HTTP 400 locally / 413 or 415 hosted, with statusCode "413" EntityTooLarge or "415" InvalidMimeType.
  if (err.name === "ImageError") return code === "imageTooLarge" ? "imageTooLarge" : "imageUnsupported";
  const storageCode = String(err.statusCode ?? "");
  if (storageCode === "413" || status === 413 || code === "EntityTooLarge" || msg.includes("exceeded the maximum allowed size"))
    return "imageTooLarge";
  if (storageCode === "415" || status === 415 || code === "InvalidMimeType" || /mime type .* is not supported/.test(msg))
    return "imageUnsupported";

  // Auth-security exceptions (exact texts; docs/auth-security.md §3). Sign-up's "age confirmation
  // required" comes from the before-user-created hook with the same text.
  if (msg.includes("session not verified")) return "sessionNotVerified";
  if (msg.includes("age confirmation required")) return "ageConfirmationRequired";
  if (msg.includes("reauthentication required") || code === "reauthentication_needed") return "reauthenticationRequired";
  if (msg.includes("invalid device id")) return "invalidDeviceId";
  if (msg.includes("invalid terms version")) return "invalidTermsVersion";
  if (code === "otp_expired" || code === "reauthentication_not_valid" || msg.includes("token has expired or is invalid"))
    return "codeWrongOrExpired";
  if (code === "over_email_send_rate_limit" || msg.includes("email rate limit") || msg.includes("for security purposes, you can only request"))
    return "emailRateLimited";
  if (code === "same_password") return "samePassword";

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
  if (code === "over_request_rate_limit" || status === 429) return "tooManyRequests";

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

/** Pages where a gate error is shown in place (signed out, or already the gate). */
const GATE_FREE = ["/verify", "/login", "/register", "/forgot-password", "/auth"];

function errorArgs(e: unknown): ErrorArgs {
  const left = e && typeof e === "object" ? Number((e as ErrorLike).attemptsLeft) : NaN;
  return Number.isFinite(left) ? { count: left } : { count: 0 };
}

/** `const errorText = useErrorText(); setError(errorText(e))` */
export function useErrorText() {
  const t = useTranslations("errors");
  return useCallback(
    (e: unknown) => {
      const key = errorKey(e);
      if (key === "codeWrong") return t(key, errorArgs(e));
      // Another device revoked this one, or the age gate went live: run the device gate again.
      if ((key === "sessionNotVerified" || key === "ageConfirmationRequired") && typeof window !== "undefined") {
        const path = window.location.pathname;
        if (!GATE_FREE.some((p) => path === p || path.startsWith(`${p}/`)))
          window.setTimeout(() => hardNavigate(`/verify?next=${encodeURIComponent(path)}`), 1200);
      }
      return t(key);
    },
    [t],
  );
}
