package com.boolaa.app.core

import com.boolaa.app.model.Timestamp
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.exceptions.RestException
import io.github.jan.supabase.functions.functions
import io.github.jan.supabase.postgrest.postgrest
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

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

/** What a code proves: signing in on a new device, or re-confirming a sensitive action in this session. */
enum class CodePurpose(val wire: String) { DEVICE("device"), SENSITIVE_ACTION("sensitive_action") }

/** Names the action in the sensitive-action email. The backend knows `delete_account` and `generic`. */
enum class SensitiveAction(val wire: String) { DELETE_ACCOUNT("delete_account"), GENERIC("generic") }

/**
 * A `device-code` Edge Function failure: HTTP [status] and its `error` code (docs/auth-security.md §3),
 * plus `attempts_left` for `invalid_code`.
 */
class DeviceCodeException(val status: Int, val code: String, val attemptsLeft: Int? = null) :
    RuntimeException("device-code $status $code") {
    companion object {
        /** Parses the function's JSON body; anything unreadable becomes `server_error`. */
        fun from(status: Int, body: String?): DeviceCodeException {
            val obj = runCatching { BoolaaJson.json.parseToJsonElement(body.orEmpty()).jsonObject }.getOrNull()
            val code = obj?.get("error")?.jsonPrimitive?.contentOrNull ?: if (status == 401) "unauthorized" else "server_error"
            return DeviceCodeException(status, code, obj?.get("attempts_left")?.jsonPrimitive?.intOrNull)
        }
    }
}

// Device verification, age, devices (supabase/migrations/20261122160000_device_verification.sql).

suspend fun BoolaaApi.startDeviceCheck(deviceId: String, label: String): DeviceCheck =
    BoolaaJson.json.decodeFromString(
        client.postgrest.rpc("start_device_check", buildJsonObject { put("p_device_id", deviceId); put("p_label", label) }).data,
    )

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
