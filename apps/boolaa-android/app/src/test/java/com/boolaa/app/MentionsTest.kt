package com.boolaa.app

import com.boolaa.app.core.BoolaaJson
import com.boolaa.app.core.MentionToken
import com.boolaa.app.core.Mentions
import com.boolaa.app.core.Mentions.Kind
import com.boolaa.app.core.Mentions.ListState
import com.boolaa.app.core.Mentions.Part
import com.boolaa.app.core.NotificationPrefs
import com.boolaa.app.core.PrefKey
import com.boolaa.app.core.PushPayload
import com.boolaa.app.core.PushRouting
import com.boolaa.app.core.PushScreen
import com.boolaa.app.core.PushType
import com.boolaa.app.core.UserFacingError
import com.boolaa.app.model.ChatMessage
import com.boolaa.app.model.MentionCandidate
import com.boolaa.app.model.MentionSpan
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.text.Collator
import java.util.Locale

/** docs/boolaa-spec.md "Mentions": offsets, rendering, the composer rules, push and errors. */
class MentionsTest {
    private val ana = MentionCandidate("aaaaaaaa-0000-0000-0000-00000000000a", "Ana Pop")
    private val stefan = MentionCandidate("aaaaaaaa-0000-0000-0000-00000000000b", "Ștefan Ionescu")
    private val bogdan = MentionCandidate("aaaaaaaa-0000-0000-0000-00000000000c", "Bogdan")
    private val popa = MentionCandidate("aaaaaaaa-0000-0000-0000-00000000000d", "Popa Dan")
    private val all = listOf(ana, stefan, bogdan, popa)
    private val collator = Collator.getInstance(Locale.ENGLISH)

    // ---- Offset vectors (the same on web and iOS) --------------------------------------------------------------

    @Test fun pizza_emoji_before_the_mention() {
        val text = "🍕 @Ana Pop, hi"
        assertEquals(MentionSpan(2, 8, "u"), Mentions.spanOf(text, 3, 11, "u"))
        assertEquals(3 to 11, Mentions.nativeRange(text, MentionSpan(2, 8, "u")))
        assertEquals("@Ana Pop", text.substring(3, 11))
    }

    @Test fun precomposed_and_decomposed_accents_count_differently() {
        val pre = "@Zoë hi"
        assertEquals(MentionSpan(0, 4, "u"), Mentions.spanOf(pre, 0, 4, "u"))
        val dec = "@Zoë hi"
        assertEquals(MentionSpan(0, 5, "u"), Mentions.spanOf(dec, 0, 5, "u"))
        assertEquals(0 to 5, Mentions.nativeRange(dec, MentionSpan(0, 5, "u")))
    }

    @Test fun family_emoji_is_five_code_points() {
        val text = "👨‍👩‍👧 @Bo"
        val at = text.indexOf('@')
        assertEquals(9, at)
        assertEquals(MentionSpan(6, 3, "u"), Mentions.spanOf(text, at, text.length, "u"))
        assertEquals(at to text.length, Mentions.nativeRange(text, MentionSpan(6, 3, "u")))
    }

    @Test fun spans_that_do_not_fit_are_ignored() {
        val text = "hi @Ana"
        assertNull(Mentions.nativeRange(text, MentionSpan(5, 9, "u")))
        assertNull(Mentions.nativeRange(text, MentionSpan(-1, 2, "u")))
        val parts = Mentions.parts(text, listOf(MentionSpan(5, 9, ana.userId), MentionSpan(0, 2, ana.userId)), null, null, mapOf(ana.userId to ana.name))
        assertEquals(listOf(Part.Text("hi @Ana")), parts)
    }

    // ---- Rendering ---------------------------------------------------------------------------------------------

    private val me = "eeeeeeee-0000-0000-0000-00000000000e"
    private val names = mapOf(ana.userId to "Ana Popescu")

    @Test fun rendering_per_case() {
        val text = "@Dan, @Ana Pop and @Gone Guy: see www.x.ro"
        val spans = listOf(MentionSpan(0, 4, me.uppercase()), MentionSpan(6, 8, ana.userId), MentionSpan(19, 9, "ffffffff-0000-0000-0000-000000000000"))
        val parts = Mentions.parts(text, spans, me, "Dan Pop", names)
        assertEquals(
            listOf(
                Part.Mention("@Dan Pop", me, Kind.ME),
                Part.Text(", "),
                // Renamed member: the current name.
                Part.Mention("@Ana Popescu", ana.userId, Kind.MEMBER),
                Part.Text(" and "),
                // Left / deleted / blocked / unknown: the span's own text, plain.
                Part.Mention("@Gone Guy", "ffffffff-0000-0000-0000-000000000000", Kind.PLAIN),
                Part.Text(": see www.x.ro"),
            ),
            parts,
        )
        assertEquals("@Dan Pop, @Ana Popescu and @Gone Guy: see www.x.ro", Mentions.displayText(parts))
        assertTrue(Mentions.mentionsMe(text, spans, me))
        assertFalse(Mentions.mentionsMe(text, spans.drop(1), me))
    }

