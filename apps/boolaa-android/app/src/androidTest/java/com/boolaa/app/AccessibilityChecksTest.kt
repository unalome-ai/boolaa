package com.boolaa.app

import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.accessibility.enableAccessibilityChecks
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.tryPerformAccessibilityChecks
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.boolaa.app.state.LocaleManager
import kotlinx.coroutines.runBlocking
import com.google.android.apps.common.testing.accessibility.framework.AccessibilityViewCheckResult
import com.google.android.apps.common.testing.accessibility.framework.checks.TouchTargetSizeCheck
import com.google.android.apps.common.testing.accessibility.framework.integrations.espresso.AccessibilityValidator
import org.hamcrest.BaseMatcher
import org.hamcrest.Description
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Accessibility Test Framework checks (touch target size, labels, duplicate descriptions, text contrast, traversal…)
 * on the main screens as Alice, against the local Supabase (needs `adb reverse tcp:55321 tcp:55321`). Any ATF error
 * fails the test; warnings are logged. Plus the TalkBack contract of the shell (tabs, chat button, bubble chips).
 */
@OptIn(ExperimentalTestApi::class)
@RunWith(AndroidJUnit4::class)
class AccessibilityChecksTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()

    private val container get() = (InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as BoolaaApplication).container
    private val timeout = 20_000L

    @Before fun signedInAsAliceInEnglish() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync { LocaleManager.set("en") }
        container.device.overrideForTesting(LocalStack.SEEDED_DEVICE)
        runBlocking { container.session.signOut() }
        rule.waitUntilExactlyOneExists(hasTestTag("auth-screen"), timeout)
        rule.onNodeWithTag("email").performTextInput("alice@boolaa.test")
        rule.onNodeWithTag("password").performTextInput("password123")
        rule.onNodeWithTag("auth-submit").performClick()
        rule.waitUntilExactlyOneExists(hasTestTag("chat-fab"), timeout)
        rule.onNodeWithTag("bubble-chip-Flatmates").performClick()
        rule.waitForIdle()
    }

    @After fun signOut() = runBlocking {
        container.session.signOut()
        container.device.overrideForTesting(null)
    }

    private fun checkScreen(tag: String? = null) {
        if (tag != null) rule.waitUntilAtLeastOneExists(hasTestTag(tag), timeout)
        rule.waitForIdle()
        rule.onRoot().tryPerformAccessibilityChecks()
    }

    /**
     * Compose reports a node partly hidden under the floating dock with only its visible part, so a 48dp button half
     * scrolled under the dock reads as "30dp tall". Touch-target results for nodes reaching into the dock band are a
     * scroll position, not a size problem (sizes are asserted in AccessibilityComponentsTest); everything else fails.
     */
    private fun validator(): AccessibilityValidator {
        val dockTop = rule.onNodeWithTag("pill-tab-bar").fetchSemanticsNode().boundsInWindow.top.toInt()
        val underDock = object : BaseMatcher<AccessibilityViewCheckResult>() {
            override fun matches(item: Any?): Boolean {
                val result = item as? AccessibilityViewCheckResult ?: return false
                if (result.sourceCheckClass != TouchTargetSizeCheck::class.java) return false
                val bounds = result.accessibilityHierarchyCheckResult?.element?.boundsInScreen ?: return false
                // Clipped at the dock's top edge, or showing in the strip between the dock and the screen's bottom.
                return bounds.bottom >= dockTop - 48
            }
            override fun describeTo(description: Description) { description.appendText("touch target clipped by the dock") }
        }
        return AccessibilityValidator().setRunChecksFromRootView(true).setSuppressingResultMatcher(underDock)
    }

    @Test fun main_screens_pass_the_accessibility_test_framework() {
        rule.enableAccessibilityChecks(validator())
        checkScreen()
        for (tab in listOf("events", "food", "marketplace", "settings", "home")) {
            rule.onNodeWithTag("tab-$tab").performClick()
            checkScreen()
        }
        rule.onNodeWithTag("chat-fab").performClick()
        checkScreen("chat-input")
    }

    @Test fun shell_controls_expose_label_role_and_state() {
        rule.onNodeWithTag("tab-home").assertContentDescriptionEquals("Home").assertIsSelected()
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Tab))
        rule.onNodeWithTag("bubble-chip-Flatmates").assertIsSelected()
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Tab))
        rule.onNodeWithTag("search-button", useUnmergedTree = false).assert(SemanticsMatcher.keyIsDefined(androidx.compose.ui.semantics.SemanticsActions.OnClick))
        rule.onNodeWithTag("profile-button").assertContentDescriptionEquals("Profile")
        val chat = rule.onNodeWithTag("chat-fab").fetchSemanticsNode().config[SemanticsProperties.ContentDescription].single()
        org.junit.Assert.assertTrue(chat, chat.startsWith("Open chat"))
    }
}
