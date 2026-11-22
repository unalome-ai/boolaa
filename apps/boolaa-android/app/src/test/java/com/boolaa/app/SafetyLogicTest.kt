package com.boolaa.app

import com.boolaa.app.core.BoolaaJson
import com.boolaa.app.core.Legal
import com.boolaa.app.model.Block
import com.boolaa.app.model.ReportReason
import com.boolaa.app.model.ReportTargetType
import org.junit.Assert.assertEquals
import org.junit.Test
import kotlinx.serialization.decodeFromString

class SafetyLogicTest {
    @Test fun wire_values_match_the_schema_checks() {
        assertEquals(listOf("spam", "harassment", "hate", "sexual", "violence", "self_harm", "other"), ReportReason.entries.map { it.wire })
        assertEquals(listOf("user", "chat_message", "event", "food_post", "market_item", "shared_link"), ReportTargetType.entries.map { it.wire })
    }

    @Test fun legal_urls_carry_the_app_language() {
        assertEquals("http://localhost:3200/privacy?lang=ro", Legal.url(Legal.Page.PRIVACY, "ro", "http://localhost:3200/"))
        assertEquals("https://boolaa.app/terms?lang=fr", Legal.url(Legal.Page.TERMS, "fr", "https://boolaa.app"))
    }

    @Test fun block_row_decodes_with_embedded_user() {
        val json = """{"blocker_id":"a","blocked_id":"b","created_at":"2026-11-22 14:01:02.12345+00","blocked":{"id":"b","name":"Bob","avatar":null}}"""
        val block = BoolaaJson.json.decodeFromString<Block>(json)
        assertEquals("b", block.blockedId)
        assertEquals("Bob", block.blocked?.name)
    }
}
