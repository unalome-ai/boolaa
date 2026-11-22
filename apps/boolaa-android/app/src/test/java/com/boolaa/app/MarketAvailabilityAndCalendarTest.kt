package com.boolaa.app

import android.content.Intent
import android.provider.CalendarContract
import com.boolaa.app.core.BoolaaJson
import com.boolaa.app.core.CalendarExport
import com.boolaa.app.core.FeedMerge
import com.boolaa.app.core.FeedSpecs
import com.boolaa.app.model.BubbleEvent
import com.boolaa.app.model.MarketAvailability
import com.boolaa.app.model.MarketItem
import com.boolaa.app.model.MarketStatus
import com.boolaa.app.ui.market.MarketFilter
import com.boolaa.app.ui.market.MarketRules
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.Instant

/** Marketplace availability (decoding, order, hide taken, "Ask in chat") and the "Add to calendar" intent. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = android.app.Application::class)
class MarketAvailabilityAndCalendarTest {
    private val me = "11111111-1111-1111-1111-111111111111"
    private val bob = "22222222-2222-2222-2222-222222222222"

    private fun json(id: String, availability: String?, created: String = "2026-11-22T10:00:00+00:00") = """
        {"id":"$id","bubble_id":"b","owner_id":"$bob","image":"x","title":"T $id","status":"trade",
         ${availability?.let { "\"availability\":\"$it\"," } ?: ""} "created_at":"$created"}
    """.trimIndent()

    private fun decode(s: String) = BoolaaJson.json.decodeFromString(MarketItem.serializer(), s)

    private fun item(id: String, a: MarketAvailability, minute: Int, owner: String = bob, status: MarketStatus = MarketStatus.FREE) =
        MarketItem(id, "b", owner, "x", "T $id", null, status, a, Instant.parse("2026-11-22T10:%02d:00Z".format(minute)))

    @Test fun decodes_availability_with_default_for_missing_and_unknown() {
        assertEquals(MarketAvailability.RESERVED, decode(json("1", "reserved")).availability)
        assertEquals(MarketAvailability.TAKEN, decode(json("1", "taken")).availability)
        assertEquals(MarketAvailability.AVAILABLE, decode(json("1", "available")).availability)
        assertEquals(MarketAvailability.AVAILABLE, decode(json("1", null)).availability)
        assertEquals(MarketAvailability.AVAILABLE, decode(json("1", "sold-out")).availability)
        assertEquals(MarketStatus.TRADE, decode(json("1", "taken")).status)
    }

    @Test fun taken_items_sink_others_stay_newest_first() {
        val items = listOf(
            item("a", MarketAvailability.TAKEN, 50), item("b", MarketAvailability.AVAILABLE, 10),
            item("c", MarketAvailability.RESERVED, 30), item("d", MarketAvailability.TAKEN, 5), item("e", MarketAvailability.AVAILABLE, 40),
        )
        assertEquals(listOf("e", "c", "b", "a", "d"), items.sortedWith(MarketRules.order).map { it.id })
    }

    @Test fun live_update_to_taken_moves_the_item_down() {
        val list = listOf(item("new", MarketAvailability.AVAILABLE, 30), item("old", MarketAvailability.AVAILABLE, 10))
            .sortedWith(FeedSpecs.market.order)
        val merged = FeedMerge.upsert(list, list.first().copy(availability = MarketAvailability.TAKEN), FeedSpecs.market)!!
        assertEquals(listOf("old", "new"), merged.map { it.id })
        assertEquals(MarketAvailability.TAKEN, merged.last().availability)
    }

    @Test fun hide_taken_and_status_filter_combine() {
        val items = listOf(
            item("free-taken", MarketAvailability.TAKEN, 1), item("free-ok", MarketAvailability.AVAILABLE, 2),
            item("trade-res", MarketAvailability.RESERVED, 3, status = MarketStatus.TRADE),
        )
        assertEquals(3, MarketRules.visible(items, MarketFilter.ALL, hideTaken = false).size)
        assertEquals(listOf("free-ok", "trade-res"), MarketRules.visible(items, MarketFilter.ALL, hideTaken = true).map { it.id })
        assertEquals(listOf("free-ok"), MarketRules.visible(items, MarketFilter.FREE, hideTaken = true).map { it.id })
        assertEquals(listOf("free-taken", "free-ok"), MarketRules.visible(items, MarketFilter.FREE, hideTaken = false).map { it.id })
    }

    @Test fun ask_in_chat_only_for_others_items_that_are_not_taken() {
        assertTrue(MarketRules.canAskOwner(item("1", MarketAvailability.AVAILABLE, 1), me))
        assertTrue(MarketRules.canAskOwner(item("1", MarketAvailability.RESERVED, 1), me))
        assertFalse(MarketRules.canAskOwner(item("1", MarketAvailability.TAKEN, 1), me))
        assertFalse(MarketRules.canAskOwner(item("1", MarketAvailability.AVAILABLE, 1, owner = me), me))
        assertFalse(MarketRules.canAskOwner(item("1", MarketAvailability.AVAILABLE, 1), null))
    }

    private fun ctx(tag: String): android.content.Context {
        val base: android.content.Context = androidx.test.core.app.ApplicationProvider.getApplicationContext()
        val config = android.content.res.Configuration(base.resources.configuration).apply { setLocale(java.util.Locale.forLanguageTag(tag)) }
        return base.createConfigurationContext(config)
    }

    @Test fun ask_draft_is_localized_and_starts_with_a_mention() {
        assertEquals("@Bob, is “Bike” still available?", ctx("en").getString(R.string.market_ask_draft, "Bob", "Bike"))
        assertEquals("@Bob, mai e disponibil „Bike”?", ctx("ro").getString(R.string.market_ask_draft, "Bob", "Bike"))
        assertEquals("@Bob, « Bike » est toujours disponible ?", ctx("fr").getString(R.string.market_ask_draft, "Bob", "Bike"))
        assertEquals("@Bob, ¿sigue disponible «Bike»?", ctx("es").getString(R.string.market_ask_draft, "Bob", "Bike"))
        assertEquals("@Bob, «Bike» è ancora disponibile?", ctx("it").getString(R.string.market_ask_draft, "Bob", "Bike"))
        assertEquals("Marchează ca Rezervat", ctx("ro").getString(R.string.market_mark_as, ctx("ro").getString(R.string.market_reserved)))
    }

    private fun event(description: String?, location: String?) = BubbleEvent(
        id = "e1", bubbleId = "b", creatorId = bob, title = "Picnic, \"park\"; bring food", description = description,
        datetime = Instant.parse("2026-12-01T17:30:00Z"), location = location, createdAt = Instant.parse("2026-11-22T10:00:00Z"),
    )

    @Test fun calendar_draft_is_one_hour_from_the_utc_start() {
        val d = CalendarExport.draft(event("Bring a blanket\nand snacks", "  Herăstrău Park "))
        assertEquals(Instant.parse("2026-12-01T17:30:00Z").toEpochMilli(), d.beginMillis)
        assertEquals(Instant.parse("2026-12-01T18:30:00Z").toEpochMilli(), d.endMillis)
        assertEquals("Picnic, \"park\"; bring food", d.title)
        assertEquals("Bring a blanket\nand snacks", d.description)
        assertEquals("Herăstrău Park", d.location)
        val blank = CalendarExport.draft(event("  ", ""))
        assertNull(blank.description)
        assertNull(blank.location)
    }

    @Test fun calendar_intent_carries_the_extras() {
        val i = CalendarExport.intent(CalendarExport.draft(event("Notes", "Park")))
        assertEquals(Intent.ACTION_INSERT, i.action)
        assertEquals(CalendarContract.Events.CONTENT_URI, i.data)
        assertEquals(Instant.parse("2026-12-01T17:30:00Z").toEpochMilli(), i.getLongExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, 0))
        assertEquals(Instant.parse("2026-12-01T18:30:00Z").toEpochMilli(), i.getLongExtra(CalendarContract.EXTRA_EVENT_END_TIME, 0))
        assertEquals("Picnic, \"park\"; bring food", i.getStringExtra(CalendarContract.Events.TITLE))
        assertEquals("Notes", i.getStringExtra(CalendarContract.Events.DESCRIPTION))
        assertEquals("Park", i.getStringExtra(CalendarContract.Events.EVENT_LOCATION))
        val bare = CalendarExport.intent(CalendarExport.draft(event(null, null)))
        assertFalse(bare.hasExtra(CalendarContract.Events.DESCRIPTION))
        assertFalse(bare.hasExtra(CalendarContract.Events.EVENT_LOCATION))
    }
}
