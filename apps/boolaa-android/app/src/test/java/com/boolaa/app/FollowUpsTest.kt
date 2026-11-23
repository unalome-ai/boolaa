package com.boolaa.app

import com.boolaa.app.core.DataExport
import com.boolaa.app.core.DataExportException
import com.boolaa.app.core.DeviceCodeException
import com.boolaa.app.core.EventSchedule
import com.boolaa.app.core.Linkify
import com.boolaa.app.core.UserFacingError
import com.boolaa.app.model.BubbleEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.Instant

/** QA follow-ups: chat links, past events, the export limit up front, the preview hint (docs/boolaa-spec.md). */
class FollowUpsTest {
    @Test fun linkify_http_and_www_keeps_trailing_punctuation_as_text() {
        val text = "See https://example.com/a_(b), www.boolaa.ro. and http://x.y/z?q=1! not ftp://no or wwwx.com"
        val parts = Linkify.split(text)
        assertEquals(
            listOf("https://example.com/a_(b)" to "https://example.com/a_(b)", "www.boolaa.ro" to "https://www.boolaa.ro",
                "http://x.y/z?q=1" to "http://x.y/z?q=1"),
            parts.filter { it.url != null }.map { it.text to it.url },
        )
        assertEquals(text, parts.joinToString("") { it.text })
        assertEquals("https://a.com", Linkify.split("(see https://a.com)").first { it.url != null }.text)
        assertTrue(Linkify.split("https://").none { it.url != null })
        assertEquals(listOf(Linkify.Part("no links")), Linkify.split("no links"))
    }

    private fun event(title: String, hoursFromNow: Double, now: Instant) = BubbleEvent(
        title, "b", "c", title, datetime = now.plusSeconds((hoursFromNow * 3600).toLong()), createdAt = Instant.EPOCH)

    @Test fun events_end_one_hour_after_the_start() {
        val now = Instant.ofEpochSecond(1_795_000_000)
        assertFalse(EventSchedule.hasEnded(event("a", -0.5, now), now))
        assertTrue(EventSchedule.hasEnded(event("b", -1.0, now), now))
        val (upcoming, past) = EventSchedule.split(
            listOf(event("old", -48.0, now), event("later", 24.0, now), event("running", -0.25, now), event("recent", -2.0, now)), now)
        assertEquals(listOf("running", "later"), upcoming.map { it.title })
        assertEquals(listOf("recent", "old"), past.map { it.title })
    }

    @Test fun event_has_ended_is_mapped() {
        assertEquals(UserFacingError.EVENT_ENDED, UserFacingError.classify("event has ended", "P0001"))
    }

    @Test fun export_limit_time_from_either_function() {
        val now = Instant.ofEpochSecond(1_795_000_000)
        val send = DeviceCodeException.from(429, """{"error":"export_rate_limited","retry_after":1200}""")
        assertEquals(1200, send.retryAfter)
        assertEquals(UserFacingError.EXPORT_RATE_LIMITED, UserFacingError.fromFunctionCode(send.code))
        assertEquals(now.plusSeconds(1200), DataExport.limitedUntil(send, now))
        assertEquals(now.plusSeconds(60), DataExport.limitedUntil(DataExportException(429, "export_rate_limited", 60), now))
        assertNull(DataExport.limitedUntil(DeviceCodeException(429, "rate_limited"), now))
    }

    /** Every locale names the current bubble (a placeholder), never the seeded "Flatmates". */
    @Test fun preview_hint_takes_the_bubble_name() {
        val res = listOf("src/main/res", "app/src/main/res").map(::File).first { it.isDirectory }
        for (dir in listOf("values", "values-ro", "values-fr", "values-es", "values-it")) {
            val xml = File(res, "$dir/strings_push.xml").readText()
            val hint = Regex("""name="notifications_preview_hint">(.*?)</string>""").find(xml)!!.groupValues[1]
            assertTrue("$dir: $hint", hint.contains("%1\$s") && !hint.contains("Flatmates"))
            assertTrue(dir, File(res, "$dir/strings_export.xml").readText().contains("error_export_rate_limited_until"))
            assertTrue(dir, File(res, "$dir/strings_past_events.xml").readText().contains("went_count"))
        }
    }
}
