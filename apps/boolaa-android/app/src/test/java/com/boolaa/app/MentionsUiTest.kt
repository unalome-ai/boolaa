package com.boolaa.app

import androidx.compose.foundation.layout.Column
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import com.boolaa.app.core.MentionToken
import com.boolaa.app.core.Mentions
import com.boolaa.app.model.ChatMessage
import com.boolaa.app.model.MentionCandidate
import com.boolaa.app.model.MentionSpan
import com.boolaa.app.model.UserProfile
import com.boolaa.app.ui.chat.ComposerState
import com.boolaa.app.ui.chat.MENTION
import com.boolaa.app.ui.chat.MentionStrip
import com.boolaa.app.ui.chat.MessageRow
import com.boolaa.app.ui.chat.messageText
import com.boolaa.app.ui.theme.BoolaaTheme
import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.Instant

/** Mentions in messages and the composer's list (English strings, docs/i18n-glossary.md "Mentions"). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = android.app.Application::class, qualifiers = "en")
class MentionsUiTest {
    @get:Rule val rule = createComposeRule()

    private val me = "eeeeeeee-0000-0000-0000-00000000000e"
    private val ana = MentionCandidate("aaaaaaaa-0000-0000-0000-00000000000a", "Ana Pop")
    private val bogdan = MentionCandidate("aaaaaaaa-0000-0000-0000-00000000000c", "Bogdan")
    private val bob = UserProfile("22222222-2222-2222-2222-222222222222", "Bob")
    private val at = Instant.parse("2026-11-23T18:05:00Z")

    private fun show(content: @androidx.compose.runtime.Composable () -> Unit) =
        rule.setContent { BoolaaTheme(darkTheme = false) { content() } }

    private fun description(tag: String) =
        rule.onNodeWithTag(tag).fetchSemanticsNode().config[SemanticsProperties.ContentDescription].single()

    @Test fun a_message_mentioning_me_starts_with_who_mentioned_me_and_reads_the_displayed_names() {
        // "@Dan @Ana P" as written; Dan is me (now "Dan Pop"), Ana renamed to "Ana Pop".
        val message = ChatMessage("m1", "b1", bob.id, "@Dan @Ana P can you buy milk?", at, sender = bob,
            mentions = listOf(MentionSpan(0, 4, me), MentionSpan(5, 6, ana.userId)))
        show { MessageRow(message, isMine = false, showAuthor = true, mentionNames = mapOf(ana.userId to ana.name), me = me, myName = "Dan Pop") }
        val d = description("message-m1")
        assertTrue(d, d.startsWith("Bob mentioned you, @Dan Pop @Ana Pop can you buy milk?, "))
    }

    @Test fun mentions_of_others_left_members_and_my_own_messages() {
        val gone = "ffffffff-0000-0000-0000-000000000000"
        val message = ChatMessage("m2", "b1", bob.id, "@Ana P and @Gone hi", at, sender = bob,
            mentions = listOf(MentionSpan(0, 6, ana.userId), MentionSpan(11, 5, gone)))
        show { MessageRow(message, isMine = false, showAuthor = true, mentionNames = mapOf(ana.userId to ana.name), me = me, myName = "Dan") }
        val d = description("message-m2")
        // No "mentioned you"; a member shows the current name, a non-member the text as written.
        assertTrue(d, d.startsWith("Bob, @Ana Pop and @Gone hi, "))
    }

    @Test fun message_text_marks_each_kind_and_never_links_a_mention() {
        val parts = Mentions.parts("@Dan see www.x.ro @Ana", listOf(MentionSpan(0, 4, me), MentionSpan(18, 4, ana.userId)), me, "Dan", mapOf(ana.userId to "Ana"))
        val text = messageText(parts, Color.Blue, Color.Magenta, underlineMembers = false)
        assertEquals("@Dan see www.x.ro @Ana", text.text)
        assertEquals(listOf("ME", "MEMBER"), text.getStringAnnotations(MENTION, 0, text.length).map { it.item })
        val links = text.getLinkAnnotations(0, text.length)
        assertEquals(1, links.size)
        assertEquals("www.x.ro", text.text.substring(links[0].start, links[0].end))
    }

    @Test fun rows_are_buttons_labelled_mention_name_and_48dp() {
        var picked: MentionCandidate? = null
        show { MentionStrip(Mentions.ListState.Rows(listOf(ana, bogdan)), active = 0, onPick = { picked = it }) }
        rule.onNodeWithTag("mention-row-${ana.userId}").assertContentDescriptionEquals("Mention Ana Pop").assertHeightIsAtLeast(48.dp)
        rule.onNodeWithTag("mention-row-${bogdan.userId}").performClick()
        rule.runOnIdle { assertEquals(bogdan, picked) }
        val strip = rule.onNodeWithTag("mention-strip").fetchSemanticsNode().config
        assertEquals("Members to mention", strip[SemanticsProperties.ContentDescription].single())
        assertEquals("2 members", strip[SemanticsProperties.StateDescription])
        assertEquals(androidx.compose.ui.semantics.LiveRegionMode.Polite, strip[SemanticsProperties.LiveRegion])
    }

    @Test fun no_match_and_limit_rows() {
        show {
            Column {
                MentionStrip(Mentions.ListState.NoMatch, active = 0, onPick = {})
                MentionStrip(Mentions.ListState.Limit, active = 0, onPick = {})
            }
        }
        rule.onNodeWithTag("mention-no-match").assertExists()
        rule.onNodeWithTag("mention-limit").assertExists()
        rule.onNodeWithTag("mention-limit").fetchSemanticsNode().config[SemanticsProperties.Text].single().text
            .let { assertEquals("You can mention up to 10 people in one message.", it) }
    }

    @Test fun composer_picks_and_backspace_removes_the_token_in_one_keystroke() {
        val composer = ComposerState()
        composer.onValueChange(TextFieldValue("hi @an", TextRange(6)))
        val q = composer.query!!
        assertEquals(Mentions.Query(3, "an"), q)
        composer.pick(q, ana)
        assertEquals("hi @Ana Pop ", composer.text)
        assertEquals(listOf(MentionToken(3, 11, ana.userId)), composer.tokens)
        // Backspace the space, then once more: the whole token goes.
        composer.onValueChange(TextFieldValue("hi @Ana Pop", TextRange(11)))
        assertEquals(1, composer.tokens.size)
        composer.onValueChange(TextFieldValue("hi @Ana Po", TextRange(10)))
        assertEquals("hi ", composer.text)
        assertEquals(TextRange(3), composer.value.selection)
        assertEquals(emptyList<MentionToken>(), composer.tokens)
    }

    @Test fun composer_draft_appends_after_typed_text_with_its_token_shifted() {
        val composer = ComposerState()
        composer.onValueChange(TextFieldValue("Hello  ", TextRange(7)))
        composer.append("@Ana Pop, is it free?", MentionToken(0, 8, ana.userId))
        assertEquals("Hello\n@Ana Pop, is it free?", composer.text)
        assertEquals(listOf(MentionToken(6, 14, ana.userId)), composer.tokens)
    }

    @Test fun the_composer_styles_tokens_without_moving_offsets() {
        val style = androidx.compose.ui.text.SpanStyle(color = Color.Magenta)
        val out = com.boolaa.app.ui.chat.MentionHighlight(listOf(MentionToken(0, 8, ana.userId)), style)
            .filter(androidx.compose.ui.text.AnnotatedString("@Ana Pop hi"))
        assertEquals("@Ana Pop hi", out.text.text)
        assertEquals(listOf(0 to 8), out.text.spanStyles.map { it.start to it.end })
        assertEquals(5, out.offsetMapping.originalToTransformed(5))
    }
}
