package com.boolaa.app.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.time.Duration
import java.time.Instant

/**
 * Push payload contract (docs/push-notifications.md §5): every notification carries `{ type, bubble_id, target_id }`
 * as FCM `data`. Pure Kotlin so routing and channel choice are unit tested.
 */
data class PushPayload(val type: PushType, val bubbleId: String, val targetId: String?, val itemKind: String? = null) {
    /** `chat:<bubble id>` etc.; the tag of the notification, so a newer push replaces the older one. */
    val tag: String get() = when (type) {
        PushType.CHAT -> "chat:$bubbleId"
        PushType.JOIN_REQUEST -> "join:$bubbleId"
        PushType.APPROVAL -> "approval:$bubbleId"
        PushType.NEW_EVENT -> "event:${targetId ?: bubbleId}"
        PushType.EVENT_REMINDER -> "reminder:${targetId ?: bubbleId}"
        PushType.FOOD -> "food:$bubbleId"
        PushType.MARKET -> "market:$bubbleId"
        PushType.ITEM_REQUEST -> "item_request:${targetId ?: bubbleId}"
        PushType.ITEM_REQUEST_WITHDRAWN, PushType.ITEM_PICKED, PushType.ITEM_MISSED -> "item:${targetId ?: bubbleId}"
    }

    companion object {
        const val KEY_TYPE = "type"
        const val KEY_BUBBLE = "bubble_id"
        const val KEY_TARGET = "target_id"
        /** The request types only: `food` / `market` (docs/push-notifications.md §5). */
        const val KEY_ITEM_KIND = "item_kind"
        val KEYS = listOf(KEY_TYPE, KEY_BUBBLE, KEY_TARGET, KEY_ITEM_KIND)

        /** From FCM `data` or the launcher intent's extras; null when it isn't a Boolaa push. */
        fun from(data: (String) -> String?): PushPayload? {
            val type = PushType.fromWire(data(KEY_TYPE)) ?: return null
            val bubble = data(KEY_BUBBLE)?.trim()?.takeIf { UUID_RE.matches(it) } ?: return null
            val target = data(KEY_TARGET)?.trim()?.takeIf { UUID_RE.matches(it) }
            val kind = data(KEY_ITEM_KIND)?.trim()?.lowercase()?.takeIf { type.isRequest && it in setOf("food", "market") }
            return PushPayload(type, bubble.lowercase(), target?.lowercase(), kind)
        }

        fun from(map: Map<String, String?>): PushPayload? = from { map[it] }

        private val UUID_RE = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
    }
}

enum class PushType(val wire: String, val channel: PushChannel) {
    CHAT("chat", PushChannel.CHAT),
    JOIN_REQUEST("join_request", PushChannel.BUBBLE),
    APPROVAL("approval", PushChannel.BUBBLE),
    NEW_EVENT("new_event", PushChannel.EVENTS),
    EVENT_REMINDER("event_reminder", PushChannel.EVENTS),
    FOOD("food", PushChannel.BUBBLE),
    MARKET("market", PushChannel.BUBBLE),
    ITEM_REQUEST("item_request", PushChannel.BUBBLE),
    ITEM_REQUEST_WITHDRAWN("item_request_withdrawn", PushChannel.BUBBLE),
    ITEM_PICKED("item_picked", PushChannel.BUBBLE),
    ITEM_MISSED("item_missed", PushChannel.BUBBLE);

    /** "I want it" types: they carry `item_kind`. */
    val isRequest: Boolean get() = this == ITEM_REQUEST || this == ITEM_REQUEST_WITHDRAWN || this == ITEM_PICKED || this == ITEM_MISSED

    companion object {
        fun fromWire(value: String?): PushType? = entries.firstOrNull { it.wire == value }
    }
}

/** Android notification channels (§8): ids are fixed by the server's `channel_id`. */
enum class PushChannel(val id: String, val highImportance: Boolean) {
    CHAT("chat", true), BUBBLE("bubble", false), EVENTS("events", true);

    companion object {
        fun fromId(id: String?): PushChannel? = entries.firstOrNull { it.id == id }
    }
}

/** Where a tapped push lands (§5). */
enum class PushScreen { HOME, CHAT, SETTINGS, EVENTS, FOOD, MARKETPLACE }

data class PushDestination(
    /** The bubble to switch to, or null to stay (the bubble isn't joined anymore: open Home without switching). */
    val bubbleId: String?,
    val screen: PushScreen,
    /** Event / food post / market item to highlight. */
    val highlightId: String? = null,
    /** `approval`: the bubble list must be refreshed first (it's newly joined). */
    val reloadFirst: Boolean = false,
    /** `item_request` / `item_request_withdrawn`: open the owner's Requests sheet on [highlightId]. */
    val openRequests: Boolean = false,
)

