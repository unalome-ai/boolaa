package com.boolaa.app

import com.boolaa.app.core.BoolaaJson
import com.boolaa.app.core.ExpiryLabel
import com.boolaa.app.core.ExpiryPreset
import com.boolaa.app.core.FoodExpiry
import com.boolaa.app.core.PushPayload
import com.boolaa.app.core.PushRouting
import com.boolaa.app.core.PushScreen
import com.boolaa.app.core.PushType
import com.boolaa.app.core.RequestRules
import com.boolaa.app.core.RequesterView
import com.boolaa.app.core.UserFacingError
import com.boolaa.app.model.FoodPost
import com.boolaa.app.model.ItemKind
import com.boolaa.app.model.ItemRequest
import com.boolaa.app.model.MarketAvailability
import com.boolaa.app.model.MarketItem
import com.boolaa.app.model.RequestStatus
import com.boolaa.app.model.UserProfile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

/** "I want it" requests and food expiry (docs/boolaa-spec.md "Requests and picking", "Food expiry"): the pure rules. */
class RequestsTest {
    private val zone = ZoneId.of("Europe/Bucharest")
    private fun local(s: String) = java.time.LocalDateTime.parse(s).atZone(zone).toInstant()

    private fun req(id: String, item: String = "i1", by: String = "u-$id", status: RequestStatus = RequestStatus.PENDING, at: String = "2026-11-24T10:00:00Z") =
        ItemRequest(id, "b", "owner", by, ItemKind.MARKET, item, null, status, Instant.parse(at))

    // Food expiry

    @Test fun presets_are_end_of_local_day() {
        val now = local("2026-11-24T10:15")
        assertEquals(local("2026-11-24T23:59"), FoodExpiry.presetValue(ExpiryPreset.TODAY, now, zone))
        assertEquals(local("2026-11-25T23:59"), FoodExpiry.presetValue(ExpiryPreset.TOMORROW, now, zone))
        assertEquals(local("2026-11-27T23:59"), FoodExpiry.presetValue(ExpiryPreset.IN_3_DAYS, now, zone))
        assertNull(FoodExpiry.presetValue(ExpiryPreset.CUSTOM, now, zone))
    }

    @Test fun today_is_disabled_after_23() {
        assertTrue(FoodExpiry.todayEnabled(local("2026-11-24T22:59"), zone))
        assertFalse(FoodExpiry.todayEnabled(local("2026-11-24T23:00"), zone))
    }

    @Test fun custom_limits_and_default() {
        val now = local("2026-11-24T10:00")
        assertEquals(local("2026-11-25T18:00"), FoodExpiry.defaultCustom(now, zone))
        assertEquals(now.plusSeconds(15 * 60), FoodExpiry.clampCustom(now, now))
        assertEquals(now.plus(java.time.Duration.ofDays(14)).minusSeconds(300), FoodExpiry.clampCustom(now.plus(java.time.Duration.ofDays(20)), now))
    }

    @Test fun editing_preselects_the_matching_segment() {
        val now = local("2026-11-24T10:00")
        assertEquals(ExpiryPreset.TOMORROW, FoodExpiry.presetFor(local("2026-11-25T23:59").plusSeconds(30), now, zone))
        assertEquals(ExpiryPreset.IN_3_DAYS, FoodExpiry.presetFor(local("2026-11-27T23:59"), now, zone))
        assertEquals(ExpiryPreset.CUSTOM, FoodExpiry.presetFor(local("2026-11-25T18:00"), now, zone))
    }

    @Test fun card_labels() {
        val now = local("2026-11-24T10:00") // a Tuesday
        assertEquals(ExpiryLabel.Minutes(1), FoodExpiry.label(now.plusSeconds(20), now, zone))
        assertEquals(ExpiryLabel.Minutes(59), FoodExpiry.label(now.plusSeconds(59 * 60 + 30), now, zone))
        assertTrue(FoodExpiry.label(now.plusSeconds(600), now, zone).warning)
        assertEquals(ExpiryLabel.Hours(1), FoodExpiry.label(now.plusSeconds(3600), now, zone))
        assertEquals(ExpiryLabel.Hours(5), FoodExpiry.label(now.plusSeconds(6 * 3600 - 1), now, zone))
        assertFalse(FoodExpiry.label(now.plusSeconds(3600), now, zone).warning)
        assertEquals(ExpiryLabel.Today(local("2026-11-24T18:00")), FoodExpiry.label(local("2026-11-24T18:00"), now, zone))
        assertEquals(ExpiryLabel.Tomorrow(local("2026-11-25T08:00")), FoodExpiry.label(local("2026-11-25T08:00"), now, zone))
        assertEquals(ExpiryLabel.Weekday(local("2026-11-30T18:00")), FoodExpiry.label(local("2026-11-30T18:00"), now, zone))
        assertEquals(ExpiryLabel.Date(local("2026-12-01T18:00")), FoodExpiry.label(local("2026-12-01T18:00"), now, zone))
    }

