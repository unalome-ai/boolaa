package com.boolaa.app.core

import com.boolaa.app.model.ReportReason
import com.boolaa.app.model.Timestamp
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.exceptions.RestException
import io.github.jan.supabase.functions.functions
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Columns
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.time.Instant

/** Terms version the clients confirm at sign-up and on the age screen (docs/auth-security.md §6). */
const val TERMS_VERSION = "2026-11-22"

/** `start_device_check` result. */
@Serializable
data class DeviceCheck(
    val status: String,
    @SerialName("needs_age_confirmation") val needsAgeConfirmation: Boolean = false,
) {
    val verified: Boolean get() = status == "verified"
}

/** A row of `list_my_devices()`. */
@Serializable
data class TrustedDevice(
    @SerialName("device_hash") val deviceHash: String,
    val label: String? = null,
    @SerialName("created_at") val createdAt: Timestamp? = null,
    @SerialName("last_seen_at") val lastSeenAt: Timestamp? = null,
)

/**
 * The caller's own `users` row fields the gate needs. Readable once the device check passes, even while suspended
 * (docs/moderation.md "What suspension does").
 */
@Serializable
data class AccountStatusRow(
    val status: String? = null,
    @SerialName("status_reason") val statusReason: String? = null,
    @SerialName("status_until") val statusUntil: Timestamp? = null,
    @SerialName("age_confirmed_at") val ageConfirmedAt: Timestamp? = null,
)

/** Why the account can't use Boolaa right now (docs/moderation.md). */
data class Suspension(val kind: Kind, val until: Instant? = null, val reason: ReportReason? = null) {
    enum class Kind {
        SUSPENDED,
        BANNED,
        /** Sign-in or token refresh answered `user_banned`: no session, so no reason or date. */
        SIGN_IN_BLOCKED,
    }

    companion object {
        val signInBlocked = Suspension(Kind.SIGN_IN_BLOCKED)

        /** Same rule as the server's `is_account_active()`: inactive = banned, or suspended with no end or an end in the future. */
        fun from(row: AccountStatusRow, now: Instant = Instant.now()): Suspension? {
            val reason = ReportReason.entries.firstOrNull { it.wire == row.statusReason }
            return when (row.status) {
                "banned" -> Suspension(Kind.BANNED, null, reason)
                "suspended" -> if (row.statusUntil != null && row.statusUntil <= now) null else Suspension(Kind.SUSPENDED, row.statusUntil, reason)
                else -> null
            }
        }
    }
}

/** The routing decision after `start_device_check` (pure, unit tested; same rules as iOS `DeviceGateDecision` and web `gateState`). */
sealed interface DeviceGateDecision {
    data object Code : DeviceGateDecision
    data object Age : DeviceGateDecision
    data class Suspended(val suspension: Suspension) : DeviceGateDecision
    data object Ok : DeviceGateDecision

    companion object {
        /**
         * @param deviceVerified `is_device_verified()`, asked only when the check said `code_required`. A `code_required`
         *   device only blocks while `device_verification_enforced` is on (the RPC is true when it's off), so nobody
         *   gets a code before the rollout switch; null (not asked, or the call failed) keeps the gate closed.
         * @param account the own `users` row, null when it couldn't be read.
         * @param isOAuthUser Google/Apple accounts never saw the sign-up checkbox, so they confirm 16+ once even before
         *   `age_confirmation_required` is on.
         */
        fun decide(
            check: DeviceCheck, deviceVerified: Boolean?, account: AccountStatusRow?, isOAuthUser: Boolean,
            now: Instant = Instant.now(),
        ): DeviceGateDecision {
            if (!check.verified && deviceVerified != true) return Code
            account?.let { Suspension.from(it, now) }?.let { return Suspended(it) }
            if (check.needsAgeConfirmation) return Age
            if (isOAuthUser && account != null && account.ageConfirmedAt == null) return Age
            return Ok
        }

        /** Whether the device check lets the session read its own row (verified, or not enforced). */
        fun gateOpen(check: DeviceCheck, deviceVerified: Boolean?): Boolean = check.verified || deviceVerified == true
    }
}

/** What a code proves: signing in on a new device, or re-confirming a sensitive action in this session. */
enum class CodePurpose(val wire: String) { DEVICE("device"), SENSITIVE_ACTION("sensitive_action") }

/** Names the action in the sensitive-action email. The backend knows `delete_account` and `generic`. */
enum class SensitiveAction(val wire: String) {
    DELETE_ACCOUNT("delete_account"), CHANGE_PASSWORD("change_password"), CHANGE_EMAIL("change_email"), EXPORT_DATA("export_data"),
    GENERIC("generic")
}

/**
 * A `device-code` Edge Function failure: HTTP [status] and its `error` code (docs/auth-security.md §3),
 * plus `attempts_left` for `invalid_code`.
 */
