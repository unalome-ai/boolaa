package com.boolaa.app.core

import android.icu.text.RelativeDateTimeFormatter
import android.icu.util.ULocale
import java.text.NumberFormat
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlin.math.abs

/** Locale-aware formatting. Never hard-code date patterns (docs/i18n-glossary.md). */
object Formats {
    fun dateTime(instant: Instant, locale: Locale, zone: ZoneId = ZoneId.systemDefault()): String =
        DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withLocale(locale).format(instant.atZone(zone))

    /** "22 November 2026, 21:30": long date, short time (the suspended screen's end date, as on web). */
    fun longDateTime(instant: Instant, locale: Locale, zone: ZoneId = ZoneId.systemDefault()): String =
        DateTimeFormatter.ofLocalizedDateTime(FormatStyle.LONG, FormatStyle.SHORT).withLocale(locale).format(instant.atZone(zone))

    fun date(instant: Instant, locale: Locale, zone: ZoneId = ZoneId.systemDefault()): String =
        DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale).format(instant.atZone(zone))

    fun time(instant: Instant, locale: Locale, zone: ZoneId = ZoneId.systemDefault()): String =
        DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale).format(instant.atZone(zone))

    fun number(value: Long, locale: Locale): String = NumberFormat.getIntegerInstance(locale).format(value)

    /** "5 min. ago", "in 3 days", "now", in the given locale (ICU RelativeDateTimeFormatter). */
    fun relative(instant: Instant, locale: Locale, now: Instant = Instant.now()): String {
        val f = RelativeDateTimeFormatter.getInstance(
            ULocale.forLocale(locale), null, RelativeDateTimeFormatter.Style.SHORT,
            android.icu.text.DisplayContext.CAPITALIZATION_FOR_STANDALONE,
        )
        val seconds = Duration.between(now, instant).seconds
        val dir = if (seconds < 0) RelativeDateTimeFormatter.Direction.LAST else RelativeDateTimeFormatter.Direction.NEXT
        val s = abs(seconds)
        return when {
            s < 60 -> f.format(RelativeDateTimeFormatter.Direction.PLAIN, RelativeDateTimeFormatter.AbsoluteUnit.NOW)
            s < 3600 -> f.format((s / 60).toDouble(), dir, RelativeDateTimeFormatter.RelativeUnit.MINUTES)
            s < 86_400 -> f.format((s / 3600).toDouble(), dir, RelativeDateTimeFormatter.RelativeUnit.HOURS)
            s < 7 * 86_400 -> f.format((s / 86_400).toDouble(), dir, RelativeDateTimeFormatter.RelativeUnit.DAYS)
            else -> date(instant, locale)
        }
    }
}