    private fun food(id: String, expires: Instant?, availability: MarketAvailability = MarketAvailability.AVAILABLE) =
        FoodPost(id, "b", "u", "img", null, Instant.parse("2026-11-24T08:00:00Z"), expiresAt = expires, availability = availability)

    @Test fun expired_and_handed_over_food_is_never_shown() {
        val now = Instant.parse("2026-11-24T10:00:00Z")
        val posts = listOf(
            food("live", now.plusSeconds(60)), food("expired", now), food("taken", now.plusSeconds(3600), MarketAvailability.TAKEN),
            food("reserved", now.plusSeconds(120), MarketAvailability.RESERVED), food("legacy", null),
        )
        assertEquals(listOf("live", "reserved", "legacy"), FoodExpiry.visible(posts, now).map { it.id })
        assertEquals(now.plusSeconds(60), FoodExpiry.nextExpiry(posts, now))
    }

    // Requests

    @Test fun viewer_states_follow_the_ui_rules() {
        val mine = req("r")
        assertEquals(RequesterView.I_WANT_IT, RequestRules.viewerState(MarketAvailability.AVAILABLE, null))
        assertEquals(RequesterView.NONE, RequestRules.viewerState(MarketAvailability.RESERVED, null))
        assertEquals(RequesterView.NONE, RequestRules.viewerState(MarketAvailability.TAKEN, null))
        assertEquals(RequesterView.REQUESTED, RequestRules.viewerState(MarketAvailability.AVAILABLE, mine))
        assertEquals(RequesterView.ON_LIST, RequestRules.viewerState(MarketAvailability.RESERVED, mine))
        assertEquals(RequesterView.RESERVED_FOR_YOU, RequestRules.viewerState(MarketAvailability.RESERVED, mine.copy(status = RequestStatus.PICKED)))
        assertEquals(RequesterView.YOURS, RequestRules.viewerState(MarketAvailability.TAKEN, mine.copy(status = RequestStatus.RECEIVED)))
        assertEquals(RequesterView.MISSED, RequestRules.viewerState(MarketAvailability.TAKEN, mine.copy(status = RequestStatus.MISSED)))
    }

    @Test fun sheet_pins_the_pick_then_oldest_first() {
        val rows = listOf(
            req("c", at = "2026-11-24T12:00:00Z"), req("a", at = "2026-11-24T09:00:00Z"),
            req("b", at = "2026-11-24T10:00:00Z", status = RequestStatus.PICKED), req("x", item = "other"),
            req("m", at = "2026-11-24T08:00:00Z", status = RequestStatus.MISSED),
        )
        assertEquals(listOf("b", "a", "c"), RequestRules.sheetRows(rows, "i1").map { it.id })
        assertEquals("b", RequestRules.pick(rows, "i1")!!.id)
        assertEquals("a", RequestRules.mine(rows, "i1", "u-a")!!.id)
    }

    @Test fun availability_maps_onto_requests_like_the_database() {
        val rows = listOf(req("p", status = RequestStatus.PICKED), req("q"), req("o", item = "other"))
        val taken = RequestRules.applyAvailability(rows, "i1", MarketAvailability.TAKEN)
        assertEquals(listOf(RequestStatus.RECEIVED, RequestStatus.MISSED, RequestStatus.PENDING), taken.map { it.status })
        val reserved = RequestRules.applyAvailability(taken, "i1", MarketAvailability.RESERVED)
        assertEquals(listOf(RequestStatus.PICKED, RequestStatus.PENDING, RequestStatus.PENDING), reserved.map { it.status })
        val available = RequestRules.applyAvailability(reserved, "i1", MarketAvailability.AVAILABLE)
        assertTrue(available.all { it.status == RequestStatus.PENDING })
        val switched = RequestRules.applyPick(rows, rows[1])
        assertEquals(listOf(RequestStatus.PENDING, RequestStatus.PICKED, RequestStatus.PENDING), switched.map { it.status })
    }

    @Test fun merges_are_by_id_and_keep_the_requester() {
        val ana = UserProfile("u-a", "Ana")
        val rows = listOf(req("a").copy(requester = ana))
        val live = req("a").copy(status = RequestStatus.PICKED)
        val merged = RequestRules.upsert(rows, live)
        assertEquals(ana, merged.single().requester); assertEquals(RequestStatus.PICKED, merged.single().status)
        assertSame(merged, RequestRules.upsert(merged, live))
        assertSame(rows, RequestRules.remove(rows, "unknown"))
        assertTrue(RequestRules.remove(rows, "a").isEmpty())
    }

