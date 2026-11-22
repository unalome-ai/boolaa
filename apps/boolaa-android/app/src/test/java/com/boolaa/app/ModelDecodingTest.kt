package com.boolaa.app

import com.boolaa.app.core.BoolaaJson
import com.boolaa.app.model.BubbleEvent
import com.boolaa.app.model.BubbleMember
import com.boolaa.app.model.ChatMessage
import com.boolaa.app.model.FoodPost
import com.boolaa.app.model.JoinRequest
import com.boolaa.app.model.MarketItem
import com.boolaa.app.model.MarketStatus
import com.boolaa.app.model.MemberRole
import com.boolaa.app.model.SharedLink
import com.boolaa.app.model.UserProfile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class ModelDecodingTest {
    private val alice = "11111111-1111-1111-1111-111111111111"

    @Test fun memberships_embed_bubbles() {
        val rows = Fixtures.list("memberships.json", BubbleMember.serializer())
        val flat = rows.first { it.bubble?.name == "Flatmates" }
        assertEquals(MemberRole.OWNER, flat.role)
        assertTrue(flat.approved)
        assertEquals("FLAT2026", flat.bubble!!.inviteCode)
        assertEquals(8, flat.bubble!!.maxSize)
        assertEquals("CLIMB123", rows.first { it.bubble?.name == "Climbing Crew" }.bubble!!.inviteCode)
    }

    @Test fun members_embed_users() {
        val rows = Fixtures.list("members.json", BubbleMember.serializer())
        assertTrue(rows.any { it.user?.name == "Alice" })
        assertTrue(rows.all { it.user != null })
    }

    @Test fun users_and_join_requests() {
        val users = Fixtures.list("users.json", UserProfile.serializer())
        assertEquals(alice, users.single().id)
        assertNull(users.single().avatar)
        val reqs = Fixtures.list("joinreqs.json", JoinRequest.serializer())
        assertEquals("Carol", reqs.first().user?.name)
        assertTrue(reqs.first().approverIds.isEmpty())
    }

    @Test fun chat_events_food_market_links() {
        val chat = Fixtures.list("chat.json", ChatMessage.serializer())
        assertTrue(chat.isNotEmpty())
        assertNotNull(chat.first().sender)
        assertEquals(Instant.parse("2026-11-22T14:26:52.414517Z"), chat.first { it.content.startsWith("Guilty") }.createdAt)

        val events = Fixtures.list("events.json", BubbleEvent.serializer())
        assertEquals("Flat dinner", events.first().title)
        assertTrue(alice in events.first().rsvpList)

        val food = Fixtures.list("food.json", FoodPost.serializer())
        assertTrue(food.first().image.startsWith("https://"))

        val market = Fixtures.list("market.json", MarketItem.serializer())
        assertEquals(MarketStatus.FREE, market.first().status)
        assertEquals("Alice", market.first().owner?.name)

        val links = Fixtures.list("links.json", SharedLink.serializer())
        assertEquals(listOf("food", "cheap"), links.first().tags)
    }

    @Test fun realtime_record_with_space_separated_timestamp() {
        val msg = BoolaaJson.json.decodeFromString(ChatMessage.serializer(), Fixtures.text("realtime_chat_record.json"))
        assertEquals("realtime hello", msg.content)
        assertNull(msg.sender)
        assertEquals(Instant.parse("2026-11-22T16:01:02.123456Z"), msg.createdAt)
    }

    @Test fun timestamp_shapes() {
        val expected = Instant.parse("2026-11-22T15:26:52.414517Z")
        assertEquals(expected, BoolaaJson.parseTimestamp("2026-11-22T15:26:52.414517+00:00"))
        assertEquals(expected, BoolaaJson.parseTimestamp("2026-11-22 15:26:52.414517+00"))
        assertEquals(expected, BoolaaJson.parseTimestamp("2026-11-22T17:26:52.414517+02:00"))
        assertEquals(Instant.parse("2026-11-22T15:26:52Z"), BoolaaJson.parseTimestamp("2026-11-22T15:26:52Z"))
        assertEquals(Instant.parse("2026-11-22T15:26:52Z"), BoolaaJson.parseTimestamp("2026-11-22 15:26:52+0000"))
        assertNull(BoolaaJson.parseTimestamp("yesterday"))
    }
}
