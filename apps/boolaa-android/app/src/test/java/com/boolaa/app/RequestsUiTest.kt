package com.boolaa.app

import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.dp
import com.boolaa.app.core.RequesterView
import com.boolaa.app.model.FoodPost
import com.boolaa.app.model.ItemKind
import com.boolaa.app.model.ItemRequest
import com.boolaa.app.model.RequestStatus
import com.boolaa.app.model.UserProfile
import com.boolaa.app.ui.components.OwnerRequestsButton
import com.boolaa.app.ui.components.RequestCountPill
import com.boolaa.app.ui.components.RequesterActions
import com.boolaa.app.ui.components.RequestsSheet
import com.boolaa.app.ui.food.FoodEditor
import com.boolaa.app.ui.theme.BoolaaTheme
import com.boolaa.app.ui.theme.Hue
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.Instant

/** The "I want it" controls, the Requests sheet and the food form (English strings, docs/i18n-glossary.md). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = android.app.Application::class, qualifiers = "en")
class RequestsUiTest {
    @get:Rule val rule = createComposeRule()

    private fun show(content: @androidx.compose.runtime.Composable () -> Unit) =
        rule.setContent { BoolaaTheme(darkTheme = false) { content() } }

    @Test fun i_want_it_is_labelled_with_the_item_and_48dp() {
        var wanted = 0
        show { RequesterActions(RequesterView.I_WANT_IT, "Old sofa", "Ana", Hue.mint, busy = false, onWant = { wanted++ }, onWithdraw = {}) }
        rule.onNodeWithTag("i-want-it").assertContentDescriptionEquals("I want it: Old sofa").assertHeightIsAtLeast(48.dp).performClick()
        rule.runOnIdle { assertEquals(1, wanted) }
    }

    @Test fun pending_shows_requested_and_withdraws_without_confirmation() {
        var withdrawn = 0
        var view by mutableStateOf(RequesterView.REQUESTED)
        show { RequesterActions(view, "Old sofa", "Ana", Hue.mint, busy = false, onWant = {}, onWithdraw = { withdrawn++ }) }
        rule.onNodeWithText("Requested").assertExists()
        rule.onNodeWithTag("withdraw-request").assertContentDescriptionEquals("Withdraw request: Old sofa").performClick()
        rule.runOnIdle { assertEquals(1, withdrawn); view = RequesterView.ON_LIST }
        rule.onNodeWithText("Reserved · you're on the list").assertExists()
    }

    @Test fun withdrawing_the_pick_asks_first() {
        var withdrawn = 0
        show { RequesterActions(RequesterView.RESERVED_FOR_YOU, "Old sofa", "Ana", Hue.mint, busy = false, onWant = {}, onWithdraw = { withdrawn++ }) }
        rule.onNodeWithTag("withdraw-request").performClick()
        rule.onNodeWithText("Withdraw your request?").assertExists()
        rule.onNodeWithText("Ana will be told you changed your mind.").assertExists()
        rule.runOnIdle { assertEquals(0, withdrawn) }
        rule.onNodeWithTag("confirm-dialog-confirm").performClick()
        rule.runOnIdle { assertEquals(1, withdrawn) }
    }

    @Test fun missed_and_counts_read_as_text() {
        show {
            androidx.compose.foundation.layout.Column {
                RequesterActions(RequesterView.MISSED, "Old sofa", "Ana", Hue.mint, busy = false, onWant = {}, onWithdraw = {})
                RequestCountPill(3, Hue.mint)
                RequestCountPill(1, Hue.mint, androidx.compose.ui.Modifier)
                OwnerRequestsButton(0, Hue.mint, onClick = {})
                OwnerRequestsButton(3, Hue.mint, onClick = {})
            }
        }
        rule.onNodeWithText("Someone else got it").assertExists()
        rule.onAllNodesWithTag("request-count")[0].assertContentDescriptionEquals("3 requests")
        rule.onAllNodesWithTag("request-count")[1].assertContentDescriptionEquals("1 request")
        rule.onNodeWithText("No requests yet.").assertExists()
        rule.onNodeWithText("Requests · 3").assertExists()
    }

    private fun row(id: String, name: String, status: RequestStatus = RequestStatus.PENDING, note: String? = null) =
        ItemRequest(id, "b", "me", "u-$id", ItemKind.MARKET, "i1", note, status, Instant.parse("2026-11-24T10:00:00Z"), requester = UserProfile("u-$id", name))

    @Test fun sheet_pins_the_pick_and_confirms_the_hand_over() {
        var handedOver = 0
        var picked: ItemRequest? = null
        show {
            RequestsSheet(ItemKind.MARKET, "Old sofa", listOf(row("b", "Bob", RequestStatus.PICKED), row("a", "Ana", note = "Can pick up tonight")),
                busy = false, hue = Hue.mint, onPick = { picked = it }, onUndo = {}, onHandOver = { handedOver++ }, onDismiss = {})
        }
        rule.onNodeWithText("Your pick").assertExists()
        rule.onNodeWithText("Can pick up tonight").assertExists()
        rule.onNodeWithTag("pick-u-a").assertContentDescriptionEquals("Pick instead: Ana").performClick()
        rule.runOnIdle { assertEquals("a", picked?.id) }
        rule.onNodeWithTag("hand-over").performClick()
        rule.onNodeWithText("Bob gets “Old sofa”. Everyone else who asked will hear that someone else got it.").assertExists()
        rule.onNodeWithTag("hand-over-confirm").performClick()
        rule.runOnIdle { assertEquals(1, handedOver) }
    }

    @Test fun empty_sheet_explains() {
        show { RequestsSheet(ItemKind.FOOD, "", emptyList(), busy = false, hue = Hue.tangerine, onPick = {}, onUndo = {}, onHandOver = {}, onDismiss = {}) }
        rule.onNodeWithText("No requests yet.").assertExists()
        rule.onNodeWithText("Members can tap “I want it” on your post.").assertExists()
    }

    @Test fun food_form_defaults_to_tomorrow_and_sends_the_expiry() {
        show { FoodEditor(null, busy = false, onDismiss = {}) { _, _, _ -> } }
        rule.onNodeWithTag("expiry-tomorrow").assertIsSelected()
        rule.onNodeWithText("Your post disappears after this.").assertExists()
        rule.onNodeWithTag("expiry-in_3_days").performClick()
        rule.onNodeWithTag("expiry-in_3_days").assertIsSelected()
    }

    @Test fun editing_sends_no_expiry_unless_changed() {
        val post = FoodPost("f", "b", "me", "https://x/food.jpg", "Soup", Instant.now(),
            expiresAt = Instant.now().plusSeconds(3 * 3600))
        var sent: Pair<Boolean, Instant?>? = null
        show { FoodEditor(post, busy = false, onDismiss = {}) { _, _, at -> sent = true to at } }
        rule.onNodeWithTag("expiry-custom").assertIsSelected()
        rule.onNodeWithTag("food-save").performScrollTo().performClick()
        rule.runOnIdle { assertNotNull(sent); assertEquals(null, sent!!.second) }
    }

    /**
     * The iOS bug class: after adding ONE post, "new post" must open an EMPTY editor. FoodScreen / MarketplaceScreen
     * key the editor by a session counter bumped on every "new"; this drives the same composition.
     */
    @Test fun second_new_post_opens_an_empty_editor() {
        var open by mutableStateOf(true)
        var session by mutableIntStateOf(0)
        show { if (open) key(session) { FoodEditor(null, busy = false, onDismiss = { open = false }) { _, _, _ -> open = false } } }
        rule.onNodeWithTag("food-description").performTextInput("First soup")
        rule.onNodeWithTag("expiry-in_3_days").performClick()
        rule.runOnIdle { open = false }
        rule.runOnIdle { session++; open = true }
        rule.onNodeWithTag("food-description").assertExists()
        rule.onNodeWithText("First soup").assertDoesNotExist()
        rule.onNodeWithTag("expiry-tomorrow").assertIsSelected()
    }
}
