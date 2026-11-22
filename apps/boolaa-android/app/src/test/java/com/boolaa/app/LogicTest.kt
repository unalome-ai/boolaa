package com.boolaa.app

import com.boolaa.app.core.BoolaaApi
import com.boolaa.app.model.Bubble
import com.boolaa.app.model.ChatMessage
import com.boolaa.app.model.JoinRequest
import com.boolaa.app.model.SharedLink
import com.boolaa.app.model.UserProfile
import com.boolaa.app.state.AppRoute
import com.boolaa.app.state.RouteGate
import com.boolaa.app.ui.chat.ChatMerge
import com.boolaa.app.ui.home.FeedItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.util.UUID

class RouteGateTest {
    @Test fun routes() {
        assertEquals(AppRoute.LAUNCHING, RouteGate.resolve(isRestoringSession = true, isSignedIn = false, approvedBubbleCount = null))
        assertEquals(AppRoute.AUTH, RouteGate.resolve(false, false, null))
        assertEquals(AppRoute.AUTH, RouteGate.resolve(false, false, 3))
        assertEquals(AppRoute.LAUNCHING, RouteGate.resolve(false, true, null))
        assertEquals(AppRoute.ONBOARDING, RouteGate.resolve(false, true, 0))
        assertEquals(AppRoute.MAIN, RouteGate.resolve(false, true, 2))
    }

    @Test fun current_bubble() {
        val a = Bubble("a", "A"); val b = Bubble("b", "B")
        assertEquals(b, RouteGate.pickCurrentBubble("b", listOf(a, b)))
        assertEquals(a, RouteGate.pickCurrentBubble("gone", listOf(a, b)))
        assertEquals(a, RouteGate.pickCurrentBubble(null, listOf(a, b)))
        assertNull(RouteGate.pickCurrentBubble("a", emptyList()))
    }
}

class FeatureLogicTest {
    private fun msg(id: String, at: Long, sender: UserProfile? = null) =
        ChatMessage(id, "b", "u1", "hi $id", Instant.ofEpochSecond(at), sender)

    @Test fun chat_merge_dedups_and_orders() {
        val authors = mapOf("u1" to UserProfile("u1", "Alice"))
        var list = ChatMerge.merge(emptyList(), msg("1", 10), authors)
        assertEquals("Alice", list.single().sender?.name) // realtime rows have no embed: filled from members
        list = ChatMerge.merge(list, msg("1", 10), authors)        // same row from realtime and insert
        assertEquals(1, list.size)
        list = ChatMerge.merge(list, msg("3", 30), authors)
        list = ChatMerge.merge(list, msg("2", 20), authors)        // out of order
        assertEquals(listOf("1", "2", "3"), list.map { it.id })
    }

    @Test fun approvals_needed_is_strict_majority() {
        assertEquals(1, JoinRequest.approvalsNeeded(1))
        assertEquals(2, JoinRequest.approvalsNeeded(2))
        assertEquals(2, JoinRequest.approvalsNeeded(3))
        assertEquals(3, JoinRequest.approvalsNeeded(4))
    }

    @Test fun only_current_members_votes_count() {
        val r = JoinRequest("r", "carol", "b", approverIds = listOf("alice", "gone"))
        assertEquals(1, JoinRequest.currentApprovals(r, listOf("alice", "bob")))
    }

    @Test fun storage_path_from_public_url() {
        assertEquals("u1/x.jpg", BoolaaApi.storagePath("http://127.0.0.1:55321/storage/v1/object/public/food.images/u1/x.jpg", com.boolaa.app.core.ImageBucket.FOOD))
        assertNull(BoolaaApi.storagePath("https://images.unsplash.com/photo.jpg", com.boolaa.app.core.ImageBucket.FOOD))
    }

    @Test fun tags_and_urls() {
        assertEquals(listOf("food", "cheap", "recipes"), SharedLink.parseTags("food, cheap ,  ,Recipes,food"))
        assertEquals("https://example.com", SharedLink.normalizeUrl(" example.com "))
        assertEquals("http://x.io", SharedLink.normalizeUrl("http://x.io"))
    }

    @Test fun image_path_matches_storage_policy() {
        val id = UUID.fromString("5F1D0A52-6C2E-4B7C-9A43-2F9E3C7D1A10")
        assertEquals("11111111-1111-1111-1111-111111111111/5f1d0a52-6c2e-4b7c-9a43-2f9e3c7d1a10.jpg",
            BoolaaApi.imagePath("11111111-1111-1111-1111-111111111111", id))
    }

    @Test fun feed_is_newest_first() {
        val feed = FeedItem.combine(
            messages = Fixtures.list("chat.json", ChatMessage.serializer()),
            food = Fixtures.list("food.json", com.boolaa.app.model.FoodPost.serializer()),
            market = emptyList(), events = emptyList(), links = emptyList(),
        )
        assertTrue(feed.zipWithNext().all { (a, b) -> a.date >= b.date })
        assertTrue(feed.first() is FeedItem.Food)
    }
}
