package com.boolaa.app

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.boolaa.app.core.Backend
import com.boolaa.app.core.CodePurpose
import com.boolaa.app.core.DeviceCodeBody
import com.boolaa.app.core.DeviceIdentity
import com.boolaa.app.core.UserFacingError
import com.boolaa.app.core.deviceCode
import com.boolaa.app.core.listMyDevices
import com.boolaa.app.core.startDeviceCheck
import com.boolaa.app.state.DeviceGate
import com.boolaa.app.state.LocaleManager
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.postgrest.postgrest
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The auth-security flows end to end against the local stack (docs/auth-security.md): forgot password, the new-device
 * code with enforcement on, a trusted device that skips it, revoking a device, and deleting an account with a code.
 * Needs `adb reverse` for 55321 (API) and 55324 (Mailpit). Enforcement is restored after each test; throwaway users
 * are deleted.
 */
@OptIn(ExperimentalTestApi::class)
@RunWith(AndroidJUnit4::class)
class AuthSecurityFlowTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()

    private val container get() = (InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as BoolaaApplication).container
    private val timeout = 25_000L
    private val cleanup = mutableListOf<suspend () -> Unit>()

    @Before fun signedOutInEnglish() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync { LocaleManager.set("en") }
        runBlocking { container.session.signOut() }
        rule.waitUntilExactlyOneExists(hasTestTag("auth-screen"), timeout)
    }

    @After fun tearDown() = runBlocking {
        container.session.signOut()
        container.device.overrideForTesting(null)
        cleanup.asReversed().forEach { runCatching { it() } }
    }

    private fun signIn(email: String, password: String = "password123") {
        rule.onNodeWithTag("email").performTextInput(email)
        rule.onNodeWithTag("password").performTextInput(password)
        rule.onNodeWithTag("auth-submit").performClick()
    }

    private fun typeCode(code: String) {
        rule.waitUntilExactlyOneExists(hasTestTag("code-field"), timeout)
        rule.onNodeWithTag("code-field").performTextInput(code)
    }

    private suspend fun expectError(expected: UserFacingError, block: suspend () -> Unit) {
        try { block(); fail("expected $expected") } catch (e: AssertionError) { throw e } catch (e: Throwable) {
            assertEquals(expected, UserFacingError.classify(e))
        }
    }

    @Test fun forgot_password_resets_with_the_emailed_code() = runBlocking {
        val user = LocalStack.throwaway("reset")
        cleanup += { user.api.deleteMyAccount(user.id) }
        container.device.overrideForTesting(LocalStack.randomDeviceId())

        rule.onNodeWithTag("forgot-password").performClick()
        rule.onNodeWithTag("forgot-email").performTextInput(user.email)
        val before = LocalStack.messageIds(user.email)
        rule.onNodeWithTag("forgot-send").performClick()
        val code = LocalStack.awaitCode(user.email, before)
        typeCode(code)

        rule.waitUntilExactlyOneExists(hasTestTag("reset-password-screen"), timeout)
        rule.onNodeWithTag("new-password").performTextInput("newpass456")
        rule.onNodeWithTag("repeat-password").performTextInput("newpass456")
        rule.onNodeWithTag("save-password").performClick()
        // No bubbles yet: the routing gate continues to onboarding, signed in.
        rule.waitUntilExactlyOneExists(hasTestTag("onboarding-screen"), timeout)
        assertEquals(DeviceGate.VERIFIED, container.session.state.value.deviceGate)

        val check = Backend.createClient(ephemeral = true)
        check.auth.signInWith(Email) { email = user.email; password = "newpass456" }
        expectError(UserFacingError.INVALID_CREDENTIALS) {
            Backend.createClient(ephemeral = true).auth.signInWith(Email) { email = user.email; password = "password123" }
        }
    }

    @Test fun new_device_needs_the_emailed_code_when_enforced() = runBlocking {
        val user = LocalStack.throwaway("newdevice")
        user.api.createBubble("Android device ${user.id.take(6)}", null, 4)
        cleanup += { user.api.deleteMyAccount(user.id) }
        container.device.overrideForTesting(LocalStack.randomDeviceId())

        LocalStack.withEnforcement {
            val before = LocalStack.messageIds(user.email)
            signIn(user.email)
            rule.waitUntilExactlyOneExists(hasTestTag("device-code-screen"), timeout)
            assertEquals(DeviceGate.CODE_REQUIRED, container.session.state.value.deviceGate)
            assertTrue(rule.onAllNodesWithTag("chat-fab").fetchSemanticsNodes().isEmpty())
            val code = LocalStack.awaitCode(user.email, before) // sent automatically on entry

            // A wrong code: shake, "N tries left", the boxes clear.
            typeCode(if (code == "000000") "111111" else "000000")
            rule.waitUntilExactlyOneExists(hasTestTag("code-error") and hasText("4 tries left", substring = true), timeout)

            typeCode(code)
            rule.waitUntilExactlyOneExists(hasTestTag("chat-fab"), timeout)
            assertEquals(DeviceGate.VERIFIED, container.session.state.value.deviceGate)
            assertTrue(container.session.state.value.bubbles.isNotEmpty())
        }
    }

    @Test fun trusted_device_skips_the_code() = runBlocking {
        container.device.overrideForTesting(LocalStack.SEEDED_DEVICE)
        LocalStack.withEnforcement {
            val before = LocalStack.messageIds("alice@boolaa.test")
            signIn("alice@boolaa.test")
            rule.waitUntilExactlyOneExists(hasTestTag("chat-fab"), timeout)
            assertEquals(DeviceGate.VERIFIED, container.session.state.value.deviceGate)
            assertTrue(rule.onAllNodesWithTag("device-code-screen").fetchSemanticsNodes().isEmpty())
            assertEquals(before, LocalStack.messageIds("alice@boolaa.test")) // no code was emailed
        }
    }

    @Test fun revoke_a_device_from_your_devices() = runBlocking {
        val user = LocalStack.throwaway("revoke")
        user.api.createBubble("Android revoke ${user.id.take(6)}", null, 4)
        cleanup += { user.api.deleteMyAccount(user.id) }

        // Device 1: the ephemeral client confirms its device with an emailed code.
        val d1 = LocalStack.randomDeviceId()
        assertFalse(user.api.startDeviceCheck(d1, "Test phone · Android 16").verified)
        var before = LocalStack.messageIds(user.email)
        user.api.deviceCode(DeviceCodeBody.send(CodePurpose.DEVICE, d1, "Test phone · Android 16", null, "en"))
        user.api.deviceCode(DeviceCodeBody.verify(CodePurpose.DEVICE, LocalStack.awaitCode(user.email, before), d1, "Test phone · Android 16"))
        assertTrue(user.api.startDeviceCheck(d1, "Test phone · Android 16").verified)

        // Device 2: the app.
        container.device.overrideForTesting(LocalStack.randomDeviceId())
        before = LocalStack.messageIds(user.email)
        signIn(user.email)
        rule.waitUntilExactlyOneExists(hasTestTag("device-code-screen"), timeout)
        typeCode(LocalStack.awaitCode(user.email, before))
        rule.waitUntilExactlyOneExists(hasTestTag("chat-fab"), timeout)

        rule.onNodeWithTag("profile-button").performClick()
        rule.waitUntilExactlyOneExists(hasTestTag("your-devices"), timeout)
        rule.onNodeWithTag("your-devices").performScrollTo()
        rule.waitUntilExactlyOneExists(hasTestTag("device-this"), timeout)
        rule.waitUntilExactlyOneExists(hasTestTag("device-${DeviceIdentity.sha256Hex(d1).take(12)}"), timeout)
        rule.onNodeWithTag("revoke-device").performScrollTo().performClick()
        rule.onNodeWithTag("confirm-dialog-confirm").performClick()
        rule.waitUntil(timeout) { rule.onAllNodesWithTag("revoke-device").fetchSemanticsNodes().isEmpty() }

        assertEquals(listOf(container.device.hash), container.session.devices().map { it.deviceHash })
        // The revoked device needs a code again.
        assertFalse(user.api.startDeviceCheck(d1, "Test phone · Android 16").verified)
        assertEquals(1, user.api.listMyDevices().size)
    }

    @Test fun delete_account_needs_an_emailed_code() = runBlocking {
        val user = LocalStack.throwaway("delete")
        user.api.createBubble("Android delete ${user.id.take(6)}", null, 4)
        var deleted = false
        cleanup += { if (!deleted) user.api.deleteMyAccount(user.id) }
        container.device.overrideForTesting(LocalStack.randomDeviceId())

        LocalStack.withEnforcement {
            var before = LocalStack.messageIds(user.email)
            signIn(user.email)
            rule.waitUntilExactlyOneExists(hasTestTag("device-code-screen"), timeout)
            typeCode(LocalStack.awaitCode(user.email, before))
            rule.waitUntilExactlyOneExists(hasTestTag("chat-fab"), timeout)

            // Without a fresh sensitive-action code the server refuses.
            expectError(UserFacingError.REAUTHENTICATION_REQUIRED) { container.api.client.postgrest.rpc("delete_my_account") }

            rule.onNodeWithTag("profile-button").performClick()
            rule.waitUntilExactlyOneExists(hasTestTag("delete-account"), timeout)
            rule.onNodeWithTag("delete-account").performScrollTo().performClick()
            rule.waitUntilExactlyOneExists(hasTestTag("delete-confirm-input"), timeout)
            rule.onNodeWithTag("delete-confirm-input").performTextInput("DELETE")
            before = LocalStack.messageIds(user.email)
            rule.onNodeWithTag("delete-confirm").performClick()
            typeCode(LocalStack.awaitCode(user.email, before))
            rule.waitUntilExactlyOneExists(hasTestTag("auth-screen"), timeout)
            deleted = true
        }
        expectError(UserFacingError.INVALID_CREDENTIALS) {
            Backend.createClient(ephemeral = true).auth.signInWith(Email) { email = user.email; password = "password123" }
        }
    }
}