    @Test fun note_is_trimmed_and_collapsed() {
        assertEquals("see you at 6", RequestRules.normalizeNote("  see   you\n at 6 "))
        assertNull(RequestRules.normalizeNote("   "))
        assertNull(RequestRules.normalizeNote(null))
    }

    // Wire format

    @Test fun rows_decode() {
        val r = BoolaaJson.json.decodeFromString(ItemRequest.serializer(), """{"id":"r1","bubble_id":"b","owner_id":"o","requester_id":"u",
            "food_post_id":"f1","market_item_id":null,"item_kind":"food","item_id":"f1","note":null,"status":"picked",
            "created_at":"2026-11-24T10:00:00.123456+00:00","status_changed_at":"2026-11-24T10:05:00+00:00",
            "requester":{"id":"u","name":"Ana","avatar":null}}""")
        assertEquals(ItemKind.FOOD, r.itemKind); assertEquals(RequestStatus.PICKED, r.status); assertEquals("Ana", r.requester!!.name)
        val f = BoolaaJson.json.decodeFromString(FoodPost.serializer(), """{"id":"f1","bubble_id":"b","user_id":"u","image":"i",
            "created_at":"2026-11-24T10:00:00+00:00","expires_at":"2026-11-25T21:59:00+00:00","availability":"reserved",
            "handed_over_at":null,"request_count":3}""")
        assertEquals(Instant.parse("2026-11-25T21:59:00Z"), f.expiresAt); assertEquals(MarketAvailability.RESERVED, f.availability)
        assertEquals(3, f.requestCount)
        val m = BoolaaJson.json.decodeFromString(MarketItem.serializer(), """{"id":"m","bubble_id":"b","owner_id":"o","image":"i",
            "title":"Sofa","created_at":"2026-11-24T10:00:00+00:00","request_count":2}""")
        assertEquals(2, m.requestCount)
    }

    @Test fun backend_errors_map_to_the_glossary_messages() {
        mapOf(
            "item not found" to UserFacingError.ITEM_GONE, "item not available" to UserFacingError.ITEM_NOT_AVAILABLE,
            "already requested" to UserFacingError.ALREADY_REQUESTED, "cannot request own item" to UserFacingError.CANNOT_REQUEST_OWN,
            "request note too long" to UserFacingError.REQUEST_NOTE_TOO_LONG, "item request gone" to UserFacingError.REQUEST_GONE,
            "request already decided" to UserFacingError.REQUEST_DECIDED, "nothing picked" to UserFacingError.NOTHING_PICKED,
            "invalid expiry" to UserFacingError.INVALID_EXPIRY, "not your item" to UserFacingError.GENERIC,
            "invalid item kind" to UserFacingError.GENERIC,
            // Older texts keep their mapping.
            "request not found" to UserFacingError.REQUEST_NOT_FOUND, "event not found" to UserFacingError.EVENT_NOT_FOUND,
        ).forEach { (text, kind) -> assertEquals(text, kind, UserFacingError.classify(text, "P0001")) }
    }

    // Push

    private val bubble = "0b6d6c4e-8f0a-4a39-9b55-6f2a1c0d9e11"
    private val item = "3c2b1a09-8f7e-4d6c-9b5a-0f1e2d3c4b5a"

    @Test fun request_pushes_open_the_item_and_the_owner_sheet() {
        fun p(type: String, kind: String?) =
            PushPayload.from(mapOf("type" to type, "bubble_id" to bubble, "target_id" to item, "item_kind" to kind))!!
        val owner = PushRouting.resolve(p("item_request", "food"), listOf(bubble))
        assertEquals(PushScreen.FOOD, owner.screen); assertEquals(item, owner.highlightId); assertTrue(owner.openRequests)
        assertTrue(PushRouting.resolve(p("item_request_withdrawn", "market"), listOf(bubble)).let { it.openRequests && it.screen == PushScreen.MARKETPLACE })
        val picked = PushRouting.resolve(p("item_picked", "market"), listOf(bubble))
        assertEquals(PushScreen.MARKETPLACE, picked.screen); assertFalse(picked.openRequests)
        assertFalse(PushRouting.resolve(p("item_missed", "food"), listOf(bubble)).openRequests)
        assertEquals(PushScreen.HOME, PushRouting.resolve(p("item_picked", "nonsense"), listOf(bubble)).screen)
        assertEquals("item_request:$item", p("item_request", "food").tag)
        assertEquals("item:$item", p("item_missed", "food").tag)
        assertTrue(PushType.entries.filter { it.isRequest }.size == 4)
        // item_kind is ignored for the other types.
        assertNull(PushPayload.from(mapOf("type" to "food", "bubble_id" to bubble, "item_kind" to "food"))!!.itemKind)
    }
}
