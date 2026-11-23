package com.boolaa.app

import com.boolaa.app.core.BoolaaJson
import com.boolaa.app.core.BubbleMute
import com.boolaa.app.core.MuteOption
import com.boolaa.app.core.NotificationPrefs
import com.boolaa.app.core.PrefKey
import com.boolaa.app.core.PushChannel
import com.boolaa.app.core.PushDestination
import com.boolaa.app.core.PushPayload
import com.boolaa.app.core.PushRegistration
import com.boolaa.app.core.PushRouting
import com.boolaa.app.core.PushScreen
import com.boolaa.app.core.PushType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.Instant

/** Push client contract (docs/push-notifications.md §3, §5, §8, §9). */
class PushTest {
    private val bubble = "0b6d6c4e-8f0a-4a39-9b55-6f2a1c0d9e11"
    private val other = "7f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b"
    private val target = "3c2b1a09-8f7e-4d6c-9b5a-0f1e2d3c4b5a"

    private fun payload(type: String, b: String = bubble, t: String? = target) =
        PushPayload.from(mapOf("type" to type, "bubble_id" to b, "target_id" to t))

    @Test fun parses_every_type_from_fcm_data() {
        PushType.entries.forEach { assertEquals(it, payload(it.wire)!!.type) }
        val p = payload("chat", b = bubble.uppercase())!!
        assertEquals(bubble, p.bubbleId)
        assertEquals(target, p.targetId)
    }

    @Test fun rejects_foreign_or_malformed_data() {
        assertNull(payload("party"))
        assertNull(payload("chat", b = "not-a-uuid"))
        assertNull(PushPayload.from(mapOf("type" to "chat")))
        assertNull(PushPayload.from(emptyMap()))
        // A bad target id is dropped, the push still opens its screen.
        assertNull(payload("new_event", t = "../../x")!!.targetId)
    }

    @Test fun channels_and_tags_match_the_server() {
        assertEquals(PushChannel.CHAT, PushType.CHAT.channel)
        assertEquals(PushChannel.BUBBLE, PushType.JOIN_REQUEST.channel)
        assertEquals(PushChannel.BUBBLE, PushType.APPROVAL.channel)
        assertEquals(PushChannel.EVENTS, PushType.NEW_EVENT.channel)
        assertEquals(PushChannel.EVENTS, PushType.EVENT_REMINDER.channel)
        assertEquals(PushChannel.BUBBLE, PushType.FOOD.channel)
        assertEquals(PushChannel.BUBBLE, PushType.MARKET.channel)
        assertEquals(listOf("chat", "bubble", "events"), PushChannel.entries.map { it.id })
        assertTrue(PushChannel.CHAT.highImportance && PushChannel.EVENTS.highImportance && !PushChannel.BUBBLE.highImportance)
        assertEquals("chat:$bubble", payload("chat")!!.tag)
        assertEquals("join:$bubble", payload("join_request")!!.tag)
        assertEquals("event:$target", payload("new_event")!!.tag)
        assertEquals("reminder:$target", payload("event_reminder")!!.tag)
    }

    @Test fun routes_each_type_to_its_screen() {
        val joined = listOf(bubble, other)
        fun route(type: String) = PushRouting.resolve(payload(type)!!, joined)
        assertEquals(PushDestination(bubble, PushScreen.CHAT), route("chat"))
        assertEquals(PushDestination(bubble, PushScreen.SETTINGS), route("join_request"))
        assertEquals(PushDestination(bubble, PushScreen.HOME, reloadFirst = true), route("approval"))
        assertEquals(PushDestination(bubble, PushScreen.EVENTS, target), route("new_event"))
        assertEquals(PushDestination(bubble, PushScreen.EVENTS, target), route("event_reminder"))
        assertEquals(PushDestination(bubble, PushScreen.FOOD, target), route("food"))
        assertEquals(PushDestination(bubble, PushScreen.MARKETPLACE, target), route("market"))
    }

    @Test fun a_bubble_no_longer_joined_opens_home_without_switching() {
        val dest = PushRouting.resolve(payload("chat")!!, listOf(other))
        assertNull(dest.bubbleId)
        assertEquals(PushScreen.HOME, dest.screen)
        // An approval for a bubble not loaded yet asks for a reload first.
        assertTrue(PushRouting.resolve(payload("approval")!!, emptyList()).reloadFirst)
    }

    @Test fun no_banner_for_the_chat_on_screen() {
        assertFalse(PushRouting.shouldShowInForeground(payload("chat"), bubble))
        assertTrue(PushRouting.shouldShowInForeground(payload("chat"), other))
        assertTrue(PushRouting.shouldShowInForeground(payload("chat"), null))
        assertTrue(PushRouting.shouldShowInForeground(payload("new_event"), bubble))
        assertTrue(PushRouting.shouldShowInForeground(null, bubble))
    }