class DeviceCodeException(
    val status: Int, val code: String, val attemptsLeft: Int? = null,
    /** `export_rate_limited` (send step of an `export_data` code): seconds until the next export is allowed. */
    val retryAfter: Int? = null,
) :
    RuntimeException("device-code $status $code") {
    companion object {
        /** Parses the function's JSON body; anything unreadable becomes `server_error`. */
        fun from(status: Int, body: String?): DeviceCodeException {
            val obj = runCatching { BoolaaJson.json.parseToJsonElement(body.orEmpty()).jsonObject }.getOrNull()
            val code = obj?.get("error")?.jsonPrimitive?.contentOrNull ?: if (status == 401) "unauthorized" else "server_error"
            return DeviceCodeException(status, code, obj?.get("attempts_left")?.jsonPrimitive?.intOrNull,
                obj?.get("retry_after")?.jsonPrimitive?.intOrNull)
        }
    }
}

// Device verification, age, devices (supabase/migrations/20261122160000_device_verification.sql).

suspend fun BoolaaApi.startDeviceCheck(deviceId: String, label: String): DeviceCheck =
    BoolaaJson.json.decodeFromString(
        client.postgrest.rpc("start_device_check", buildJsonObject { put("p_device_id", deviceId); put("p_label", label) }).data,
    )

/** `is_device_verified()`: true when this session passed the device check, or while enforcement is off. */
suspend fun BoolaaApi.isDeviceVerified(): Boolean =
    client.postgrest.rpc("is_device_verified").data.trim() == "true"

/** The own `users` row's status fields (null when RLS hides it, i.e. the device check hasn't passed). */
suspend fun BoolaaApi.accountStatus(userId: String): AccountStatusRow? =
    client.from("users").select(Columns.list("status", "status_reason", "status_until", "age_confirmed_at")) {
        filter { eq("id", userId) }
        limit(1)
    }.decodeList<AccountStatusRow>().firstOrNull()

suspend fun BoolaaApi.listMyDevices(): List<TrustedDevice> =
    BoolaaJson.json.decodeFromString(client.postgrest.rpc("list_my_devices").data)

suspend fun BoolaaApi.revokeDevice(hash: String): Boolean =
    client.postgrest.rpc("revoke_device", buildJsonObject { put("p_device_hash", hash) }).data.trim() == "true"

suspend fun BoolaaApi.confirmAge(termsVersion: String = TERMS_VERSION) {
    client.postgrest.rpc("confirm_age", buildJsonObject { put("p_terms_version", termsVersion) })
}

// device-code Edge Function

/** Body of a `device-code` call; pure, so the wire format is unit tested. */
object DeviceCodeBody {
    fun send(purpose: CodePurpose, deviceId: String?, label: String?, action: SensitiveAction?, locale: String?): JsonObject =
        buildJsonObject {
            put("action", "send")
            put("purpose", purpose.wire)
            if (purpose == CodePurpose.DEVICE) { put("device_id", deviceId); put("label", label) }
            if (purpose == CodePurpose.SENSITIVE_ACTION) put("sensitive_action", (action ?: SensitiveAction.GENERIC).wire)
            if (locale != null) put("locale", locale)
        }

    fun verify(purpose: CodePurpose, code: String, deviceId: String?, label: String?): JsonObject = buildJsonObject {
        put("action", "verify")
        put("purpose", purpose.wire)
        put("code", code)
        if (purpose == CodePurpose.DEVICE) { put("device_id", deviceId); put("label", label) }
    }
}

/**
 * Calls `device-code`. A 401 (`unauthorized`) refreshes the session and retries once, as the contract asks;
 * a second 401 is thrown, and the caller signs out.
 */
suspend fun BoolaaApi.deviceCode(body: JsonObject) {
    suspend fun call() {
        try {
            client.functions.invoke("device-code", body)
        } catch (e: RestException) {
            throw DeviceCodeException.from(e.statusCode, e.error)
        }
    }
    try {
        call()
    } catch (e: DeviceCodeException) {
        if (e.status != 401) throw e
        runCatching { client.auth.refreshCurrentSession() }.getOrElse { throw e }
        call()
    }
}

/** GoTrue's answer for a suspended or banned account (docs/moderation.md), as the web `/auth/callback` reads it. */
object UserBanned {
    /** `error_code=user_banned` or `error_description=User is banned` in an auth callback's query or fragment. */
    fun inCallback(uri: String?): Boolean {
        if (uri == null) return false
        val params = uri.substringAfter('?', "").substringBefore('#').split('&') + uri.substringAfter('#', "").split('&')
        return params.any { p ->
            val key = p.substringBefore('=')
            val value = runCatching { java.net.URLDecoder.decode(p.substringAfter('=', ""), "UTF-8") }.getOrDefault("")
            (key == "error_code" || key == "error_description" || key == "error") &&
                (value == "user_banned" || value.contains("user is banned", ignoreCase = true))
        }
    }
}
