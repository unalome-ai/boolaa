package com.boolaa.app

import com.boolaa.app.core.BoolaaJson
import com.boolaa.app.core.ReactionCodec
import com.boolaa.app.core.ReactionMerge
import com.boolaa.app.core.ReactionSummary
import com.boolaa.app.model.Reaction
import com.boolaa.app.model.ReactionKind
import com.boolaa.app.model.ReactionToggle
import com.boolaa.app.model.SharedLink
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/** Reactions merge rules and link preview decoding (docs/boolaa-spec.md "Reactions", "Link previews"). */
class ReactionsAndPreviewsTest {
    private val me = "me"
    private fun r(id: String, target: String, kind: String, user: String) = Reaction(id, "food_post", target, kind, user)
    private fun map(vararg rows: Reaction) = rows.associateBy { it.id }

    @Test fun summaries_count_in_fixed_order_and_highlight_own() {
        val rows = map(
            r("1", "p1", "laugh", "bob"), r("2", "p1", "like", me), r("3", "p1", "like", "bob"),
            r("4", "p1", "thanks", "carol"), r("5", "p2", "love", "bob"),
        )
        val s = ReactionMerge.summaries(rows, me)
        assertEquals(
            listOf(ReactionSummary(ReactionKind.LIKE, 2, true), ReactionSummary(ReactionKind.LAUGH, 1, false), ReactionSummary(ReactionKind.THANKS, 1, false)),
            s["p1"],
        )
        assertEquals(listOf(ReactionSummary(ReactionKind.LOVE, 1, false)), s["p2"])
        assertNull(s["p3"])
    }

    @Test fun insert_and_delete_by_id_and_echo_is_idempotent() {
        val start = map(r("1", "p1", "like", "bob"))
        val added = ReactionMerge.add(start, r("2", "p1", "love", me))
        assertEquals(2, added.size)
        // The realtime echo of our own toggle: same row, nothing changes (same instance, no recomposition).
        assertSame(added, ReactionMerge.add(added, r("2", "p1", "love", me)))
        val removed = ReactionMerge.remove(added, "2")
        assertEquals(setOf("1"), removed.keys)
        // DELETE of an id we don't hold (another bubble, another screen): unchanged.
        assertSame(removed, ReactionMerge.remove(removed, "unknown"))
        // Unknown reaction keys from a newer server are ignored.
        assertSame(removed, ReactionMerge.add(removed, r("9", "p1", "angry", "bob")))
    }

    @Test fun toggle_result_adds_or_removes_own_row() {
        val on = ReactionToggle("7", reacted = true, reaction = "wow", targetType = "food_post", targetId = "p1")
        val after = ReactionMerge.applyToggle(emptyMap(), on, me)
        assertEquals(Reaction("7", "food_post", "p1", "wow", me), after["7"])
        assertTrue(ReactionMerge.summaries(after, me)["p1"]!!.single().mine)
        // The INSERT echo arriving after the toggle result changes nothing.
        assertSame(after, ReactionMerge.add(after, Reaction("7", "food_post", "p1", "wow", me)))
        val off = ReactionMerge.applyToggle(after, on.copy(reacted = false), me)
        assertTrue(off.isEmpty())
    }

    @Test fun deleted_message_drops_its_reactions() {
        val rows = map(r("1", "m1", "like", "bob"), r("2", "m1", "sad", me), r("3", "m2", "like", "bob"))
        val dropped = ReactionMerge.dropTarget(rows, "m1")
        assertEquals(setOf("3"), dropped.keys)
        assertSame(dropped, ReactionMerge.dropTarget(dropped, "m1"))
    }

    @Test fun replace_for_loaded_targets_keeps_others() {
        val rows = map(r("1", "p1", "like", "bob"), r("2", "p2", "like", "bob"))
        val fetched = listOf(r("5", "p1", "love", "carol"), r("6", "p9", "love", "carol"))
        val next = ReactionMerge.replaceFor(rows, setOf("p1"), fetched)
        assertEquals(setOf("2", "5"), next.keys) // p1 replaced, p2 kept, p9 (not asked) ignored
    }

