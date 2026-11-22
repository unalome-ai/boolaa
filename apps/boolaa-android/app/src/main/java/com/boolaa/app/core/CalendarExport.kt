package com.boolaa.app.core

import android.content.Intent
import android.provider.CalendarContract
import com.boolaa.app.model.BubbleEvent

/**
 * "Add to calendar" (docs/boolaa-spec.md, Events). Events only store a start (`datetime`), so the calendar entry
 * lasts [DEFAULT_DURATION_MS] (1 hour), the same on web (.ics) and iOS (EventKit).
 */
data class CalendarDraft(
    val beginMillis: Long,
    val endMillis: Long,
    val title: String,
    val description: String?,
    val location: String?,
)

object CalendarExport {
    const val DEFAULT_DURATION_MS = 60 * 60 * 1000L

    fun draft(event: BubbleEvent): CalendarDraft {
        val begin = event.datetime.toEpochMilli()
        return CalendarDraft(
            beginMillis = begin,
            endMillis = begin + DEFAULT_DURATION_MS,
            title = event.title,
            description = event.description?.trim()?.takeIf { it.isNotEmpty() },
            location = event.location?.trim()?.takeIf { it.isNotEmpty() },
        )
    }

    /** The calendar app's own "new event" screen, prefilled; the user confirms there. Needs no permission. */
    fun intent(draft: CalendarDraft): Intent = Intent(Intent.ACTION_INSERT)
        .setData(CalendarContract.Events.CONTENT_URI)
        .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, draft.beginMillis)
        .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, draft.endMillis)
        .putExtra(CalendarContract.Events.TITLE, draft.title)
        .apply {
            draft.description?.let { putExtra(CalendarContract.Events.DESCRIPTION, it) }
            draft.location?.let { putExtra(CalendarContract.Events.EVENT_LOCATION, it) }
        }
}
