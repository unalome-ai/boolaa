package com.boolaa.app

import com.boolaa.app.core.BoolaaJson
import com.boolaa.app.core.FeedMerge
import com.boolaa.app.core.FeedSpecs
import com.boolaa.app.model.BubbleEvent
import com.boolaa.app.model.FoodPost
import com.boolaa.app.model.UserProfile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test
import java.time.Instant

/** Merge rules for live feed changes (same cases as web tests/live-feed-merge.spec.ts and iOS LiveFeedMergeTests). */
class LiveFeedTest {
    private val alice = UserProfile("11111111-1111-1111-1111-111111111111", "Alice")
    private fun post(id: String, seconds: Long, text: String = "x", author: UserProfile? = alice) =
        FoodPost(id, "aaaaaaaa-0000-0000-0000-000000000001", alice.id, "img", text, Instant.ofEpochSecond(seconds), author)
    private val spec = FeedSpecs.food

    @Test fun insert_keeps_newest_first_and_null_stays_null() {
        val out = FeedMerge.upsert(listOf(post("a", 300), post("b", 100)), post("c", 200, author = null), spec)
        assertEquals(listOf("a", "c", "b"), out!!.map { it.id })
        assertNull(FeedMerge.upsert(null, post("c", 200), spec))
    }

    @Test fun echo_of_own_write_is_a_no_op() {
        val rows = listOf(post("a", 300), post("b", 100))
        assertSame(rows, FeedMerge.upsert(rows, post("a", 300), spec))
        // Realtime payloads have no author: still the same list once the known author is kept.
        assertSame(rows, FeedMerge.upsert(rows, post("a", 300, author = null), spec))
    }

    @Test fun update_replaces_fields_and_keeps_author() {
        val out = FeedMerge.upsert(listOf(post("a", 300), post("b", 100)), post("b", 100, "edited", author = null), spec)!!
        assertEquals("edited", out[1].description)
        assertEquals("Alice", out[1].user?.name)
        assertEquals(2, out.size)
    }

    @Test fun events_resort_by_datetime_and_rsvp_is_an_update() {
        fun event(id: String, day: Long, rsvp: List<String> = emptyList()) =
            BubbleEvent(id, "b", "c", "E", datetime = Instant.ofEpochSecond(day * 86_400), rsvpList = rsvp, createdAt = Instant.EPOCH)
        val rows = listOf(event("1", 1), event("2", 2))
        assertEquals(listOf("2", "1"), FeedMerge.upsert(rows, event("1", 3), FeedSpecs.events)!!.map { it.id })
        assertEquals(listOf(alice.id), FeedMerge.upsert(rows, event("2", 2, listOf(alice.id)), FeedSpecs.events)!![1].rsvpList)
    }

    @Test fun delete_by_id_ignores_unknown_ids() {
        val rows = listOf(post("a", 300), post("b", 100))
        assertEquals(listOf("b"), FeedMerge.remove(rows, "a", spec)!!.map { it.id })
        assertSame(rows, FeedMerge.remove(rows, "zzz", spec))
        assertNull(FeedMerge.remove(null, "a", spec))
    }

    /** A Realtime UPDATE record for an event ("2026-11-25 18:30:00+00" timestamps, arrays as JSON arrays) decodes. */
    @Test fun decodes_realtime_event_record() {
        val json = """{"id":"e1","bubble_id":"b","creator_id":"c","title":"Dinner","description":null,
            "datetime":"2026-11-25 18:30:00+00","location":null,"rsvp_list":["${alice.id}"],"created_at":"2026-11-22T20:41:07.123456+00:00"}"""
        val event = BoolaaJson.json.decodeFromString(BubbleEvent.serializer(), json)
        assertEquals(listOf(alice.id), event.rsvpList)
        assertEquals(Instant.parse("2026-11-25T18:30:00Z"), event.datetime)
        assertNull(event.creator)
    }
}
