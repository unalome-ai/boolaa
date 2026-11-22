package com.boolaa.app

import com.boolaa.app.core.CodePurpose
import com.boolaa.app.core.DataExport
import com.boolaa.app.core.DataExportException
import com.boolaa.app.core.DeviceCodeBody
import com.boolaa.app.core.SensitiveAction
import com.boolaa.app.core.UserFacingError
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant

/** "Download my data": the sensitive action, the `data-export` error mapping and the saved file's name. */
class DataExportTest {
    private val now = Instant.parse("2026-11-22T23:30:00Z")

    @Test fun export_data_is_a_sensitive_action() {
        assertEquals("export_data", SensitiveAction.EXPORT_DATA.wire)
        val body = DeviceCodeBody.send(CodePurpose.SENSITIVE_ACTION, null, null, SensitiveAction.EXPORT_DATA, "ro")
        assertEquals("send", body["action"]!!.jsonPrimitive.content)
        assertEquals("sensitive_action", body["purpose"]!!.jsonPrimitive.content)
        assertEquals("export_data", body["sensitive_action"]!!.jsonPrimitive.content)
        assertEquals("ro", body["locale"]!!.jsonPrimitive.content)
    }

    @Test fun http_errors_map_to_user_errors() {
        fun map(status: Int, body: String?) = UserFacingError.classify(DataExportException.from(status, body))
        assertEquals(UserFacingError.NOT_AUTHENTICATED, map(401, """{"error":"unauthorized"}"""))
        assertEquals(UserFacingError.NOT_AUTHENTICATED, map(401, null))
        assertEquals(UserFacingError.SESSION_NOT_VERIFIED, map(403, """{"error":"session_not_verified"}"""))
        assertEquals(UserFacingError.REAUTHENTICATION_REQUIRED, map(403, """{"error":"reauthentication_required"}"""))
        assertEquals(UserFacingError.EXPORT_RATE_LIMITED, map(429, """{"error":"export_rate_limited","retry_after":1800}"""))
        assertEquals(UserFacingError.GENERIC, map(500, """{"error":"server_error"}"""))
        assertEquals(UserFacingError.GENERIC, map(502, "<html>Bad gateway</html>"))
        assertEquals(R.string.error_export_rate_limited, UserFacingError.EXPORT_RATE_LIMITED.message)
    }

    @Test fun parses_the_error_body() {
        val e = DataExportException.from(429, """{"error":"export_rate_limited","retry_after":1800}""")
        assertEquals(429, e.status)
        assertEquals("export_rate_limited", e.code)
        assertEquals(1800, e.retryAfter)
        val unreadable = DataExportException.from(500, "oops")
        assertEquals("server_error", unreadable.code)
        assertNull(unreadable.retryAfter)
    }

    @Test fun filename_from_content_disposition() {
        assertEquals("boolaa-data-2026-11-20.json", DataExport.filename("""attachment; filename="boolaa-data-2026-11-20.json"""", now))
        assertEquals("boolaa-data-2026-11-20.json", DataExport.filename("attachment; filename=boolaa-data-2026-11-20.json", now))
        assertEquals("boolaa-data-2026-11-20.json", DataExport.filename("ATTACHMENT; FILENAME=\"boolaa-data-2026-11-20.json\"; size=42", now))
        assertEquals("données.json", DataExport.filename("attachment; filename=\"x.json\"; filename*=UTF-8''donn%C3%A9es.json", now))
        assertEquals("evil.json", DataExport.filename("""attachment; filename="../../evil.json"""", now))
    }

    @Test fun filename_falls_back_to_the_utc_date() {
        assertEquals("boolaa-data-2026-11-22.json", DataExport.filename(null, now))
        assertEquals("boolaa-data-2026-11-22.json", DataExport.filename("attachment", now))
        assertEquals("boolaa-data-2026-11-22.json", DataExport.filename("attachment; filename=\"\"", now))
        // 23:30 UTC is already the 23rd in Bucharest; the name stays in UTC.
        assertEquals("boolaa-data-2026-11-22.json", DataExport.fallbackFilename(now))
    }
}
