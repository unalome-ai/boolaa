package com.boolaa.app.core

import kotlinx.serialization.KSerializer
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import java.time.Instant
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeFormatterBuilder
import java.time.temporal.ChronoField

/** JSON shared by PostgREST responses, realtime payloads and test fixtures. */
object BoolaaJson {
    val json: Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        coerceInputValues = true
    }

    // Accepts "T" or " " between date and time, 0-9 fractional digits, and offsets "Z", "+00", "+0000", "+00:00".
    private val flexible: DateTimeFormatter = DateTimeFormatterBuilder()
        .append(DateTimeFormatter.ISO_LOCAL_DATE)
        .optionalStart().appendLiteral('T').optionalEnd()
        .optionalStart().appendLiteral(' ').optionalEnd()
        .appendValue(ChronoField.HOUR_OF_DAY, 2).appendLiteral(':')
        .appendValue(ChronoField.MINUTE_OF_HOUR, 2)
        .optionalStart().appendLiteral(':').appendValue(ChronoField.SECOND_OF_MINUTE, 2).optionalEnd()
        .optionalStart().appendFraction(ChronoField.NANO_OF_SECOND, 0, 9, true).optionalEnd()
        .optionalStart().appendOffset("+HH:MM", "Z").optionalEnd()
        .optionalStart().appendOffset("+HHMM", "Z").optionalEnd()
        .optionalStart().appendOffset("+HH", "Z").optionalEnd()
        .toFormatter()

    /**
     * Parses Postgres `timestamptz` output in the shapes PostgREST and Realtime emit:
     * `2026-11-22T15:26:52.414517+00:00`, `2026-11-22T15:26:52Z` and `2026-11-22 15:26:52.414517+00`
     * (realtime records, which `Instant.parse` rejects). Returns null when unparseable.
     */
    fun parseTimestamp(raw: String): Instant? {
        val s = raw.trim()
        return runCatching { OffsetDateTime.parse(s, flexible).toInstant() }
            .recoverCatching { Instant.parse(s) }
            .getOrNull()
    }

    fun formatTimestamp(instant: Instant): String = DateTimeFormatter.ISO_INSTANT.format(instant)
}

/** kotlinx serializer for `timestamptz` columns, tolerant of the realtime format. */
object InstantSerializer : KSerializer<Instant> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("BoolaaInstant", PrimitiveKind.STRING)
    override fun serialize(encoder: Encoder, value: Instant) = encoder.encodeString(BoolaaJson.formatTimestamp(value))
    override fun deserialize(decoder: Decoder): Instant {
        val raw = decoder.decodeString()
        return BoolaaJson.parseTimestamp(raw) ?: throw IllegalArgumentException("Unrecognised timestamp: $raw")
    }
}
