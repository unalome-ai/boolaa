package com.boolaa.app

import com.boolaa.app.core.ChatJump
import com.boolaa.app.core.SearchKind
import com.boolaa.app.core.SearchRules
import com.boolaa.app.core.foldForSearch
import com.boolaa.app.core.highlightRanges
import com.boolaa.app.model.ChatMessage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/** Search inside a bubble: folding, highlight ranges, RPC row decoding and the chat jump window. */
class SearchTest {
    private fun spans(text: String, vararg words: String) = highlightRanges(text, words.toList()).map { text.substring(it) }

    @Test fun diacritics_fold_away() {
        assertEquals(listOf(0..4), highlightRanges("Sărmăluțe", listOf("sarma")))
        assertEquals(listOf("Sărmă"), spans("Sărmăluțe", "sarma"))
        assertEquals(listOf("Crème", "brûlée"), spans("Crème brûlée", "creme", "brulee"))
        assertEquals(listOf("Ștrudel"), spans("Ștrudel cu mere", "strudel"))
    }

    @Test fun case_insensitive_and_substrings() {
        assertEquals(listOf("PIZZA", "pizza"), spans("PIZZA night: pizza for all", "pizza"))
        assertEquals(listOf("ZZ"), spans("PIZZA", "zz"))
        assertEquals(listOf("pizza"), spans("pizza", "PIZZA"))
    }

    @Test fun multiple_occurrences() {
        assertEquals(listOf(0..1, 3..4, 6..7), highlightRanges("ab ab ab", listOf("ab")))
        assertEquals(listOf(0..2), highlightRanges("aaa", listOf("aa")))
    }

    @Test fun overlapping_words_merge() {
        assertEquals(listOf(0..7), highlightRanges("bookcase", listOf("book", "kcase")))
        assertEquals(listOf(0..5), highlightRanges("abcdef", listOf("abc", "def")))
        assertEquals(listOf("strawberry"), spans("strawberry jam", "straw", "berry", "rawb"))
    }

    @Test fun ligatures_expand() {
        assertEquals(listOf(0..3), highlightRanges("cœur", listOf("coeur")))
        assertEquals(listOf("Œuf"), spans("Œuf poché", "oeuf"))
        assertEquals(listOf("Straße"), spans("Straße", "strasse"))
        assertEquals(listOf("Smørrebrød"), spans("Smørrebrød", "smorrebrod"))
        assertEquals(listOf("Łódź"), spans("Łódź", "lodz"))
        val (folded, map) = foldForSearch("cœur")
        assertEquals("coeur", folded)
        assertEquals(listOf(0, 1, 1, 2, 3), map.toList())
    }

    @Test fun nothing_to_highlight() {
        assertTrue(highlightRanges("Sărmăluțe", emptyList()).isEmpty())
        assertTrue(highlightRanges("Sărmăluțe", listOf("", "")).isEmpty())
        assertTrue(highlightRanges("", listOf("a")).isEmpty())
        assertTrue(highlightRanges("Sărmăluțe", listOf("pizza")).isEmpty())
    }

    @Test fun query_length_rule() {
        assertFalse(SearchRules.canSearch(""))
        assertFalse(SearchRules.canSearch(" a "))
        assertTrue(SearchRules.canSearch(" ab "))
    }

    @Test fun decodes_rpc_rows_and_drops_unknown_kinds() {
        val json = """
            [
              {"kind":"chat_message","id":"m1","title":null,"snippet":"…mâncăm sarmale duminică…","author_id":"u1","author_name":"Alice",
               "created_at":"2026-11-22T15:26:52.414517+00:00","event_at":null,"rank":0.9,"matched_words":["sarmale"]},
              {"kind":"event","id":"e1","title":"Sarmale party","snippet":null,"author_id":"u2","author_name":null,
               "created_at":"2026-11-20T10:00:00+00:00","event_at":"2026-11-30T18:30:00+00:00","rank":0.5,"matched_words":["sarmale"]},
              {"kind":"poll","id":"p1","title":"From the future","snippet":null,"author_id":"u1","author_name":"Alice",
               "created_at":"2026-11-20T10:00:00+00:00","event_at":null,"rank":0.4,"matched_words":["sarmale"]},
              {"kind":"food_post","id":"f1","author_id":"u3","created_at":"2026-11-19T09:00:00Z","rank":0.3,"matched_words":[]},
              {"kind":"shared_link","id":"l1","title":"https://example.com/sarmale","snippet":"Reteta","author_id":"u1",
               "author_name":"Alice","created_at":"2026-11-18T09:00:00Z","rank":0.2,"matched_words":["sarmale"],"extra":"ignored"}
            ]
        """.trimIndent()
        val hits = SearchRules.decode(json)
        assertEquals(listOf("m1", "e1", "f1", "l1"), hits.map { it.id })
        assertEquals(listOf(SearchKind.CHAT_MESSAGE, SearchKind.EVENT, SearchKind.FOOD_POST, SearchKind.SHARED_LINK), hits.map { it.kind })
        val m = hits[0]
        assertNull(m.title)
        assertEquals("Alice", m.authorName)
        assertNull(m.eventAt)
        assertEquals(Instant.parse("2026-11-22T15:26:52.414517Z"), m.createdAt)
        assertEquals(listOf("sarmale"), m.matchedWords)
        val e = hits[1]
        assertNull(e.snippet)
        assertNull(e.authorName)
        assertEquals(Instant.parse("2026-11-30T18:30:00Z"), e.eventAt)
        val f = hits[2]
        assertNull(f.title); assertNull(f.snippet); assertNull(f.authorName)
        assertTrue(f.matchedWords.isEmpty())
        assertTrue(SearchRules.decode("[]").isEmpty())
    }

    private val t0 = Instant.parse("2026-11-01T00:00:00Z")
    private fun msg(i: Int) = ChatMessage(id = "m%03d".format(i), bubbleId = "b", senderId = "u", content = "#$i", createdAt = t0.plusSeconds(i * 60L))

    /** `chat_messages_around` rows, newest first: [older] rows before target [target] and [newer] after it. */
    private fun around(target: Int, older: Int, newer: Int) = ((target - older)..(target + newer)).map(::msg).reversed()

    @Test fun jump_window_start_reached_when_fewer_than_25_older() {
        val full = ChatJump.window(around(100, 25, 10), "m100")!!
        assertTrue(full.hasMoreOlder)
        assertEquals(36, full.rows.size)
        val start = ChatJump.window(around(10, 10, 5), "m010")!!
        assertFalse(start.hasMoreOlder)
        val first = ChatJump.window(around(0, 0, 3), "m000")!!
        assertFalse(first.hasMoreOlder)
    }

    @Test fun jump_window_missing_target() {
        assertNull(ChatJump.window(emptyList(), "m100"))
        // Too far back for the 1000-row cap: the target isn't among the rows.
        assertNull(ChatJump.window(around(500, 25, 10).filterNot { it.id == "m500" }, "m500"))
    }

    @Test fun has_more_after_merge_keeps_older_history() {
        val window = ChatJump.window(around(100, 10, 5), "m100")!! // start reached at m090
        assertFalse(ChatJump.hasMoreAfterMerge(emptyList(), true, window))
        // Already holding m050..: the held flag still describes the oldest row.
        assertTrue(ChatJump.hasMoreAfterMerge((50..105).map(::msg), true, window))
        // Held rows only newer than the window: the window decides.
        assertFalse(ChatJump.hasMoreAfterMerge((95..105).map(::msg), true, window))
    }
}
