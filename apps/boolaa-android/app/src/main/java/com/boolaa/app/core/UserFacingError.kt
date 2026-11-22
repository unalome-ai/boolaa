package com.boolaa.app.core

import androidx.annotation.StringRes
import com.boolaa.app.R
import io.github.jan.supabase.auth.exception.AuthErrorCode
import io.github.jan.supabase.auth.exception.AuthRestException
import io.github.jan.supabase.exceptions.HttpRequestException
import io.github.jan.supabase.exceptions.RestException
import io.github.jan.supabase.postgrest.exception.PostgrestRestException
import io.github.jan.supabase.storage.StorageRestException
import io.ktor.client.plugins.HttpRequestTimeoutException
import java.io.IOException
import kotlin.coroutines.cancellation.CancellationException

/**
 * Maps backend, auth and network failures to translated messages (docs/i18n-glossary.md, "Backend errors").
 * Raw Postgres / GoTrue English is never shown to the user.
 */
enum class UserFacingError(@param:StringRes val message: Int) {
    INVALID_INVITE_CODE(R.string.error_invalid_invite_code),
    // Invite links (20261123140000_invite_links.sql): too many unknown codes in an hour; rotation is owner-only.
    TOO_MANY_INVITE_ATTEMPTS(R.string.error_too_many_invite_attempts),
    ONLY_OWNER_CAN_ROTATE(R.string.error_only_owner_can_rotate),
    ALREADY_MEMBER(R.string.error_already_member),
    BUBBLE_FULL(R.string.error_bubble_full),
    NOT_MEMBER(R.string.error_not_member),
    REQUEST_NOT_FOUND(R.string.error_request_not_found),
    EVENT_NOT_FOUND(R.string.error_event_not_found),
    ONLY_OWNER_CAN_REMOVE(R.string.error_only_owner_can_remove),
    // Bubble roles (20261123190000_bubble_roles.sql): what admins can't do (remove admins, transfer, change roles).
    OWNER_ONLY_ACTION(R.string.error_owner_only_action),
    CANNOT_REMOVE_SELF(R.string.error_cannot_remove_self),
    MEMBER_NOT_FOUND(R.string.error_member_not_found),
    CANNOT_REPORT_SELF(R.string.error_cannot_report_self),
    REPORT_TARGET_NOT_FOUND(R.string.error_report_target_not_found),
    // Chat (20261123120000_chat_improvements.sql): delete_chat_message / mark_chat_read on a message that is gone.
    CHAT_MESSAGE_GONE(R.string.error_chat_message_gone),
    NOT_AUTHENTICATED(R.string.error_not_authenticated),
    PERMISSION_DENIED(R.string.error_permission_denied),
    INVALID_CREDENTIALS(R.string.error_invalid_credentials),
    EMAIL_TAKEN(R.string.error_email_taken),
    WEAK_PASSWORD(R.string.error_weak_password),
    NETWORK(R.string.error_network),
    // Auth security (docs/auth-security.md §3): RPC texts, device-code function codes and GoTrue codes.
    SESSION_NOT_VERIFIED(R.string.error_session_not_verified),
    AGE_CONFIRMATION_REQUIRED(R.string.error_age_confirmation_required),
    REAUTHENTICATION_REQUIRED(R.string.error_reauthentication_required),
    INVALID_DEVICE_ID(R.string.error_invalid_device_id),
    INVALID_TERMS_VERSION(R.string.error_invalid_terms_version),
    CODE_FORMAT(R.string.error_code_format),
    CODE_WRONG(R.string.error_code_wrong),
    CODE_WRONG_OR_EXPIRED(R.string.error_code_wrong_or_expired),
    CODE_EXPIRED(R.string.error_code_expired),
    NO_ACTIVE_CODE(R.string.error_no_active_code),
    TOO_MANY_ATTEMPTS(R.string.error_too_many_attempts),
    TOO_MANY_CODES(R.string.error_too_many_codes),
    EMAIL_RATE_LIMITED(R.string.error_email_rate_limited),
    EMAIL_SEND_FAILED(R.string.error_email_send_failed),
    SAME_PASSWORD(R.string.error_same_password),
    INVALID_EMAIL(R.string.error_invalid_email),
    GOOGLE_NO_ACCOUNT(R.string.error_google_no_account),
    SIGN_IN_PROVIDER_FAILED(R.string.error_sign_in_provider_failed),
    SIGN_IN_PROVIDER_UNAVAILABLE(R.string.error_sign_in_provider_unavailable),
    // Moderation (docs/moderation.md): RPCs raise "account suspended"; GoTrue answers `user_banned` at sign-in/refresh.
    ACCOUNT_SUSPENDED(R.string.error_account_suspended),
    USER_BANNED(R.string.error_user_banned),
    // Images: ImageCompression and the bucket limits (20261123100000_image_limits.sql).
    IMAGE_TOO_LARGE(R.string.error_image_too_large),
    IMAGE_UNSUPPORTED(R.string.error_image_unsupported),
    // "Download my data": data-export answers 429 export_rate_limited (one export an hour).
    EXPORT_RATE_LIMITED(R.string.error_export_rate_limited),
    GENERIC(R.string.error_generic);