    @Test fun no_spans_is_the_text_as_written() {
        assertEquals(listOf(Part.Text("@Ana Pop hi")), Mentions.parts("@Ana Pop hi", emptyList(), me, "Dan", names))
    }

    @Test fun unknown_users_trigger_a_candidate_reload() {
        val spans = listOf(MentionSpan(0, 4, me), MentionSpan(5, 4, ana.userId), MentionSpan(10, 4, "new"))
        assertEquals(setOf("new"), Mentions.unknownUsers(spans, me, setOf(ana.userId)))
    }

    @Test fun rows_decode_mentions_in_any_key_order() {
        val row = """{"id":"m1","bubble_id":"b","sender_id":"s","content":"@Ana hi","created_at":"2026-11-24T10:00:00Z",
            |"mentions":[{"user_id":"${ana.userId}","length":4,"start":0}]}""".trimMargin()
        val m = BoolaaJson.json.decodeFromString(ChatMessage.serializer(), row)
        assertEquals(listOf(MentionSpan(0, 4, ana.userId)), m.mentions)
        val old = BoolaaJson.json.decodeFromString(ChatMessage.serializer(), """{"id":"m2","bubble_id":"b","sender_id":"s","created_at":"2026-11-24T10:00:00Z"}""")
        assertEquals(emptyList<MentionSpan>(), old.mentions)
    }

    // ---- Trigger and query -------------------------------------------------------------------------------------

    @Test fun trigger_rules() {
        assertEquals(Mentions.Query(0, ""), Mentions.query("@", 1, emptyList()))
        assertEquals(Mentions.Query(3, "an"), Mentions.query("hi @an", 6, emptyList()))
        assertEquals(Mentions.Query(1, "a"), Mentions.query("(@a", 3, emptyList()))
        assertEquals(Mentions.Query(1, "a"), Mentions.query("«@a", 3, emptyList()))
        assertEquals(Mentions.Query(0, "ana p"), Mentions.query("@ana p", 6, emptyList()))
        // Not after a letter or digit: an email never opens it.
        assertNull(Mentions.query("ana@x", 5, emptyList()))
        assertNull(Mentions.query("1@x", 3, emptyList()))
        // Line break, two spaces in a row, over 30 code points.
        assertNull(Mentions.query("@an\nx", 5, emptyList()))
        assertNull(Mentions.query("@ana  p", 7, emptyList()))
        assertNull(Mentions.query("@" + "a".repeat(31), 32, emptyList()))
        assertEquals(30, Mentions.query("@" + "a".repeat(30), 31, emptyList())!!.text.length)
        // Inside (or right after) a token: no list.
        val tokens = listOf(MentionToken(0, 8, ana.userId))
        assertNull(Mentions.query("@Ana Pop", 8, tokens))
        assertNull(Mentions.query("@Ana Pop", 3, tokens))
    }

    @Test fun filtering_folds_case_and_diacritics_and_orders_starts_first() {
        assertEquals(listOf(stefan), Mentions.filter(all, "stefan", collator))
        assertEquals(listOf(stefan), Mentions.filter(all, "ȘTE", collator))
        assertEquals(listOf(ana), Mentions.filter(all, "ana p", collator))
        // "pop": names starting with it, then names with a word starting with it.
        assertEquals(listOf(popa, ana), Mentions.filter(all, "pop", collator))
        assertEquals(listOf(popa), Mentions.filter(all, "dan", collator))
        // A bare @ lists everyone, by collation; nameless candidates are left out.
        assertEquals(listOf(ana, bogdan, popa, stefan), Mentions.filter(all + MentionCandidate("x", ""), "", collator))
        assertEquals(emptyList<MentionCandidate>(), Mentions.filter(all, "zed", collator))
    }

