package com.boolaa.app.core

import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.postgrest
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Instant

// Push backend calls (docs/push-notifications.md §2, §9). RLS: own rows only, verified sessions only.

/** `register_push_token(...)` for this device's FCM token. Upserts; a token of another account moves to the caller. */
suspend fun BoolaaApi.registerPushToken(token: String, deviceId: String?, locale: String, appVersion: String) {
    val body = PushRegistration.body(token, deviceId, locale, appVersion)
    client.postgrest.rpc("register_push_token", buildJsonObject {
        body.forEach { (k, v) -> put(k, v?.let(::JsonPrimitive) ?: JsonNull) }
    })
}

/** `unregister_push_token(p_token)`: before sign-out (the server also drops it when the session ends). */
suspend fun BoolaaApi.unregisterPushToken(token: String) {
    client.postgrest.rpc("unregister_push_token", buildJsonObject { put("p_token", token) })
}

/** The own `notification_prefs` row; the server creates one per user, the defaults stand in if it's missing. */
suspend fun BoolaaApi.notificationPrefs(userId: String): NotificationPrefs =
    client.from("notification_prefs").select { filter { eq("user_id", userId) }; limit(1) }
        .let { BoolaaJson.json.decodeFromString<List<NotificationPrefs>>(it.data).firstOrNull() ?: NotificationPrefs() }

/** Upsert of the whole row (insert covers a missing row; update otherwise). */
suspend fun BoolaaApi.saveNotificationPrefs(userId: String, prefs: NotificationPrefs) {
    val row = buildJsonObject {
        put("user_id", userId)
        PrefKey.entries.forEach { put(it.column, it.get(prefs)) }
    }
    client.from("notification_prefs").upsert(row) { onConflict = "user_id" }
}

/** The caller's mute of [bubbleId], if any (expired rows included; check [BubbleMute.isActive]). */
suspend fun BoolaaApi.bubbleMute(userId: String, bubbleId: String): BubbleMute? =
    client.from("bubble_mutes").select { filter { eq("user_id", userId); eq("bubble_id", bubbleId) }; limit(1) }
        .let { BoolaaJson.json.decodeFromString<List<BubbleMute>>(it.data).firstOrNull() }

/** Upsert `{user_id, bubble_id, until}`; [until] null = until unmuted. */
suspend fun BoolaaApi.muteBubble(userId: String, bubbleId: String, until: Instant?) {
    client.from("bubble_mutes").upsert(buildJsonObject {
        put("user_id", userId)
        put("bubble_id", bubbleId)
        put("until", until?.let { JsonPrimitive(BoolaaJson.formatTimestamp(it)) } ?: JsonNull)
    }) { onConflict = "user_id,bubble_id" }
}

suspend fun BoolaaApi.unmuteBubble(userId: String, bubbleId: String) {
    client.from("bubble_mutes").delete { filter { eq("user_id", userId); eq("bubble_id", bubbleId) } }
}