    companion object {
        /** Classifies any error thrown by supabase-kt, Ktor or OkHttp. */
        fun classify(error: Throwable): UserFacingError = when (error) {
            is CancellationException -> GENERIC
            is DeviceCodeException -> fromFunctionCode(error.code)
            is DataExportException -> DataExport.userError(error.code)
            is SocialSignInException -> error.kind
            is ImageCompression.ImageException -> if (error.tooLarge) IMAGE_TOO_LARGE else IMAGE_UNSUPPORTED
            is StorageRestException -> fromStorage(error.statusCode, error.code, error.error, error.description)
            is AuthRestException -> when (error.errorCode) {
                AuthErrorCode.InvalidCredentials -> INVALID_CREDENTIALS
                AuthErrorCode.UserAlreadyExists, AuthErrorCode.EmailExists -> EMAIL_TAKEN
                AuthErrorCode.WeakPassword -> WEAK_PASSWORD
                AuthErrorCode.SessionNotFound, AuthErrorCode.SessionExpired -> NOT_AUTHENTICATED
                AuthErrorCode.OtpExpired, AuthErrorCode.ReauthenticationNotValid -> CODE_WRONG_OR_EXPIRED
                AuthErrorCode.ReauthenticationNeeded, AuthErrorCode.ReauthNonceMissing -> REAUTHENTICATION_REQUIRED
                AuthErrorCode.OverEmailSendRateLimit -> EMAIL_RATE_LIMITED
                AuthErrorCode.OverRequestRateLimit -> TOO_MANY_CODES
                AuthErrorCode.SamePassword -> SAME_PASSWORD
                AuthErrorCode.EmailAddressInvalid -> INVALID_EMAIL
                AuthErrorCode.UserBanned -> USER_BANNED
                AuthErrorCode.ProviderDisabled, AuthErrorCode.OauthProviderNotSupported -> SIGN_IN_PROVIDER_UNAVAILABLE
                AuthErrorCode.BadOauthState, AuthErrorCode.BadOauthCallback, AuthErrorCode.BadCodeVerifier,
                AuthErrorCode.FlowStateNotFound, AuthErrorCode.FlowStateExpired, AuthErrorCode.UnexpectedAudience -> SIGN_IN_PROVIDER_FAILED
                else -> classify(error.error + " " + error.errorDescription, null) ?: GENERIC
            }
            is PostgrestRestException -> classify(error.error, error.code) ?: GENERIC
            is RestException -> classify(error.error + " " + (error.description ?: ""), null)
                ?: if (error.statusCode == 401) NOT_AUTHENTICATED else GENERIC
            is HttpRequestException, is HttpRequestTimeoutException, is IOException -> NETWORK
            else -> classify(error.message ?: "", null) ?: GENERIC
        }

        /**
         * Storage upload failures. The bucket limits answer statusCode 413 (code EntityTooLarge, "The object exceeded
         * the maximum allowed size") or 415 (code InvalidMimeType, error `invalid_mime_type`).
         */
        fun fromStorage(statusCode: Int, code: String?, error: String?, message: String?): UserFacingError {
            val text = "${error.orEmpty()} ${message.orEmpty()}".lowercase()
            return when {
                statusCode == 413 || code == "EntityTooLarge" || "exceeded the maximum allowed size" in text -> IMAGE_TOO_LARGE
                statusCode == 415 || code == "InvalidMimeType" || "invalid_mime_type" in text ||
                    ("mime type" in text && "not supported" in text) -> IMAGE_UNSUPPORTED
                else -> classify(text, null) ?: GENERIC
            }
        }

        /** `device-code` Edge Function `error` codes (docs/auth-security.md §3). */
        fun fromFunctionCode(code: String): UserFacingError = when (code) {
            "invalid_request" -> CODE_FORMAT
            "invalid_code" -> CODE_WRONG
            "unauthorized" -> NOT_AUTHENTICATED
            "session_not_verified" -> SESSION_NOT_VERIFIED
            "no_active_code" -> NO_ACTIVE_CODE
            "code_expired" -> CODE_EXPIRED
            "too_many_attempts" -> TOO_MANY_ATTEMPTS
            "rate_limited" -> TOO_MANY_CODES
            "email_failed" -> EMAIL_SEND_FAILED
            else -> GENERIC
        }

        /** Matches the exception texts raised by the RPCs in the migration, plus auth and RLS failures. */
        fun classify(message: String, code: String?): UserFacingError? {
            val text = message.lowercase()
            val table = listOf(
                "invalid invite code" to INVALID_INVITE_CODE,
                "too many attempts" to TOO_MANY_INVITE_ATTEMPTS,
                "only the owner can change the invite code" to ONLY_OWNER_CAN_ROTATE,
                "already a member" to ALREADY_MEMBER,
                "bubble is full" to BUBBLE_FULL,
                "not a member of this bubble" to NOT_MEMBER,
                "request not found" to REQUEST_NOT_FOUND,
                "event not found" to EVENT_NOT_FOUND,
                "only the owner can remove members" to ONLY_OWNER_CAN_REMOVE,
                "only the owner can remove admins" to OWNER_ONLY_ACTION,
                "only the owner can transfer ownership" to OWNER_ONLY_ACTION,
                "only the owner can change roles" to OWNER_ONLY_ACTION,
                "use leave to remove yourself" to CANNOT_REMOVE_SELF,
                "member not found" to MEMBER_NOT_FOUND,
                "cannot report yourself" to CANNOT_REPORT_SELF,
                "report target not found" to REPORT_TARGET_NOT_FOUND,
                "message not found" to CHAT_MESSAGE_GONE,
                "session not verified" to SESSION_NOT_VERIFIED,
                "age confirmation required" to AGE_CONFIRMATION_REQUIRED,
                "reauthentication required" to REAUTHENTICATION_REQUIRED,
                "invalid device id" to INVALID_DEVICE_ID,
                "invalid terms version" to INVALID_TERMS_VERSION,
                "account suspended" to ACCOUNT_SUSPENDED,
                "user_banned" to USER_BANNED,
                "user is banned" to USER_BANNED,
                "not authenticated" to NOT_AUTHENTICATED,
                "jwt expired" to NOT_AUTHENTICATED,
                "invalid login credentials" to INVALID_CREDENTIALS,
                "user already registered" to EMAIL_TAKEN,
                "should be different from the old password" to SAME_PASSWORD,
                "password should be" to WEAK_PASSWORD,
                "token has expired or is invalid" to CODE_WRONG_OR_EXPIRED,
                "email rate limit exceeded" to EMAIL_RATE_LIMITED,
                "for security purposes, you can only request this after" to EMAIL_RATE_LIMITED,
                "unable to validate email address" to INVALID_EMAIL,
                "row-level security" to PERMISSION_DENIED,
                "permission denied" to PERMISSION_DENIED,
            )
            table.firstOrNull { text.contains(it.first) }?.let { return it.second }
            if (code == "42501") return PERMISSION_DENIED
            return null
        }
    }
}

/** Google or Apple sign-in failed on the device (no account, provider off) before or after reaching Supabase. */
class SocialSignInException(val kind: UserFacingError, cause: Throwable? = null) : RuntimeException(kind.name, cause)
