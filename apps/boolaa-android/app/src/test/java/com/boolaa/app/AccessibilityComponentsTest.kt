package com.boolaa.app

import androidx.compose.runtime.Composable
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertWidthIsAtLeast
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.dp
import com.boolaa.app.core.ReactionSummary
import com.boolaa.app.model.ChatMessage
import com.boolaa.app.model.ReactionKind
import com.boolaa.app.model.UserProfile
import com.boolaa.app.ui.auth.CodeField
import com.boolaa.app.ui.chat.MessageRow
import com.boolaa.app.ui.components.BoolaaChip
import com.boolaa.app.ui.components.CircleIconButton
import com.boolaa.app.ui.components.BoolaaIcons
import com.boolaa.app.ui.components.ReactionBar
import com.boolaa.app.ui.components.ReactionPickerRow
import com.boolaa.app.ui.shell.ChatButton
import com.boolaa.app.ui.shell.MainTab
import com.boolaa.app.ui.shell.PillTabBar
import com.boolaa.app.ui.theme.BoolaaTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.Instant

/**
 * TalkBack contract of the key custom controls (docs/boolaa-spec.md "Accessibility"): labels, roles, selected / toggle
 * state, one stop per chat message, and the 48dp minimum touch target. English strings (default resources).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = android.app.Application::class, qualifiers = "en")
class AccessibilityComponentsTest {
    @get:Rule val rule = createComposeRule()

    private fun show(content: @Composable () -> Unit) = rule.setContent { BoolaaTheme(darkTheme = false) { content() } }

    private fun hasRole(role: Role) = SemanticsMatcher.expectValue(SemanticsProperties.Role, role)

    @Test fun dock_tabs_are_labelled_tabs_with_selection_and_48dp() {
        show { PillTabBar(selected = MainTab.EVENTS, onSelect = {}) }
        rule.onNodeWithTag("tab-events").assertContentDescriptionEquals("Events").assert(hasRole(Role.Tab)).assertIsSelected()
            .assertHeightIsAtLeast(48.dp)
        rule.onNodeWithTag("tab-home").assertContentDescriptionEquals("Home").assertIsNotSelected()
        rule.onNodeWithTag("pill-tab-bar").assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.SelectableGroup))
    }

    @Test fun chat_button_reads_its_unread_count_once() {
        show { ChatButton(onClick = {}, unread = 3) }
        rule.onNodeWithTag("chat-fab").assertContentDescriptionEquals("Open chat, 3 unread messages").assert(hasRole(Role.Button))
            .assertHeightIsAtLeast(48.dp).assertWidthIsAtLeast(48.dp)
        // The badge is drawn but not a second TalkBack stop.
        rule.onNodeWithTag("chat-fab-badge", useUnmergedTree = true)
            .assert(SemanticsMatcher.keyNotDefined(SemanticsProperties.ContentDescription))
    }

    @Test fun reaction_chips_are_toggles_with_a_count_and_48dp_targets() {
        show {
            ReactionBar(
                listOf(ReactionSummary(ReactionKind.LOVE, 3, mine = true), ReactionSummary(ReactionKind.LIKE, 1, mine = false)),
                onToggle = {},
            )
        }
        rule.onNodeWithTag("reactions-chip-love").assertContentDescriptionEquals("Love: 3 reactions, You reacted")
            .assert(hasRole(Role.Switch)).assert(SemanticsMatcher.expectValue(SemanticsProperties.ToggleableState, ToggleableState.On))
            .assertHeightIsAtLeast(48.dp).assertWidthIsAtLeast(48.dp)
        rule.onNodeWithTag("reactions-chip-like").assertContentDescriptionEquals("Like: 1 reaction")
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.ToggleableState, ToggleableState.Off))
        rule.onNodeWithTag("reactions-add").assertContentDescriptionEquals("Add a reaction").assert(hasRole(Role.Button))
            .assertHeightIsAtLeast(48.dp).assertWidthIsAtLeast(48.dp)
    }

    @Test fun reaction_picker_buttons_read_the_reaction_name() {
        show { ReactionPickerRow(onPick = {}) }
        for ((kind, name) in listOf(ReactionKind.LIKE to "Like", ReactionKind.LAUGH to "Haha", ReactionKind.THANKS to "Thanks")) {
            rule.onNodeWithTag("reactions-pick-${kind.wire}").assertContentDescriptionEquals(name).assert(hasRole(Role.Button))
                .assertHeightIsAtLeast(48.dp)
        }
    }

    @Test fun code_field_is_one_labelled_field_with_progress() {
        show { CodeField(value = "12", onValueChange = {}) }
        rule.onNodeWithTag("code-field").assertContentDescriptionEquals("6-digit code")
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "2 of 6 digits"))
    }

    @Test fun filter_chip_and_icon_button_meet_the_touch_target() {
        show {
            androidx.compose.foundation.layout.Column {
                BoolaaChip("Free", active = true, onClick = {})
                CircleIconButton(BoolaaIcons.Search, "Search", onClick = {}, size = 36.dp)
            }
        }
        rule.onNode(hasContentDescription("Search")).assertHeightIsAtLeast(48.dp).assertWidthIsAtLeast(48.dp)
        rule.onNode(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Tab)).assertIsSelected().assertHeightIsAtLeast(48.dp)
    }

    @Test fun a_chat_message_is_one_stop_with_sender_text_time_reactions_and_actions() {
        val bob = UserProfile("22222222-2222-2222-2222-222222222222", "Bob")
        val message = ChatMessage("m1", "b1", bob.id, "Pizza tonight?", Instant.parse("2026-11-23T18:05:00Z"), sender = bob)
        show {
            MessageRow(message, isMine = false, showAuthor = true, onReport = {},
                reactions = listOf(ReactionSummary(ReactionKind.LIKE, 2, mine = false)), onReact = {})
        }
        val node = rule.onNodeWithTag("message-m1").fetchSemanticsNode()
        val description = node.config[SemanticsProperties.ContentDescription].single()
        assertTrue(description, description.startsWith("Bob, Pizza tonight?, "))
        assertTrue(description, description.endsWith(", Like: 2 reactions"))
        val actions = node.config[androidx.compose.ui.semantics.SemanticsActions.CustomActions].map { it.label }
        assertTrue(actions.toString(), actions == listOf("React", "Report"))
        // The pieces are not separate stops.
        rule.onNodeWithContentDescription("Like: 2 reactions").assertDoesNotExist()
    }

    @Test fun a_deleted_photo_message_reads_deleted_and_a_photo_reads_who_sent_it() {
        val ana = UserProfile("33333333-3333-3333-3333-333333333333", "Ana")
        val at = Instant.parse("2026-11-23T09:00:00Z")
        show {
            androidx.compose.foundation.layout.Column {
                MessageRow(ChatMessage("d1", "b1", ana.id, "", at, sender = ana, deletedAt = at), isMine = false, showAuthor = true)
                MessageRow(ChatMessage("p1", "b1", ana.id, "", at, sender = ana, imagePath = "x/y.jpg"), isMine = false, showAuthor = true,
                    onReact = {})
            }
        }
        val deleted = rule.onNodeWithTag("message-d1").fetchSemanticsNode().config[SemanticsProperties.ContentDescription].single()
        assertTrue(deleted, deleted.startsWith("Ana, This message was deleted, "))
        val photo = rule.onNodeWithTag("message-p1").fetchSemanticsNode().config[SemanticsProperties.ContentDescription].single()
        assertTrue(photo, photo.startsWith("Ana, Photo from Ana, "))
    }
}