    @Test fun list_states() {
        val q = Mentions.Query(0, "")
        assertEquals(ListState.Rows(listOf(ana, bogdan, popa, stefan)), Mentions.listState(q, all, emptyList(), collator, null))
        assertEquals(ListState.Closed, Mentions.listState(null, all, emptyList(), collator, null))
        // Alone in the bubble: never opens.
        assertEquals(ListState.Closed, Mentions.listState(q, emptyList(), emptyList(), collator, null))
        // Escape closed this @.
        assertEquals(ListState.Closed, Mentions.listState(q, all, emptyList(), collator, 0))
        assertEquals(ListState.NoMatch, Mentions.listState(Mentions.Query(0, "zed"), all, emptyList(), collator, null))
        // A query with a space that matches nobody closes the list.
        assertEquals(ListState.Closed, Mentions.listState(Mentions.Query(0, "ana x"), all, emptyList(), collator, null))
        val ten = (0 until 10).map { MentionToken(20 + it * 3, 22 + it * 3, ana.userId) }
        assertEquals(ListState.Limit, Mentions.listState(q, all, ten, collator, null))
    }

    // ---- Insertion and token editing ---------------------------------------------------------------------------

    @Test fun picking_inserts_the_name_and_one_space() {
        val e = Mentions.insert("hi @an", emptyList(), Mentions.Query(3, "an"), 6, ana)
        assertEquals("hi @Ana Pop ", e.text)
        assertEquals(12, e.selectionStart)
        assertEquals(listOf(MentionToken(3, 11, ana.userId)), e.tokens)
        // No extra space when whitespace follows; later tokens shift.
        val later = MentionToken(8, 15, bogdan.userId)
        val f = Mentions.insert("@a and @Bogdan", listOf(later.copy(start = 7, end = 14)), Mentions.Query(0, "a"), 2, ana)
        assertEquals("@Ana Pop and @Bogdan", f.text)
        assertEquals(listOf(MentionToken(0, 8, ana.userId), MentionToken(13, 20, bogdan.userId)), f.tokens)
        assertEquals(9, f.selectionStart)
    }

    private fun edit(text: String, sel: Int, tokens: List<MentionToken>, new: String, newSel: Int) =
        Mentions.applyEdit(text, sel, sel, tokens, new, newSel, newSel)

    @Test fun backspace_right_after_a_token_removes_it_whole() {
        val t = listOf(MentionToken(3, 11, ana.userId))
        val e = edit("hi @Ana Pop", 11, t, "hi @Ana Po", 10)
        assertEquals("hi ", e.text)
        assertEquals(3, e.selectionStart)
        assertEquals(emptyList<MentionToken>(), e.tokens)
    }

    @Test fun delete_right_before_a_token_removes_it_whole() {
        val t = listOf(MentionToken(3, 11, ana.userId))
        val e = edit("hi @Ana Pop!", 3, t, "hi Ana Pop!", 3)
        assertEquals("hi !", e.text)
        assertEquals(emptyList<MentionToken>(), e.tokens)
    }

    @Test fun replacing_a_selection_that_touches_a_token_removes_it() {
        val t = listOf(MentionToken(3, 11, ana.userId))
        // "na P" selected and replaced with "x".
        val e = Mentions.applyEdit("hi @Ana Pop ok", 5, 9, t, "hi @Axop ok", 6, 6)
        assertEquals("hi x ok", e.text)
        assertEquals(4, e.selectionStart)
        assertEquals(emptyList<MentionToken>(), e.tokens)
    }

    @Test fun typing_inside_a_token_turns_it_into_plain_text() {
        val t = listOf(MentionToken(0, 8, ana.userId))
        val e = edit("@Ana Pop hi", 4, t, "@Anax Pop hi", 5)
        assertEquals("@Anax Pop hi", e.text)
        assertEquals(emptyList<MentionToken>(), e.tokens)
        // Pasting inside, too.
        val p = edit("@Ana Pop hi", 2, t, "@Apasted na Pop hi", 9)
        assertEquals(emptyList<MentionToken>(), p.tokens)
    }

    @Test fun edits_before_a_token_shift_it_and_after_it_keep_it() {
        val t = listOf(MentionToken(3, 11, ana.userId))
        assertEquals(listOf(MentionToken(5, 13, ana.userId)), edit("hi @Ana Pop", 0, t, "ohhi @Ana Pop", 2).tokens)
        assertEquals(listOf(MentionToken(2, 10, ana.userId)), edit("hi @Ana Pop", 1, t, "h @Ana Pop", 1).tokens)
        // Typing right after it (the caret at its end) keeps it.
        assertEquals(t, edit("hi @Ana Pop", 11, t, "hi @Ana Pop!", 12).tokens)
        // Typing right before it shifts it.
        assertEquals(listOf(MentionToken(4, 12, ana.userId)), edit("hi @Ana Pop", 3, t, "hi (@Ana Pop", 4).tokens)
    }

