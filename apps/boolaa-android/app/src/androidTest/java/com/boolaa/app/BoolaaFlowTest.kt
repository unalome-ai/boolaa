package com.boolaa.app

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasAnyDescendant
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.boolaa.app.state.LocaleManager
import io.github.jan.supabase.postgrest.from
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

/**
 * End-to-end against the local Supabase (needs `adb reverse tcp:55321 tcp:55321`).
 * Leaves no data behind: the chat message it sends is deleted in [cleanUp].
 */
@OptIn(ExperimentalTestApi::class)
@RunWith(AndroidJUnit4::class)
class BoolaaFlowTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()

    private val container get() = (InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as BoolaaApplication).container
    private val sentContents = mutableListOf<String>()
    private val timeout = 20_000L

    @Before fun signedOutInEnglish() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync { LocaleManager.set("en") }
        runBlocking { container.session.signOut() }
        rule.waitUntilExactlyOneExists(hasTestTag("auth-screen"), timeout)
    }

    @After fun cleanUp() = runBlocking {
        val me = container.session.state.value.userId
        if (me != null) for (content in sentContents) {
            container.api.client.from("chat_messages").delete { filter { eq("sender_id", me); eq("content", content) } }
        }
        container.session.signOut()
    }

    private fun signIn(email: String) {
        rule.onNodeWithTag("email").performTextInput(email)
        rule.onNodeWithTag("password").performTextInput("password123")
        rule.onNodeWithTag("auth-submit").performClick()
    }

    @Test fun alice_chats_switches_bubble_and_sees_invite_code() {
        signIn("alice@boolaa.test")
        rule.waitUntilExactlyOneExists(hasTestTag("chat-fab"), timeout)
        rule.onNodeWithTag("bubble-chip-Flatmates").performClick()

        rule.onNodeWithTag("chat-fab").performClick()
        rule.waitUntilExactlyOneExists(hasTestTag("chat-input"), timeout)
        val text = "Hello from Android test ${UUID.randomUUID().toString().take(8)}"
        sentContents += text
        rule.onNodeWithTag("chat-input").performTextInput(text)
        rule.onNodeWithTag("chat-send").performClick()
        rule.waitUntilExactlyOneExists(hasText(text), timeout)

        rule.onNodeWithTag("chat-back").performClick()
        rule.waitUntilExactlyOneExists(hasTestTag("chat-fab"), timeout)
        rule.onNodeWithTag("bubble-chip-Climbing Crew").performClick()
        rule.onNodeWithTag("tab-settings").performClick()
        rule.waitUntilExactlyOneExists(hasTestTag("invite-code") and hasText("CLIMB123"), timeout)
    }

    @Test fun carol_lands_on_pending_approval() {
        signIn("carol@boolaa.test")
        rule.waitUntilExactlyOneExists(hasTestTag("onboarding-screen"), timeout)
        rule.waitUntilExactlyOneExists(hasTestTag("pending-approval-title"), timeout)
        rule.waitUntilAtLeastOneExists(hasTestTag("pending-request") and hasAnyDescendant(hasText("Flatmates")), timeout)
    }
}