    @Test fun mute_durations() {
        val now = Instant.parse("2026-11-22T10:00:00Z")
        assertEquals(Instant.parse("2026-11-22T11:00:00Z"), MuteOption.HOUR.until(now))
        assertEquals(Instant.parse("2026-11-22T18:00:00Z"), MuteOption.EIGHT_HOURS.until(now))
        assertEquals(Instant.parse("2026-11-29T10:00:00Z"), MuteOption.WEEK.until(now))
        assertNull(MuteOption.FOREVER.until(now))
    }

    @Test fun mute_row_activity_follows_push_should_notify() {
        val now = Instant.parse("2026-11-22T10:00:00Z")
        val rows = BoolaaJson.json.decodeFromString<List<BubbleMute>>(
            """[{"user_id":"u","bubble_id":"$bubble","until":null,"created_at":"2026-11-22T09:00:00+00:00"},
                {"user_id":"u","bubble_id":"$bubble","until":"2026-11-22T10:30:00.123456+00:00"},
                {"user_id":"u","bubble_id":"$bubble","until":"2026-11-22T09:59:59+00:00"}]""",
        )
        assertEquals(listOf(true, true, false), rows.map { it.isActive(now) })
        assertEquals(Instant.parse("2026-11-22T10:30:00.123456Z"), rows[1].untilInstant)
    }

    @Test fun prefs_decode_and_toggle() {
        val p = BoolaaJson.json.decodeFromString<NotificationPrefs>(
            """{"user_id":"u","enabled":true,"chat":false,"join_requests":true,"approvals":true,"new_events":true,
                "event_reminders":false,"food":false,"market":true,"preview_content":false,"updated_at":"2026-11-22T10:00:00+00:00"}""",
        )
        assertFalse(p.chat); assertFalse(p.eventReminders); assertTrue(p.market); assertFalse(p.previewContent)
        PrefKey.entries.forEach { k ->
            assertTrue(k.get(k.set(p, true))); assertFalse(k.get(k.set(p, false)))
        }
        // Server defaults: everything on except food and market (item_requests / request_updates on, 20261124100000;
        // mentions on, 20261124200000).
        val d = NotificationPrefs()
        assertEquals(listOf(true, true, true, true, true, true, true, false, false, true, true, true), PrefKey.entries.map { it.get(d) })
        assertEquals(
            listOf("enabled", "chat", "mentions", "join_requests", "approvals", "new_events", "event_reminders", "food", "market",
                "item_requests", "request_updates", "preview_content"),
            PrefKey.entries.map { it.column },
        )
    }

    @Test fun registration_body_matches_the_rpc() {
        val b = PushRegistration.body("fcm-token", "device-1", "ro", "1.0")
        assertEquals("android", b["p_platform"]); assertEquals("fcm-token", b["p_token"])
        assertEquals("device-1", b["p_device_id"]); assertEquals("ro", b["p_locale"]); assertEquals("1.0", b["p_app_version"])
        assertNull(b["p_apns_env"]); assertNull(b["p_endpoint"])
        assertEquals(
            setOf("p_platform", "p_token", "p_endpoint", "p_p256dh", "p_auth", "p_apns_env", "p_device_id", "p_locale", "p_app_version"),
            b.keys,
        )
        assertEquals("en", PushRegistration.body("t", null, "de", "1.0")["p_locale"])
    }

    /** google-services.json must stay out of git, and Analytics out of the build. */
    @Test fun firebase_config_is_not_committed_and_analytics_is_off() {
        val ignore = generateSequence(File("").absoluteFile) { it.parentFile }.take(5)
            .flatMap { listOf(File(it, ".gitignore"), File(it, "app/.gitignore")) }.filter { it.isFile }.joinToString("\n") { it.readText() }
        assertTrue(ignore.lines().any { it.trim().endsWith("google-services.json") })
        val gradle = File("build.gradle.kts").readText()
        assertFalse(File("../gradle/libs.versions.toml").readText().contains("com.google.firebase:firebase-analytics"))
        assertFalse(gradle.contains("libs.firebase.analytics"))
        assertTrue(gradle.contains("""file("google-services.json").isFile"""))
        val manifest = File("src/main/AndroidManifest.xml").readText()
        assertTrue(manifest.contains("firebase_analytics_collection_deactivated"))
        assertTrue(manifest.contains("android.permission.POST_NOTIFICATIONS"))
    }
}