    @Test fun pasted_text_never_creates_mentions() {
        val e = edit("hi ", 3, emptyList(), "hi @Ana Pop", 11)
        assertEquals(emptyList<MentionToken>(), e.tokens)
    }

    @Test fun an_ime_rewriting_the_last_word_of_a_token_removes_it() {
        // The keyboard recomposes "Pop" after the token and replaces it with "Po".
        val t = listOf(MentionToken(0, 8, ana.userId))
        val e = Mentions.applyEdit("@Ana Pop", 8, 8, t, "@Ana Po", 7, 7)
        assertEquals("", e.text)
    }

    // ---- Sending and drafts ------------------------------------------------------------------------------------

    @Test fun trimming_shifts_spans_and_drops_those_outside() {
        val raw = "  🍕 @Ana Pop hi  "
        val tokens = listOf(MentionToken(5, 13, ana.userId))
        val (content, spans) = Mentions.prepareSend(raw, tokens)
        assertEquals("🍕 @Ana Pop hi", content)
        assertEquals(listOf(MentionSpan(2, 8, ana.userId)), spans)
        val (short, none) = Mentions.prepareSend("hi @Ana Pop", listOf(MentionToken(3, 11, ana.userId)), maxLength = 6)
        assertEquals("hi @An", short)
        assertEquals(emptyList<MentionSpan>(), none)
    }

    @Test fun spans_are_sorted_by_start() {
        val (_, spans) = Mentions.prepareSend("@Bogdan @Ana Pop", listOf(MentionToken(8, 16, ana.userId), MentionToken(0, 7, bogdan.userId)))
        assertEquals(listOf(0, 8), spans.map { it.start })
    }

    @Test fun ask_in_chat_draft_gets_a_token_for_a_candidate_owner() {
        val draft = "@Ana Pop, is “Sofa” still available?"
        val (text, token) = Mentions.draftWithToken(draft, ana.userId.uppercase(), "Ana Pop", all)
        assertEquals(draft, text)
        assertEquals(MentionToken(0, 8, ana.userId), token)
        // Renamed since: the current name is written.
        val (renamed, t2) = Mentions.draftWithToken(draft, ana.userId, "Ana Pop", listOf(ana.copy(name = "Ana P.")))
        assertEquals("@Ana P., is “Sofa” still available?", renamed)
        assertEquals(MentionToken(0, 7, ana.userId), t2)
        // Not a candidate (left, blocked) or unknown name: plain text as before.
        assertEquals(draft to null, Mentions.draftWithToken(draft, "someone-else", "Ana Pop", all))
        assertEquals("@someone, hi" to null, Mentions.draftWithToken("@someone, hi", ana.userId, null, all))
    }

    // ---- Errors, push, prefs -----------------------------------------------------------------------------------

    @Test fun errors_map() {
        assertEquals(UserFacingError.TOO_MANY_MENTIONS, UserFacingError.classify("too many mentions", "22023"))
        assertEquals(UserFacingError.GENERIC, UserFacingError.classify("invalid mentions", "22023"))
    }

    @Test fun chat_mention_push_opens_the_chat_on_the_message() {
        val bubble = "aaaaaaaa-0000-0000-0000-000000000001"
        val message = "bbbbbbbb-0000-0000-0000-000000000002"
        val p = PushPayload.from(mapOf("type" to "chat_mention", "bubble_id" to bubble, "target_id" to message))!!
        assertEquals(PushType.CHAT_MENTION, p.type)
        assertEquals("chat", p.type.channel.id)
        assertEquals("mention:$message", p.tag)
        val dest = PushRouting.resolve(p, listOf(bubble))
        assertEquals(PushScreen.CHAT, dest.screen)
        assertEquals(message, dest.chatMessageId)
        // No banner while that chat is open, like chat.
        assertFalse(PushRouting.shouldShowInForeground(p, bubble))
        assertTrue(PushRouting.shouldShowInForeground(p, "other"))
    }

    @Test fun mentions_pref_sits_after_chat() {
        assertEquals(PrefKey.MENTIONS, PrefKey.entries[PrefKey.CHAT.ordinal + 1])
        assertEquals("mentions", PrefKey.MENTIONS.column)
        assertTrue(NotificationPrefs().mentions)
        assertFalse(PrefKey.MENTIONS.set(NotificationPrefs(), false).mentions)
    }
}