object PushRouting {
    /** Maps a payload to a destination, given the ids of the bubbles the user is in (after a reload for `approval`). */
    fun resolve(p: PushPayload, joinedBubbleIds: Collection<String>): PushDestination {
        val joined = joinedBubbleIds.any { it.equals(p.bubbleId, ignoreCase = true) }
        if (!joined) return PushDestination(null, PushScreen.HOME, reloadFirst = p.type == PushType.APPROVAL)
        return when (p.type) {
            PushType.CHAT -> PushDestination(p.bubbleId, PushScreen.CHAT)
            PushType.JOIN_REQUEST -> PushDestination(p.bubbleId, PushScreen.SETTINGS)
            PushType.APPROVAL -> PushDestination(p.bubbleId, PushScreen.HOME, reloadFirst = true)
            PushType.NEW_EVENT, PushType.EVENT_REMINDER -> PushDestination(p.bubbleId, PushScreen.EVENTS, p.targetId)
            PushType.FOOD -> PushDestination(p.bubbleId, PushScreen.FOOD, p.targetId)
            PushType.MARKET -> PushDestination(p.bubbleId, PushScreen.MARKETPLACE, p.targetId)
            PushType.ITEM_REQUEST, PushType.ITEM_REQUEST_WITHDRAWN, PushType.ITEM_PICKED, PushType.ITEM_MISSED -> {
                val screen = when (p.itemKind) {
                    "food" -> PushScreen.FOOD
                    "market" -> PushScreen.MARKETPLACE
                    else -> return PushDestination(p.bubbleId, PushScreen.HOME)
                }
                val owner = p.type == PushType.ITEM_REQUEST || p.type == PushType.ITEM_REQUEST_WITHDRAWN
                PushDestination(p.bubbleId, screen, p.targetId, openRequests = owner && p.targetId != null)
            }
        }
    }

    /** Foreground rule (§8 point 4): no banner for a chat push while that bubble's chat is on screen. */
    fun shouldShowInForeground(p: PushPayload?, openChatBubbleId: String?): Boolean =
        !(p != null && p.type == PushType.CHAT && openChatBubbleId != null && p.bubbleId.equals(openChatBubbleId, ignoreCase = true))
}

/** Per-bubble mute durations (§9). */
enum class MuteOption(val duration: Duration?) {
    HOUR(Duration.ofHours(1)), EIGHT_HOURS(Duration.ofHours(8)), WEEK(Duration.ofDays(7)), FOREVER(null);

    /** The `until` to store (null = until unmuted). */
    fun until(now: Instant): Instant? = duration?.let { now.plus(it) }
}

/** A `bubble_mutes` row. */
@Serializable
data class BubbleMute(
    @SerialName("user_id") val userId: String,
    @SerialName("bubble_id") val bubbleId: String,
    val until: String? = null,
) {
    val untilInstant: Instant? get() = until?.let { BoolaaJson.parseTimestamp(it) }

    /** Active when `until` is null (until unmuted) or in the future (same rule as `push_should_notify`). */
    fun isActive(now: Instant): Boolean = until == null || (untilInstant?.isAfter(now) ?: false)
}

/** The user's `notification_prefs` row (defaults as the server's: all on except food and market). */
@Serializable
data class NotificationPrefs(
    val enabled: Boolean = true,
    val chat: Boolean = true,
    @SerialName("join_requests") val joinRequests: Boolean = true,
    val approvals: Boolean = true,
    @SerialName("new_events") val newEvents: Boolean = true,
    @SerialName("event_reminders") val eventReminders: Boolean = true,
    val food: Boolean = false,
    val market: Boolean = false,
    @SerialName("item_requests") val itemRequests: Boolean = true,
    @SerialName("request_updates") val requestUpdates: Boolean = true,
    @SerialName("preview_content") val previewContent: Boolean = true,
)

/** The columns of [NotificationPrefs] the settings screen toggles. */
enum class PrefKey(val column: String) {
    ENABLED("enabled"), CHAT("chat"), JOIN_REQUESTS("join_requests"), APPROVALS("approvals"), NEW_EVENTS("new_events"),
    EVENT_REMINDERS("event_reminders"), FOOD("food"), MARKET("market"), ITEM_REQUESTS("item_requests"),
    REQUEST_UPDATES("request_updates"), PREVIEW("preview_content");

    fun get(p: NotificationPrefs): Boolean = when (this) {
        ENABLED -> p.enabled; CHAT -> p.chat; JOIN_REQUESTS -> p.joinRequests; APPROVALS -> p.approvals
        NEW_EVENTS -> p.newEvents; EVENT_REMINDERS -> p.eventReminders; FOOD -> p.food; MARKET -> p.market
        ITEM_REQUESTS -> p.itemRequests; REQUEST_UPDATES -> p.requestUpdates; PREVIEW -> p.previewContent
    }

    fun set(p: NotificationPrefs, v: Boolean): NotificationPrefs = when (this) {
        ENABLED -> p.copy(enabled = v); CHAT -> p.copy(chat = v); JOIN_REQUESTS -> p.copy(joinRequests = v)
        APPROVALS -> p.copy(approvals = v); NEW_EVENTS -> p.copy(newEvents = v); EVENT_REMINDERS -> p.copy(eventReminders = v)
        FOOD -> p.copy(food = v); MARKET -> p.copy(market = v); ITEM_REQUESTS -> p.copy(itemRequests = v)
        REQUEST_UPDATES -> p.copy(requestUpdates = v); PREVIEW -> p.copy(previewContent = v)
    }
}

/** Arguments of `register_push_token` for an Android FCM token (pure, so the wire format is unit tested). */
object PushRegistration {
    fun body(token: String, deviceId: String?, locale: String, appVersion: String): Map<String, String?> = mapOf(
        "p_platform" to "android",
        "p_token" to token,
        "p_endpoint" to null, "p_p256dh" to null, "p_auth" to null, "p_apns_env" to null,
        "p_device_id" to deviceId,
        "p_locale" to (locale.takeIf { it in setOf("en", "ro", "fr", "es", "it") } ?: "en"),
        "p_app_version" to appVersion,
    )
}
