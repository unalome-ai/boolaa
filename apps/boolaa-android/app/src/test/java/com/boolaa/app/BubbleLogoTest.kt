package com.boolaa.app

import com.boolaa.app.core.BoolaaApi
import com.boolaa.app.core.BoolaaJson
import com.boolaa.app.core.ImageBucket
import com.boolaa.app.core.ImageCompression
import com.boolaa.app.model.Bubble
import com.boolaa.app.model.BubbleMember
import com.boolaa.app.model.BubblePatch
import com.boolaa.app.model.BubbleRef
import com.boolaa.app.model.JoinRequest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.UUID

/** Bubble logo (supabase/migrations/20261123130000_bubble_cover.sql): paths, limits, live merge, strings. */
class BubbleLogoTest {
    private val bubbleId = "AAAAAAAA-1111-2222-3333-444444444444"
    private val base = "http://127.0.0.1:55321/storage/v1/object/public/bubble.images/"

    @Test fun bucket_and_path() {
        assertEquals("bubble.images", ImageBucket.BUBBLE.id)
        val id = UUID.fromString("BBBBBBBB-0000-0000-0000-000000000001")
        assertEquals("aaaaaaaa-1111-2222-3333-444444444444/bbbbbbbb-0000-0000-0000-000000000001.jpg", BoolaaApi.bubbleLogoPath(bubbleId, id))
        assertTrue(BoolaaApi.bubbleLogoPath(bubbleId).matches(Regex("^[0-9a-f-]{36}/[0-9a-f-]{36}\\.jpg$")))
    }

    @Test fun logo_limits_match_avatars() {
        assertEquals(512, ImageCompression.maxSide(ImageBucket.BUBBLE))
        assertEquals(2 * 1024 * 1024, ImageCompression.maxBytes(ImageBucket.BUBBLE))
        assertEquals(1600, ImageCompression.maxSide(ImageBucket.FOOD))
    }

    @Test fun account_deletion_skips_bubble_bucket() {
        assertEquals(listOf(ImageBucket.AVATARS, ImageBucket.FOOD, ImageBucket.MARKET, ImageBucket.CHAT), ImageBucket.userOwned)
        assertTrue(ImageBucket.BUBBLE !in ImageBucket.userOwned)
    }

    @Test fun old_object_from_url() {
        val path = "aaaaaaaa-1111-2222-3333-444444444444/x.jpg"
        assertEquals(path, BoolaaApi.bubbleLogoObject(base + path, bubbleId))
        assertEquals(path, BoolaaApi.bubbleLogoObject("$base$path?t=1", bubbleId))
        // Another bubble's folder, another bucket, external URLs and nulls are never deleted.
        assertNull(BoolaaApi.bubbleLogoObject(base + "cccccccc-1111-2222-3333-444444444444/x.jpg", bubbleId))
        assertNull(BoolaaApi.bubbleLogoObject("http://127.0.0.1:55321/storage/v1/object/public/avatars/$path", bubbleId))
        assertNull(BoolaaApi.bubbleLogoObject("https://example.com/logo.jpg", bubbleId))
        assertNull(BoolaaApi.bubbleLogoObject(base + "aaaaaaaa-1111-2222-3333-444444444444/../x.jpg", bubbleId))
        assertNull(BoolaaApi.bubbleLogoObject(null, bubbleId))
    }

    private fun bubble(id: String, name: String, logo: String? = null) = Bubble(id = id, name = name, logo = logo)

    @Test fun patch_from_realtime_record() {
        val record = BoolaaJson.json.parseToJsonElement(
            """{"id":"b1","name":"Flat","description":null,"logo":"${base}b1/x.jpg","max_size":12,"created_at":"2026-11-22 10:00:00.123+00"}""",
        ).jsonObject
        assertEquals(BubblePatch("b1", "Flat", null, "${base}b1/x.jpg"), BubblePatch.fromRecord(record))
        assertNull(BubblePatch.fromRecord(JsonObject(emptyMap())))
    }

    @Test fun live_merge_by_id() {
        val members = listOf(
            BubbleMember(userId = "me", bubbleId = "b1", approved = true, bubble = bubble("b1", "Flat")),
            BubbleMember(userId = "me", bubbleId = "b2", approved = true, bubble = bubble("b2", "Climb", "${base}b2/old.jpg")),
        )
        val requests = listOf(JoinRequest(id = "r1", userId = "me", bubbleId = "b3", bubble = BubbleRef("b3", "Book club")))

        val (m, r) = BubblePatch.merge(members, requests, BubblePatch("b2", "Climbing", "Up", null))!!
        assertEquals(members[0], m!![0])
        assertEquals(bubble("b2", "Climbing").copy(description = "Up"), m[1].bubble)
        assertSame(requests[0], r[0])

        val (_, r2) = BubblePatch.merge(members, requests, BubblePatch("b3", "Books", null, "${base}b3/new.jpg"))!!
        assertEquals(BubbleRef("b3", "Books", "${base}b3/new.jpg"), r2[0].bubble)

        // A bubble the caller doesn't hold changes nothing.
        assertNull(BubblePatch.merge(members, requests, BubblePatch("zz", "Other", null, null)))
        assertNull(BubblePatch.merge(null, emptyList(), BubblePatch("b1", "Flat", null, null)))
    }

    @Test fun pending_request_embed_decodes_logo() {
        val json = """{"id":"r1","user_id":"me","bubble_id":"b3","approver_ids":[],"bubble":{"id":"b3","name":"Books","logo":"${base}b3/x.jpg"}}"""
        val r: JoinRequest = BoolaaJson.json.decodeFromJsonElement(BoolaaJson.json.parseToJsonElement(json))
        assertEquals("${base}b3/x.jpg", r.bubble?.logo)
    }

    @Test fun strings_in_all_locales() {
        val keys = listOf("bubble_photo", "add_bubble_photo", "change_bubble_photo", "remove_bubble_photo", "bubble_photo_hint", "bubble_photo_of")
        val res = listOf(File("src/main/res"), File("app/src/main/res")).first { it.isDirectory }
        for (dir in listOf("values", "values-ro", "values-fr", "values-es", "values-it")) {
            val xml = File(res, "$dir/strings.xml").readText()
            for (k in keys) assertTrue("$dir/$k", xml.contains("name=\"$k\""))
            assertTrue("$dir placeholder", Regex("name=\"bubble_photo_of\">[^<]*%1\\\$s").containsMatchIn(xml))
        }
        val ro = File(res, "values-ro/strings.xml").readText()
        assertFalse("ro uses comma-below diacritics", Regex("name=\"(add_)?bubble_photo[a-z_]*\">[^<]*[şţ]").containsMatchIn(ro))
    }
}
