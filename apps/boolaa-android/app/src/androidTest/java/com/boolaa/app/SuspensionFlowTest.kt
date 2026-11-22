package com.boolaa.app

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.boolaa.app.core.DeviceIdentity
import com.boolaa.app.core.Suspension
import com.boolaa.app.core.startDeviceCheck
import com.boolaa.app.state.DeviceGate
import com.boolaa.app.state.LocaleManager
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeFalse
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.time.Instant
import java.time.temporal.ChronoUnit

/**
 * The device-check fallback with enforcement off (the production default) and the suspended screen
 * (docs/moderation.md "Clients"), against the local stack. Never changes `app_settings`: the fallback test is skipped
 * when enforcement happens to be on. Only throwaway users are suspended or banned, and they are deleted afterwards.
 */
@OptIn(ExperimentalTestApi::class)
@RunWith(AndroidJUnit4::class)
class SuspensionFlowTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()

    private val container get() = (InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as BoolaaApplication).container
    private val timeout = 25_000L
    private val cleanup = mutableListOf<suspend () -> Unit>()

    @Before fun signedOutInEnglish() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync { LocaleManager.set("en") }
        runBlocking { container.session.signOut() }
        container.session.dismissSignInBlocked()
        rule.waitUntilExactlyOneExists(hasTestTag("auth-screen"), timeout)
    }

    @After fun tearDown() = runBlocking {
        container.session.signOut()
        container.session.dismissSignInBlocked()
        container.device.overrideForTesting(null)
        cleanup.asReversed().forEach { runCatching { it() } }
    }

    private fun signIn(email: String, password: String = "password123") {
        rule.onNodeWithTag("email").performTextInput(email)
        rule.onNodeWithTag("password").performTextInput(password)
        rule.onNodeWithTag("auth-submit").performClick()
    }

    private suspend fun throwaway(tag: String, withBubble: Boolean = true): LocalStack.Throwaway {
        val user = LocalStack.throwaway(tag)
        if (withBubble) user.api.createBubble("Android $tag ${user.id.take(6)}", null, 4)
        cleanup += { LocalStack.deleteAuthUser(user.id) }
        return user
    }

    @Test fun new_device_skips_the_code_while_enforcement_is_off() = runBlocking {
        assumeFalse("device_verification_enforced is on locally; this test never flips it", LocalStack.deviceVerificationEnforced())
        val user = throwaway("fallback")
        val deviceId = LocalStack.randomDeviceId()
        container.device.overrideForTesting(deviceId)
        val before = LocalStack.messageIds(user.email)

        signIn(user.email)
        rule.waitUntilExactlyOneExists(hasTestTag("chat-fab"), timeout)
        assertEquals(DeviceGate.VERIFIED, container.session.state.value.deviceGate)
        assertTrue(rule.onAllNodesWithTag("device-code-screen").fetchSemanticsNodes().isEmpty())
        // The server still says code_required for this device: the fallback (is_device_verified) let it through.
        assertFalse(container.api.startDeviceCheck(deviceId, DeviceIdentity.label()).verified)
        assertEquals(before, LocalStack.messageIds(user.email)) // no code was emailed
    }

    @Test fun suspended_account_sees_reason_and_end_date_then_gets_back_in_when_lifted() = runBlocking {
        val user = throwaway("suspended")
        container.device.overrideForTesting(LocalStack.randomDeviceId())
        val until = Instant.now().plus(7, ChronoUnit.DAYS).truncatedTo(ChronoUnit.SECONDS)
        LocalStack.setAccountStatus(user.id, "suspended", "harassment", until.toString())

        signIn(user.email)
        rule.waitUntilExactlyOneExists(hasTestTag("suspended"), timeout)
        rule.onNodeWithTag("suspended-title").assertExists().assert(hasText("Your account is suspended"))
        rule.onNodeWithTag("suspended-until").assert(hasText("You can use Boolaa again from", substring = true))
        rule.onNodeWithTag("suspended-reason").assert(hasText("Reason: Harassment or bullying"))
        rule.onNodeWithTag("suspended-appeal").assert(hasText("privacy@boolaa.ro", substring = true))
        val s = container.session.state.value.suspension
        assertEquals(Suspension.Kind.SUSPENDED, s?.kind)
        assertEquals(until, s?.until)
        assertTrue(rule.onAllNodesWithTag("chat-fab").fetchSemanticsNodes().isEmpty())

        // A moderator lifts it; coming back to the app re-runs the gate.
        LocalStack.setAccountStatus(user.id, "active", null, null)
        container.session.recheckDevice()
        rule.waitUntilExactlyOneExists(hasTestTag("chat-fab"), timeout)
        assertEquals(null, container.session.state.value.suspension)
    }

    @Test fun banned_account_signs_out_from_the_suspended_screen() = runBlocking {
        val user = throwaway("banned", withBubble = false)
        container.device.overrideForTesting(LocalStack.randomDeviceId())
        LocalStack.setAccountStatus(user.id, "banned", "spam", null)

        signIn(user.email)
        rule.waitUntilExactlyOneExists(hasTestTag("suspended"), timeout)
        rule.onNodeWithTag("suspended-title").assert(hasText("Your account is banned"))
        rule.onNodeWithTag("suspended-reason").assert(hasText("Reason: Spam"))
        assertTrue(rule.onAllNodesWithTag("suspended-until").fetchSemanticsNodes().isEmpty())
        rule.onNodeWithTag("suspended-sign-out").performScrollTo().performClick()
        rule.waitUntilExactlyOneExists(hasTestTag("auth-screen"), timeout)
        assertEquals(null, container.session.state.value.userId)
    }

    @Test fun user_banned_at_sign_in_shows_the_cant_sign_in_screen() = runBlocking {
        val user = throwaway("gotrueban", withBubble = false)
        LocalStack.banAuthUser(user.id)

        signIn(user.email)
        rule.waitUntilExactlyOneExists(hasTestTag("suspended"), timeout)
        rule.onNodeWithText("This account can't sign in right now: it's suspended or banned.").assertExists()
        assertEquals(Suspension.signInBlocked, container.session.state.value.suspension)
        assertEquals(null, container.session.state.value.userId)
        rule.onNodeWithTag("suspended-back").performScrollTo().performClick()
        rule.waitUntilExactlyOneExists(hasTestTag("auth-screen"), timeout)
    }
}
