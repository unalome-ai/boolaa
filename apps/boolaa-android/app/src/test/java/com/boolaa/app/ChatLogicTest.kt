package com.boolaa.app

import com.boolaa.app.core.BoolaaJson
import com.boolaa.app.core.ImageBucket
import com.boolaa.app.core.ImageCompression
import com.boolaa.app.core.SignedUrlCache
import com.boolaa.app.core.UserFacingError
import com.boolaa.app.model.ChatMessage
import com.boolaa.app.model.ChatUnread
import com.boolaa.app.model.UserProfile
import com.boolaa.app.ui.chat.ChatMerge
import com.boolaa.app.ui.home.FeedItem
import kotlinx.serialization.builtins.ListSerializer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/** Chat P1 (20261123120000_chat_improvements.sql): decoding, page/live merges, divider, badges, signed URL cache. */
class ChatLogicTest {
    private val me = "11111111-1111-1111-1111-111111111111"
    private val bob = "22222222-2222-2222-2222-222222222222"
    private val authors = mapOf(me to UserProfile(me, "Alice"), bob to UserProfile(bob, "Bob"))

    private fun msg(id: String, at: Long, sender: String = bob, content: String = "hi $id", image: String? = null, deletedAt: Instant? = null) =
        ChatMessage(id, "b", sender, content, Instant.ofEpochSecond(at), imagePath = image, deletedAt = deletedAt)

    // Decoding

    @Test fun decodes_page_rows_with_photo_and_deleted_message() {
        val json = """[
          {"id":"m2","bubble_id":"b","sender_id":"$bob","content":"","image_path":"$bob/abc.jpg","deleted_at":null,
           "created_at":"2026-11-23T10:00:01.123456+00:00","sender":{"id":"$bob","name":"Bob","avatar":null}},
          {"id":"m1","bubble_id":"b","sender_id":"$me","content":"","image_path":null,"deleted_at":"2026-11-23T10:05:00.5+00:00",
           "created_at":"2026-11-23T10:00:00+00:00","sender":{"id":"$me","name":"Alice","avatar":null}}
        ]"""
        val rows = BoolaaJson.json.decodeFromString(ListSerializer(ChatMessage.serializer()), json)
        assertEquals("$bob/abc.jpg", rows[0].imagePath)
        assertTrue(rows[0].isPhotoOnly)
        assertFalse(rows[0].isDeleted)
        assertTrue(rows[1].isDeleted)
        assertFalse(rows[1].isPhotoOnly)
        assertEquals(Instant.parse("2026-11-23T10:05:00.5Z"), rows[1].deletedAt)
    }

    /** A realtime UPDATE (soft delete) record: space-separated timestamps, no sender embed. */
    @Test fun decodes_realtime_deletion_record() {
        val json = """{"id":"m1","bubble_id":"b","sender_id":"$bob","content":"","image_path":null,
            "created_at":"2026-11-23 10:00:00.123456+00","deleted_at":"2026-11-23 10:05:00.654321+00"}"""
        val m = BoolaaJson.json.decodeFromString(ChatMessage.serializer(), json)
        assertTrue(m.isDeleted)
        assertNull(m.sender)
        assertEquals(Instant.parse("2026-11-23T10:05:00.654321Z"), m.deletedAt)
    }

    @Test fun decodes_unread_counts() {
        val json = """[{"bubble_id":"b1","unread_count":100,"last_read_at":"2026-11-23T09:00:00.000001+00:00"},
            {"bubble_id":"b2","unread_count":0,"last_read_at":"2026-11-20T09:00:00+00:00"}]"""
        val rows = BoolaaJson.json.decodeFromString(ListSerializer(ChatUnread.serializer()), json)
        assertEquals(100, rows[0].unreadCount)
        assertEquals(Instant.parse("2026-11-23T09:00:00.000001Z"), rows[0].lastReadAt)
    }

    // Merges

    @Test fun pages_merge_newest_first_into_chronological_order() {
        // The RPC answers newest first; an older page arrives later and lands in front.
        val newest = listOf(msg("e", 50), msg("d", 40), msg("c", 30))
        var list = ChatMerge.mergePage(emptyList(), newest, authors)
        assertEquals(listOf("c", "d", "e"), list.map { it.id })
        assertEquals("Bob", list.first().sender?.name)
        list = ChatMerge.mergePage(list, listOf(msg("b", 20), msg("a", 10)), authors)
        assertEquals(listOf("a", "b", "c", "d", "e"), list.map { it.id })
        // A reload of the newest page (after subscribing) changes nothing and duplicates nothing.
        assertEquals(list, ChatMerge.mergePage(list, newest, authors))
    }

    @Test fun equal_timestamps_order_by_id_like_the_keyset() {
        val list = ChatMerge.mergePage(emptyList(), listOf(msg("y", 10), msg("x", 10), msg("z", 9)), authors)
        assertEquals(listOf("z", "x", "y"), list.map { it.id })
        // A live insert with the same timestamp lands where the server's (created_at, id) order puts it.
        assertEquals(listOf("z", "w", "x", "y"), ChatMerge.merge(list, msg("w", 10), authors).map { it.id })
    }

