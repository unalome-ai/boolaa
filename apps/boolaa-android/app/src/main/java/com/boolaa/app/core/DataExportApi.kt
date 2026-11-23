package com.boolaa.app.core

import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.exceptions.RestException
import io.github.jan.supabase.functions.functions
import io.github.jan.supabase.postgrest.postgrest
import io.ktor.client.statement.bodyAsBytes
import io.ktor.http.HttpHeaders
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.net.URLDecoder
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

// "Download my data" (GDPR export): a verified `export_data` sensitive-action code, then the `data-export`
// Edge Function in the same session, which answers one JSON file.

/** A `data-export` failure: HTTP [status], its `error` code and, for `export_rate_limited`, `retry_after` seconds. */
class DataExportException(val status: Int, val code: String, val retryAfter: Int? = null) :
    RuntimeException("data-export $status $code") {
    companion object {
        /** Parses the function's JSON body; anything unreadable becomes `server_error` (`unauthorized` for a 401). */
        fun from(status: Int, body: String?): DataExportException {
            val obj = runCatching { BoolaaJson.json.parseToJsonElement(body.orEmpty()).jsonObject }.getOrNull()
            val code = obj?.get("error")?.jsonPrimitive?.contentOrNull ?: if (status == 401) "unauthorized" else "server_error"
            return DataExportException(status, code, obj?.get("retry_after")?.jsonPrimitive?.intOrNull)
        }
    }
}

/** The export: the raw response bytes and the name to save them under. */
class DataExportFile(val bytes: ByteArray, val filename: String)

object DataExport {
    const val FUNCTION = "data-export"
    const val MIME_TYPE = "application/json"

    /** `boolaa-data-<yyyy-MM-dd in UTC>.json`, used when the response has no usable Content-Disposition. */
    fun fallbackFilename(now: Instant = Instant.now()): String =
        "boolaa-data-${DateTimeFormatter.ISO_LOCAL_DATE.withZone(ZoneOffset.UTC).format(now)}.json"

    /** The file name from `Content-Disposition` (`filename*=UTF-8''…` or `filename="…"`), else [fallbackFilename]. */
    fun filename(contentDisposition: String?, now: Instant = Instant.now()): String {
        val header = contentDisposition.orEmpty()
        val extended = Regex("""filename\*\s*=\s*([^;]+)""", RegexOption.IGNORE_CASE).find(header)?.groupValues?.get(1)?.trim()
            ?.substringAfter("''")?.trim('"')
            ?.let { runCatching { URLDecoder.decode(it, "UTF-8") }.getOrNull() }
        val plain = Regex("""(?:^|;)\s*filename\s*=\s*("([^"]*)"|[^;]*)""", RegexOption.IGNORE_CASE).find(header)
            ?.let { m -> m.groupValues[2].ifEmpty { m.groupValues[1] } }?.trim()?.trim('"')
        // Never a path: keep the last segment only.
        val name = (extended ?: plain)?.substringAfterLast('/')?.substringAfterLast('\\')?.trim()
        return if (name.isNullOrEmpty() || name == "." || name == "..") fallbackFilename(now) else name
    }

    /** The "try again after" time carried by a rate-limit error (the `device-code` send step or `data-export`), else null. */
    fun limitedUntil(error: Throwable, now: Instant = Instant.now()): Instant? {
        val seconds = when (error) {
            is DataExportException -> error.retryAfter.takeIf { error.code == "export_rate_limited" }
            is DeviceCodeException -> error.retryAfter.takeIf { error.code == "export_rate_limited" }
            else -> null
        }
        return seconds?.takeIf { it > 0 }?.let { now.plusSeconds(it.toLong()) }
    }

    /** The function's `error` codes as user-facing errors. */
    fun userError(code: String): UserFacingError = when (code) {
        "unauthorized" -> UserFacingError.NOT_AUTHENTICATED
        "session_not_verified" -> UserFacingError.SESSION_NOT_VERIFIED
        "reauthentication_required" -> UserFacingError.REAUTHENTICATION_REQUIRED
        "export_rate_limited" -> UserFacingError.EXPORT_RATE_LIMITED
        else -> UserFacingError.GENERIC
    }
}

/**
 * When the next data export is allowed (one an hour), or null when it is allowed now. Asked BEFORE the `export_data`
 * code is emailed (`data_export_available_at`, 20261123220000_past_events_export_check.sql).
 */
suspend fun BoolaaApi.dataExportAvailableAt(now: Instant = Instant.now()): Instant? {
    val raw = client.postgrest.rpc("data_export_available_at").data
    val text = runCatching { BoolaaJson.json.parseToJsonElement(raw).jsonPrimitive.contentOrNull }.getOrNull() ?: return null
    val at = runCatching { java.time.OffsetDateTime.parse(text).toInstant() }.getOrNull() ?: return null
    return at.takeIf { it.isAfter(now) }
}

/**
 * Calls `data-export` with the user's JWT and returns the raw bytes. A 401 refreshes the session and retries once;
 * a second 401 is thrown (shown as "session expired").
 */
suspend fun BoolaaApi.exportMyData(): DataExportFile {
    suspend fun call(): DataExportFile {
        val response = try {
            client.functions.invoke(DataExport.FUNCTION, buildJsonObject {})
        } catch (e: RestException) {
            throw DataExportException.from(e.statusCode, e.error)
        }
        return DataExportFile(response.bodyAsBytes(), DataExport.filename(response.headers[HttpHeaders.ContentDisposition]))
    }
    return try {
        call()
    } catch (e: DataExportException) {
        if (e.status != 401) throw e
        runCatching { client.auth.refreshCurrentSession() }.getOrElse { throw e }
        call()
    }
}
