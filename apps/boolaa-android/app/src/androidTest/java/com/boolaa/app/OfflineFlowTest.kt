package com.boolaa.app

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.boolaa.app.core.CacheKeys
import com.boolaa.app.model.ChatMessage
import com.boolaa.app.model.FoodPost
import com.boolaa.app.state.LocaleManager
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.builtins.ListSerializer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

/**
 * Offline and poor network (docs/boolaa-spec.md) against the local Supabase (`adb reverse tcp:55321 tcp:55321`).
 * "No network" is simulated in the app (ConnectivityMonitor.setSimulatedOffline: every request fails at once and the
 * monitor reports offline), so the emulator's own network stays up for the instrumentation.
 */
@OptIn(ExperimentalTestApi::class)
@RunWith(AndroidJUnit4::class)
class OfflineFlowTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val container get() = (context.applicationContext as BoolaaApplication).container
    private val sentContents = mutableListOf<String>()
    private val timeout = 20_000L

    @Before fun signedOutInEnglish() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync { LocaleManager.set("en") }
        container.connectivity.setSimulatedOffline(false)
        container.device.overrideForTesting(LocalStack.SEEDED_DEVICE)
        runBlocking { container.session.signOut() }
        rule.waitUntilExactlyOneExists(hasTestTag("auth-screen"), timeout)
    }

    @After fun cleanUp() = runBlocking {
        container.connectivity.setSimulatedOffline(false)
        val me = container.session.state.value.userId
        if (me != null) for (content in sentContents) {
            container.api.client.from("chat_messages").delete { filter { eq("sender_id", me); eq("content", content) } }
        }
        container.session.signOut()
        container.device.overrideForTesting(null)
    }

    private fun signInAlice() {
        rule.onNodeWithTag("email").performTextInput("alice@boolaa.test")
        rule.onNodeWithTag("password").performTextInput("password123")
        rule.onNodeWithTag("auth-submit").performClick()
        rule.waitUntilExactlyOneExists(hasTestTag("chat-fab"), timeout)
        rule.onNodeWithTag("bubble-chip-Flatmates").performClick()
    }

    @Test fun message_written_offline_is_sent_once_when_back_online() {
        signInAlice()
        rule.onNodeWithTag("chat-fab").performClick()
        rule.waitUntilExactlyOneExists(hasTestTag("chat-input"), timeout)
        rule.waitUntilDoesNotExist(hasTestTag("loading"), timeout)

        container.connectivity.setSimulatedOffline(true)
        rule.waitUntilExactlyOneExists(hasTestTag("offline-banner"), timeout)
        val text = "Offline from Android ${UUID.randomUUID().toString().take(8)}"
        sentContents += text
        rule.onNodeWithTag("chat-input").performTextInput(text)
        rule.onNodeWithTag("chat-send").performClick()
        rule.waitUntilExactlyOneExists(hasText(text), timeout)
        rule.waitUntilExactlyOneExists(hasTestTag("pending-sending"), timeout)

        container.connectivity.setSimulatedOffline(false)
        rule.waitUntilExactlyOneExists(hasTestTag("back-online"), timeout)
        rule.waitUntilDoesNotExist(hasTestTag("pending-sending"), timeout)
        // A sent message is one TalkBack element: its text is in the row's content description (spec "Accessibility").
        rule.waitUntilExactlyOneExists(hasContentDescription(text, substring = true), timeout)
        val rows = runBlocking {
            container.api.client.from("chat_messages").select(Columns.raw("id")) { filter { eq("content", text) } }.data
        }
        assertEquals("exactly one row on the server", 1, Regex("\"id\"").findAll(rows).count())
    }

    @Test fun failed_send_shows_not_sent_and_tap_retries() {
        signInAlice()
        rule.onNodeWithTag("chat-fab").performClick()
        rule.waitUntilExactlyOneExists(hasTestTag("chat-input"), timeout)
        rule.waitUntilDoesNotExist(hasTestTag("loading"), timeout)
        val text = "Retry from Android ${UUID.randomUUID().toString().take(8)}"
        sentContents += text
        // Typed offline (Sending…), then the OS says online while requests still fail: the flush fails -> Not sent.
        container.connectivity.setSimulatedOffline(true)
        rule.onNodeWithTag("chat-input").performTextInput(text)
        rule.onNodeWithTag("chat-send").performClick()
        rule.waitUntilExactlyOneExists(hasTestTag("pending-sending"), timeout)
        container.connectivity.handle(com.boolaa.app.core.NetEvent.PathChanged(true))
        rule.waitUntilExactlyOneExists(hasTestTag("pending-failed"), timeout)
        rule.onNodeWithText(rule.activity.getString(R.string.offline_not_sent_tap_to_retry)).assertExists()

        // Network back: a tap retries (or the reconnect flush sends it); it lands exactly once.
        container.connectivity.setSimulatedOffline(false)
        rule.onNodeWithTag("pending-failed").performClick()
        rule.waitUntilDoesNotExist(hasTestTag("pending-failed"), timeout)
        rule.waitUntilDoesNotExist(hasTestTag("pending-sending"), 45_000)
        rule.waitUntilExactlyOneExists(hasContentDescription(text, substring = true), timeout)
    }

    @Test fun screen_without_cache_shows_retry_and_recovers_on_reconnect() {
        signInAlice()
        rule.waitUntilExactlyOneExists(hasTestTag("home-screen"), timeout)
        container.connectivity.setSimulatedOffline(true)
        File(context.cacheDir, "offline").deleteRecursively()
        rule.onNodeWithTag("bubble-chip-Climbing Crew").performClick()
        rule.onNodeWithTag("tab-food").performClick()
        rule.waitUntilExactlyOneExists(hasTestTag("load-failed"), timeout)
        rule.onNodeWithTag("load-retry").assertExists()

        container.connectivity.setSimulatedOffline(false)
        rule.waitUntilDoesNotExist(hasTestTag("load-failed"), timeout)
        rule.waitUntilDoesNotExist(hasTestTag("loading"), timeout)
    }

    @Test fun loads_are_cached_per_user_and_cleared_on_sign_out() {
        signInAlice()
        rule.onNodeWithTag("tab-food").performClick()
        rule.waitUntilExactlyOneExists(hasTestTag("food-screen"), timeout)
        rule.waitUntilDoesNotExist(hasTestTag("loading"), timeout)
        val me = container.session.state.value.userId!!
        val bubble = container.session.state.value.currentBubble!!.id
        val ser = ListSerializer(FoodPost.serializer())
        rule.waitUntil(timeout) { container.offlineCache.load(me, CacheKeys.food(bubble), ser) != null }
        assertNotNull(container.offlineCache.load(me, CacheKeys.BUBBLES, com.boolaa.app.state.SessionStore.CachedSession.serializer()))

        runBlocking { container.session.signOut() }
        rule.waitUntilExactlyOneExists(hasTestTag("auth-screen"), timeout)
        rule.waitUntil(timeout) { !File(context.cacheDir, "offline").exists() }
        assertFalse(File(context.filesDir, "outbox").exists())
        // Nothing for the next account.
        assertEquals(null, container.offlineCache.load(me, CacheKeys.chat(bubble), ListSerializer(ChatMessage.serializer())))
    }
}
