package com.boolaa.app.core

import com.boolaa.app.model.FoodPost
import com.boolaa.app.model.MarketAvailability
import java.time.Duration
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId
import java.time.temporal.ChronoUnit

/** The "Good until" segments of the food form (docs/boolaa-spec.md "Food expiry"). */
enum class ExpiryPreset { TODAY, TOMORROW, IN_3_DAYS, CUSTOM }

/** The relative label under a food card's description; [warning] = less than an hour left. */
sealed interface ExpiryLabel {
    val warning: Boolean get() = false
    data class Minutes(val count: Int) : ExpiryLabel { override val warning get() = true }
    data class Hours(val count: Int) : ExpiryLabel
    data class Today(val at: Instant) : ExpiryLabel
    data class Tomorrow(val at: Instant) : ExpiryLabel
    /** Within 7 days: "Good until Friday 18:00". */
    data class Weekday(val at: Instant) : ExpiryLabel
    /** Later: "Good until 3 Dec, 18:00". */
    data class Date(val at: Instant) : ExpiryLabel
}

/** Pure food-expiry rules (unit-tested; same as web and iOS). Local times use [ZoneId]; the server checks the instant. */
object FoodExpiry {
    /** Server limit: in the future and at most 14 days ahead. */
    val MAX_AHEAD: Duration = Duration.ofDays(14)
    /** Custom picker margins: min now + 15 min, max now + 14 days − 5 min (clock skew). */
    val CUSTOM_MIN: Duration = Duration.ofMinutes(15)
    val CUSTOM_MAX: Duration = MAX_AHEAD.minusMinutes(5)
    private val END_OF_DAY: LocalTime = LocalTime.of(23, 59)

    /** Today / Tomorrow / In 3 days = 23:59 local on that day. */
    fun presetValue(preset: ExpiryPreset, now: Instant, zone: ZoneId): Instant? {
        val days = when (preset) {
            ExpiryPreset.TODAY -> 0L
            ExpiryPreset.TOMORROW -> 1L
            ExpiryPreset.IN_3_DAYS -> 3L
            ExpiryPreset.CUSTOM -> return null
        }
        return now.atZone(zone).toLocalDate().plusDays(days).atTime(END_OF_DAY).atZone(zone).toInstant()
    }

    /** "Today" is disabled after 23:00 (less than an hour left). */
    fun todayEnabled(now: Instant, zone: ZoneId): Boolean = now.atZone(zone).hour < 23

    fun customMin(now: Instant): Instant = now.plus(CUSTOM_MIN)
    fun customMax(now: Instant): Instant = now.plus(CUSTOM_MAX)

    /** The custom picker's first value: tomorrow 18:00, kept within the picker's limits. */
    fun defaultCustom(now: Instant, zone: ZoneId): Instant =
        clampCustom(now.atZone(zone).toLocalDate().plusDays(1).atTime(18, 0).atZone(zone).toInstant(), now)

    fun clampCustom(value: Instant, now: Instant): Instant = when {
        value.isBefore(customMin(now)) -> customMin(now)
        value.isAfter(customMax(now)) -> customMax(now)
        else -> value
    }

    /** Editing: the segment whose value equals [expiresAt] to the minute, else [ExpiryPreset.CUSTOM]. */
    fun presetFor(expiresAt: Instant, now: Instant, zone: ZoneId): ExpiryPreset {
        val minute = expiresAt.truncatedTo(ChronoUnit.MINUTES)
        return listOf(ExpiryPreset.TODAY, ExpiryPreset.TOMORROW, ExpiryPreset.IN_3_DAYS)
            .firstOrNull { presetValue(it, now, zone)?.truncatedTo(ChronoUnit.MINUTES) == minute } ?: ExpiryPreset.CUSTOM
    }

    /** Food lists and Home never render handed-over food or a post whose expiry has passed (RLS hides it at the next load). */
    fun isVisible(post: FoodPost, now: Instant): Boolean =
        post.availability != MarketAvailability.TAKEN && (post.expiresAt?.isAfter(now) ?: true)

    fun visible(posts: List<FoodPost>, now: Instant): List<FoodPost> = posts.filter { isVisible(it, now) }

    /** When the screen must re-render next: the earliest expiry still ahead. */
    fun nextExpiry(posts: List<FoodPost>, now: Instant): Instant? =
        posts.mapNotNull { it.expiresAt }.filter { it.isAfter(now) }.minOrNull()

    fun label(expiresAt: Instant, now: Instant, zone: ZoneId): ExpiryLabel {
        val left = Duration.between(now, expiresAt)
        if (left < Duration.ofHours(1)) return ExpiryLabel.Minutes(left.toMinutes().toInt().coerceAtLeast(1))
        if (left < Duration.ofHours(6)) return ExpiryLabel.Hours(left.toHours().toInt())
        val days = ChronoUnit.DAYS.between(now.atZone(zone).toLocalDate(), expiresAt.atZone(zone).toLocalDate())
        return when {
            days <= 0L -> ExpiryLabel.Today(expiresAt)
            days == 1L -> ExpiryLabel.Tomorrow(expiresAt)
            days < 7L -> ExpiryLabel.Weekday(expiresAt)
            else -> ExpiryLabel.Date(expiresAt)
        }
    }
}