    @Test fun update_replaces_in_place_and_keeps_sender() {
        val list = ChatMerge.mergePage(emptyList(), listOf(msg("b", 20, image = "$bob/p.jpg"), msg("a", 10)), authors)
        val deletedAt = Instant.ofEpochSecond(99)
        // Realtime UPDATE: content and photo wiped, deleted_at set, no sender embed.
        val update = msg("b", 20, content = "", deletedAt = deletedAt).copy(sender = null)
        val out = ChatMerge.merge(list, update, emptyMap())
        assertEquals(listOf("a", "b"), out.map { it.id })
        assertTrue(out[1].isDeleted)
        assertNull(out[1].imagePath)
        assertEquals("Bob", out[1].sender?.name)
    }

    @Test fun echo_is_a_no_op_and_deleted_messages_never_come_back() {
        val list = ChatMerge.mergePage(emptyList(), listOf(msg("a", 10)), authors)
        assertSame(list, ChatMerge.merge(list, msg("a", 10).copy(sender = null), emptyMap()))
        val deleted = ChatMerge.merge(list, ChatMerge.deleted(list[0], Instant.ofEpochSecond(11)), authors)
        assertTrue(deleted.single().isDeleted)
        // A stale page or insert echo from before the deletion can't restore the text.
        assertSame(deleted, ChatMerge.merge(deleted, msg("a", 10), authors))
        assertTrue(ChatMerge.mergePage(deleted, listOf(msg("a", 10)), authors).single().isDeleted)
    }

    @Test fun local_deletion_placeholder_wipes_text_and_photo() {
        val d = ChatMerge.deleted(msg("a", 10, content = "secret", image = "$bob/x.jpg"), Instant.ofEpochSecond(12))
        assertEquals("", d.content)
        assertNull(d.imagePath)
        assertTrue(d.isDeleted)
        assertEquals(emptyList<String>(), ChatMerge.imagePaths(listOf(d)))
    }

    // Divider and read marker

    @Test fun divider_goes_above_first_newer_message_from_someone_else() {
        val list = listOf(msg("a", 10), msg("b", 20, sender = me), msg("c", 30, sender = me), msg("d", 40), msg("e", 50))
        assertEquals("d", ChatMerge.dividerBefore(list, Instant.ofEpochSecond(20), me))
        assertEquals("a", ChatMerge.dividerBefore(list, Instant.ofEpochSecond(5), me))
        // Equal to the marker means read.
        assertNull(ChatMerge.dividerBefore(list, Instant.ofEpochSecond(50), me))
        assertNull(ChatMerge.dividerBefore(list, null, me))
        assertEquals("e", ChatMerge.newestId(list))
        assertNull(ChatMerge.newestId(null))
    }

    @Test fun badge_text() {
        assertNull(ChatUnread.badgeText(0))
        assertEquals("1", ChatUnread.badgeText(1))
        assertEquals("99", ChatUnread.badgeText(99))
        assertEquals("99+", ChatUnread.badgeText(100))
    }

    // Photos

    @Test fun signed_urls_are_cached_per_path_until_near_expiry() {
        val hour = 3_600_000L
        val cache = SignedUrlCache(hour, marginMillis = 300_000L)
        assertEquals(listOf("u/a.jpg", "u/b.jpg"), cache.missing(listOf("u/a.jpg", "u/b.jpg", "u/a.jpg"), 0))
        cache.put(mapOf("u/a.jpg" to "https://x/sign/a?token=1"), signedAt = 0)
        assertEquals(listOf("u/b.jpg"), cache.missing(listOf("u/a.jpg", "u/b.jpg"), 1_000))
        assertEquals("https://x/sign/a?token=1", cache.get("u/a.jpg", hour - 300_001))
        assertNull(cache.get("u/a.jpg", hour - 300_000))
        cache.put(mapOf("u/a.jpg" to "https://x/sign/a?token=2"), signedAt = hour)
        assertEquals(mapOf("u/a.jpg" to "https://x/sign/a?token=2"), cache.snapshot(hour + 1))
        cache.forget("u/a.jpg")
        assertNull(cache.get("u/a.jpg", hour + 1))
    }

    @Test fun chat_bucket_uses_feed_photo_limits_and_is_cleaned_on_account_deletion() {
        assertEquals("chat.images", ImageBucket.CHAT.id)
        assertEquals(1600, ImageCompression.maxSide(ImageBucket.CHAT))
        assertEquals(5 * 1024 * 1024, ImageCompression.maxBytes(ImageBucket.CHAT))
        assertTrue(ImageBucket.CHAT in ImageBucket.userOwned)
        assertEquals(listOf("avatars", "food.images", "market.images", "chat.images"), ImageBucket.userOwned.map { it.id })
    }

    // Home and errors

    @Test fun home_skips_deleted_messages() {
        val feed = FeedItem.combine(
            messages = listOf(msg("a", 10), msg("b", 20, content = "", deletedAt = Instant.ofEpochSecond(30))),
            food = emptyList(), market = emptyList(), events = emptyList(), links = emptyList(),
        )
        assertEquals(listOf("m-a"), feed.map { it.key })
        assertTrue(msg("p", 1, content = "", image = "$bob/p.jpg").isPhotoOnly)
        assertFalse(msg("p", 1, content = "caption", image = "$bob/p.jpg").isPhotoOnly)
    }

    @Test fun message_not_found_maps_to_chat_message_gone() {
        assertEquals(UserFacingError.CHAT_MESSAGE_GONE, UserFacingError.classify("message not found", "P0001"))
        assertEquals(R.string.error_chat_message_gone, UserFacingError.CHAT_MESSAGE_GONE.message)
        // "member not found" is still its own error.
        assertEquals(UserFacingError.MEMBER_NOT_FOUND, UserFacingError.classify("member not found", "P0001"))
    }
}