    @Test fun ids_are_chunked_by_100() {
        val ids = (1..250).map { "id$it" } + "id1"
        val chunks = ReactionMerge.chunks(ids)
        assertEquals(listOf(100, 100, 50), chunks.map { it.size })
    }

    @Test fun decodes_toggle_result_object_or_array_and_realtime_record() {
        val json = """{"id":"a1","reacted":true,"reaction":"love","target_type":"chat_message","target_id":"m1"}"""
        assertEquals(ReactionToggle("a1", true, "love", "chat_message", "m1"), ReactionCodec.toggle(json))
        assertEquals(ReactionToggle("a1", true, "love", "chat_message", "m1"), ReactionCodec.toggle("[$json]"))
        // A realtime INSERT record carries every column (internal ones too); unknown keys are ignored.
        val record = BoolaaJson.json.parseToJsonElement(
            """{"id":"r1","bubble_id":"b1","user_id":"u1","reaction":"like","message_id":"m1","event_id":null,"food_post_id":null,
               "market_item_id":null,"link_id":null,"target_owner_id":"u2","target_type":"chat_message","target_id":"m1",
               "created_at":"2026-11-23 16:00:00.123+00"}""",
        ).jsonObject
        assertEquals(Reaction("r1", "chat_message", "m1", "like", "u1"), ReactionCodec.record(record))
        assertNull(ReactionCodec.record(BoolaaJson.json.parseToJsonElement("""{"id":"x"}""").jsonObject))
    }

    @Test fun reaction_keys_match_the_backend_set() {
        assertEquals(listOf("like", "love", "laugh", "wow", "sad", "thanks"), ReactionKind.entries.map { it.wire })
        assertEquals(ReactionKind.THANKS, ReactionKind.of("thanks"))
        assertNull(ReactionKind.of("👍"))
    }

    @Test fun shared_link_decodes_preview_columns_and_defaults() {
        val ready = BoolaaJson.json.decodeFromString(
            SharedLink.serializer(),
            """{"id":"l1","bubble_id":"b1","user_id":"u1","url":"https://www.Example.org/a?b=1","title":null,"tags":[],
               "created_at":"2026-11-23T16:00:00Z","preview_status":"ready","preview_title":"Sourdough & friends",
               "preview_description":"Bake it slow.","preview_site_name":"Bread Weekly",
               "preview_image_path":"0b6e1f5e-0000-4000-8000-000000000001/0b6e1f5e-0000-4000-8000-000000000002.jpg",
               "preview_requested_at":"2026-11-23 16:00:00+00","preview_claimed_at":null,"preview_fetched_at":null}""",
        )
        assertTrue(ready.previewReady)
        assertFalse(ready.previewLoading)
        assertEquals("Sourdough & friends", ready.previewTitle)
        assertEquals("Bread Weekly", ready.previewSiteName)
        assertEquals("example.org", ready.domain)
        // Rows from before the migration (and realtime records without the columns) decode as "none".
        val old = BoolaaJson.json.decodeFromString(
            SharedLink.serializer(), """{"id":"l2","bubble_id":"b1","user_id":"u1","url":"https://x.org","created_at":"2026-11-23T16:00:00Z"}""",
        )
        assertEquals("none", old.previewStatus)
        assertFalse(old.previewReady || old.previewLoading)
        assertTrue(old.copy(previewStatus = "pending").previewLoading)
        assertTrue(old.copy(previewStatus = "fetching").previewLoading)
    }

    @Test fun domain_formatting() {
        assertEquals("example.org", SharedLink.domainOf("https://www.example.org/path"))
        assertEquals("news.bbc.co.uk", SharedLink.domainOf("http://NEWS.bbc.co.uk"))
        assertEquals("wwwfoo.com", SharedLink.domainOf("https://wwwfoo.com"))
        assertEquals("[2606:4700::1]", SharedLink.domainOf("https://[2606:4700::1]/"))
        assertNull(SharedLink.domainOf("not a url"))
        assertNull(SharedLink.domainOf(""))
    }
}
