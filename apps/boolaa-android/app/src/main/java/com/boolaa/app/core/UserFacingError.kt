package com.boolaa.app.core

import androidx.annotation.StringRes
import com.boolaa.app.R
import io.github.jan.supabase.auth.exception.AuthErrorCode
import io.github.jan.supabase.auth.exception.AuthRestException
import io.github.jan.supabase.exceptions.HttpRequestException
import io.github.jan.supabase.exceptions.RestException
import io.github.jan.supabase.postgrest.exception.PostgrestRestException
import io.ktor.client.plugins.HttpRequestTimeoutException
import java.io.IOException
import kotlin.coroutines.cancellation.CancellationException

/**
 * Maps backend, auth and network failures to translated messages (docs/i18n-glossary.md, "Backend errors").
 * Raw Postgres / GoTrue English is never shown to the user.
 */
enum class UserFacingError(@param:StringRes val message: Int) {
    INVALID_INVITE_CODE(R.string.error_invalid_invite_code),
    ALREADY_MEMBER(R.string.error_already_member),
    BUBBLE_FULL(R.string.error_bubble_full),
    NOT_MEMBER(R.string.error_not_member),
    REQUEST_NOT_FOUND(R.string.error_request_not_found),
    EVENT_NOT_FOUND(R.string.error_event_not_found),
    ONLY_OWNER_CAN_REMOVE(R.string.error_only_owner_can_remove),
    CANNOT_REMOVE_SELF(R.string.error_cannot_remove_self),
    MEMBER_NOT_FOUND(R.string.error_member_not_found),
    CANNOT_REPORT_SELF(R.string.error_cannot_report_self),
    REPORT_TARGET_NOT_FOUND(R.string.error_report_target_not_found),
    NOT_AUTHENTICATED(R.string.error_not_authenticated),
    PERMISSION_DENIED(R.string.error_permission_denied),
    INVALID_CREDENTIALS(R.string.error_invalid_credentials),
    EMAIL_TAKEN(R.string.error_email_taken),
    WEAK_PASSWORD(R.string.error_weak_password),
    NETWORK(R.string.error_network),
    GENERIC(R.string.error_generic);

    companion object {
        /** Classifies any error thrown by supabase-kt, Ktor or OkHttp. */
        fun classify(error: Throwable): UserFacingError = when (error) {
            is CancellationException -> GENERIC
            is AuthRestException -> when (error.errorCode) {
                AuthErrorCode.InvalidCredentials -> INVALID_CREDENTIALS
                AuthErrorCode.UserAlreadyExists, AuthErrorCode.EmailExists -> EMAIL_TAKEN
                AuthErrorCode.WeakPassword -> WEAK_PASSWORD
                AuthErrorCode.SessionNotFound, AuthErrorCode.SessionExpired -> NOT_AUTHENTICATED
                else -> classify(error.error + " " + error.errorDescription, null) ?: GENERIC
            }
            is PostgrestRestException -> classify(error.error, error.code) ?: GENERIC
            is RestException -> classify(error.error + " " + (error.description ?: ""), null)
                ?: if (error.statusCode == 401) NOT_AUTHENTICATED else GENERIC
            is HttpRequestException, is HttpRequestTimeoutException, is IOException -> NETWORK
            else -> classify(error.message ?: "", null) ?: GENERIC
        }

        /** Matches the exception texts raised by the RPCs in the migration, plus auth and RLS failures. */
        fun classify(message: String, code: String?): UserFacingError? {
            val text = message.lowercase()
            val table = listOf(
                "invalid invite code" to INVALID_INVITE_CODE,
                "already a member" to ALREADY_MEMBER,
                "bubble is full" to BUBBLE_FULL,
                "not a member of this bubble" to NOT_MEMBER,
                "request not found" to REQUEST_NOT_FOUND,
                "event not found" to EVENT_NOT_FOUND,
                "only the owner can remove members" to ONLY_OWNER_CAN_REMOVE,
                "use leave to remove yourself" to CANNOT_REMOVE_SELF,
                "member not found" to MEMBER_NOT_FOUND,
                "cannot report yourself" to CANNOT_REPORT_SELF,
                "report target not found" to REPORT_TARGET_NOT_FOUND,
                "not authenticated" to NOT_AUTHENTICATED,
                "jwt expired" to NOT_AUTHENTICATED,
                "invalid login credentials" to INVALID_CREDENTIALS,
                "user already registered" to EMAIL_TAKEN,
                "password should be" to WEAK_PASSWORD,
                "row-level security" to PERMISSION_DENIED,
                "permission denied" to PERMISSION_DENIED,
            )
            table.firstOrNull { text.contains(it.first) }?.let { return it.second }
            if (code == "42501") return PERMISSION_DENIED
            return null
        }
    }
}
