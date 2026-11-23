package com.boolaa.app.core

import com.boolaa.app.model.BubbleEvent
import java.time.Instant

/**
 * Past events (docs/boolaa-spec.md "Events"). Events store only their start and last 1 hour (like "Add to
 * calendar"), so an event has ended once start + 1 h has passed. The server (`event_has_ended`, toggle_rsvp refuses
 * ended events), web and iOS use the same rule.
 */
object EventSchedule {
    const val DURATION_MS = CalendarExport.DEFAULT_DURATION_MS

    fun hasEnded(event: BubbleEvent, now: Instant): Boolean = !event.datetime.plusMillis(DURATION_MS).isAfter(now)

    /** Upcoming events (soonest first) and past ones (most recent first). */
    fun split(events: List<BubbleEvent>, now: Instant): Pair<List<BubbleEvent>, List<BubbleEvent>> {
        val sorted = events.sortedBy { it.datetime }
        val (past, upcoming) = sorted.partition { hasEnded(it, now) }
        return upcoming to past.reversed()
    }
}
