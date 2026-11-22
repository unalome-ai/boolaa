package com.boolaa.app

import androidx.credentials.CustomCredential
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialUnknownException
import androidx.credentials.exceptions.NoCredentialException
import com.boolaa.app.core.AuthProviders
import com.boolaa.app.core.CodePurpose
import com.boolaa.app.core.DeviceCheck
import com.boolaa.app.core.DeviceCodeBody
import com.boolaa.app.core.DeviceCodeException
import com.boolaa.app.core.DeviceIdentity
import com.boolaa.app.core.GoogleSignIn
import com.boolaa.app.core.OAuthNonce
import com.boolaa.app.core.SensitiveAction
import com.boolaa.app.core.SocialSignInException
import com.boolaa.app.core.TERMS_VERSION
import com.boolaa.app.core.TrustedDevice
import com.boolaa.app.core.BoolaaJson
import com.boolaa.app.core.UserFacingError
import com.boolaa.app.core.UserFacingError.Companion.classify
import com.boolaa.app.state.AppRoute
import com.boolaa.app.state.DeviceGate
import com.boolaa.app.state.RouteGate
import com.boolaa.app.state.SessionStore
import com.boolaa.app.ui.auth.CodeError
import com.boolaa.app.ui.auth.codeDigits
import io.github.jan.supabase.auth.providers.Google
import io.github.jan.supabase.auth.providers.builtin.IDToken
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.security.MessageDigest
import java.security.SecureRandom

class DeviceGateRoutingTest {
    @Test fun unverified_sessions_never_reach_the_bubbles() {
        assertEquals(AppRoute.LAUNCHING, RouteGate.resolve(false, true, 2, DeviceGate.CHECKING))
        assertEquals(AppRoute.DEVICE_CODE, RouteGate.resolve(false, true, 2, DeviceGate.CODE_REQUIRED))
        assertEquals(AppRoute.DEVICE_CODE, RouteGate.resolve(false, true, null, DeviceGate.CODE_REQUIRED, needsAgeConfirmation = true))
        assertEquals(AppRoute.AGE_CONFIRMATION, RouteGate.resolve(false, true, 2, DeviceGate.VERIFIED, needsAgeConfirmation = true))
        assertEquals(AppRoute.MAIN, RouteGate.resolve(false, true, 2, DeviceGate.VERIFIED))
        assertEquals(AppRoute.ONBOARDING, RouteGate.resolve(false, true, 0, DeviceGate.VERIFIED))
    }

    @Test fun reset_code_session_sets_its_password_first_and_signed_out_is_auth() {
        assertEquals(AppRoute.RESET_PASSWORD, RouteGate.resolve(false, true, 2, DeviceGate.VERIFIED, recoveringPassword = true))
        assertEquals(AppRoute.RESET_PASSWORD, RouteGate.resolve(false, true, null, DeviceGate.CHECKING, recoveringPassword = true))
        assertEquals(AppRoute.AUTH, RouteGate.resolve(false, false, null, DeviceGate.CODE_REQUIRED, true, true))
    }

    @Test fun auto_send_once_and_resend_cooldown() {
        val t = 1_000_000L
        assertTrue(RouteGate.shouldAutoSend(null, t))
        assertFalse(RouteGate.shouldAutoSend(t - 59_000, t))
        assertTrue(RouteGate.shouldAutoSend(t - 60_000, t))
        assertEquals(0, RouteGate.resendSecondsLeft(null, t))
        assertEquals(60, RouteGate.resendSecondsLeft(t, t))
        assertEquals(1, RouteGate.resendSecondsLeft(t - 59_500, t))
        assertEquals(0, RouteGate.resendSecondsLeft(t - 61_000, t))
    }
}

class DeviceCodeContractTest {
    @Test fun function_bodies_match_the_contract() {
        val send = DeviceCodeBody.send(CodePurpose.DEVICE, "dev-id", "Pixel 9 · Android 16", null, "ro")
        assertEquals("send", send["action"]!!.jsonPrimitive.content)
        assertEquals("device", send["purpose"]!!.jsonPrimitive.content)
        assertEquals("dev-id", send["device_id"]!!.jsonPrimitive.content)
        assertEquals("Pixel 9 · Android 16", send["label"]!!.jsonPrimitive.content)
        assertNull(send["sensitive_action"])

        val del = DeviceCodeBody.send(CodePurpose.SENSITIVE_ACTION, "ignored", "ignored", SensitiveAction.DELETE_ACCOUNT, null)
        assertEquals("sensitive_action", del["purpose"]!!.jsonPrimitive.content)
        assertEquals("delete_account", del["sensitive_action"]!!.jsonPrimitive.content)
        assertNull(del["device_id"])

        val verify = DeviceCodeBody.verify(CodePurpose.SENSITIVE_ACTION, "123456", null, null)
        assertEquals(setOf("action", "purpose", "code"), verify.keys)
        assertEquals("123456", verify["code"]!!.jsonPrimitive.content)
        assertEquals("dev-id", DeviceCodeBody.verify(CodePurpose.DEVICE, "123456", "dev-id", "x")["device_id"]!!.jsonPrimitive.content)
    }

    @Test fun function_errors_parse_and_map() {
        val wrong = DeviceCodeException.from(400, """{"error":"invalid_code","attempts_left":3}""")
        assertEquals("invalid_code", wrong.code)
        assertEquals(3, wrong.attemptsLeft)
        assertEquals(CodeError(R.string.error_code_wrong, 3), CodeError.from(wrong))
        assertEquals("server_error", DeviceCodeException.from(500, "<html>").code)
        assertEquals("unauthorized", DeviceCodeException.from(401, "").code)

        val expected = mapOf(
            "invalid_request" to UserFacingError.CODE_FORMAT, "invalid_code" to UserFacingError.CODE_WRONG,
            "unauthorized" to UserFacingError.NOT_AUTHENTICATED, "session_not_verified" to UserFacingError.SESSION_NOT_VERIFIED,
            "no_active_code" to UserFacingError.NO_ACTIVE_CODE, "code_expired" to UserFacingError.CODE_EXPIRED,
            "too_many_attempts" to UserFacingError.TOO_MANY_ATTEMPTS, "rate_limited" to UserFacingError.TOO_MANY_CODES,
            "email_failed" to UserFacingError.EMAIL_SEND_FAILED, "server_error" to UserFacingError.GENERIC,
        )
        expected.forEach { (code, kind) -> assertEquals(code, kind, classify(DeviceCodeException(400, code))) }
        assertEquals(CodeError(R.string.error_code_expired), CodeError.from(DeviceCodeException(410, "code_expired")))
    }

    @Test fun rpc_texts_of_the_auth_migration() {
        assertEquals(UserFacingError.SESSION_NOT_VERIFIED, classify("session not verified", "42501"))
        assertEquals(UserFacingError.AGE_CONFIRMATION_REQUIRED, classify("age confirmation required", "42501"))
        assertEquals(UserFacingError.REAUTHENTICATION_REQUIRED, classify("reauthentication required", "42501"))
        assertEquals(UserFacingError.INVALID_DEVICE_ID, classify("invalid device id", "P0001"))
        assertEquals(UserFacingError.INVALID_TERMS_VERSION, classify("invalid terms version", "P0001"))
        assertEquals(UserFacingError.CODE_WRONG_OR_EXPIRED, classify("Token has expired or is invalid", null))
        assertEquals(UserFacingError.EMAIL_RATE_LIMITED, classify("email rate limit exceeded", null))
        assertEquals(UserFacingError.INVALID_EMAIL, classify("Unable to validate email address: invalid format", null))
        assertEquals(UserFacingError.SAME_PASSWORD, classify("New password should be different from the old password.", null))
    }

    @Test fun start_device_check_and_devices_decode() {
        val check = BoolaaJson.json.decodeFromString<DeviceCheck>("""{"status": "code_required", "needs_age_confirmation": false}""")
        assertFalse(check.verified)
        assertTrue(BoolaaJson.json.decodeFromString<DeviceCheck>("""{"status":"verified","needs_age_confirmation":true}""").needsAgeConfirmation)
        val devices = BoolaaJson.json.decodeFromString<List<TrustedDevice>>(
            """[{"device_hash":"ab12","label":"Pixel 9 · Android 16","created_at":"2026-11-22T10:00:00.123+00:00","last_seen_at":"2026-11-22T11:00:00+00:00"}]""",
        )
        assertEquals("ab12", devices.single().deviceHash)
        assertEquals("2026-11-22T11:00:00Z", devices.single().lastSeenAt.toString())
    }

    @Test fun code_input_keeps_six_digits_from_typing_or_paste() {
        assertEquals("123456", codeDigits("123 456"))
        assertEquals("123456", codeDigits("Your code: 123456."))
        assertEquals("123456", codeDigits("1234567"))
        assertEquals("", codeDigits("abc"))
    }

    @Test fun sign_up_metadata() {
        val data = SessionStore.signUpMetadata("  Ana ", "ro")
        assertEquals("Ana", data["name"]!!.jsonPrimitive.content)
        assertEquals("ro", data["locale"]!!.jsonPrimitive.content)
        assertTrue(data["age_confirmed"]!!.jsonPrimitive.boolean)
        assertTrue((data["age_confirmed"] as JsonPrimitive).isString.not())
        assertEquals("2026-11-22", data["terms_version"]!!.jsonPrimitive.content)
        assertEquals("2026-11-22", TERMS_VERSION)
    }

    @Test fun provider_switch_from_auth_settings() {
        val settings = """{"external":{"apple":false,"google":true,"email":true},"disable_signup":false}"""
        assertFalse(AuthProviders.parseEnabled(settings, "apple"))
        assertTrue(AuthProviders.parseEnabled(settings, "google"))
        assertFalse(AuthProviders.parseEnabled("not json", "google"))
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = android.app.Application::class)
class DeviceIdentityTest {
    private class MemoryStore : DeviceIdentity.SecretStore {
        val values = mutableMapOf<String, String>()
        var writes = 0
        override fun read(key: String) = values[key]
        override fun write(key: String, value: String) { writes++; values[key] = value }
    }

    private fun sha256(s: String) = MessageDigest.getInstance("SHA-256").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }

    @Test fun created_once_32_random_bytes_base64url_and_kept() {
        val store = MemoryStore()
        val a = DeviceIdentity(store)
        val id = a.id
        assertEquals(43, id.length)
        assertTrue(id.matches(Regex("[A-Za-z0-9_-]{43}")))
        assertEquals(id, a.id)
        assertEquals(id, DeviceIdentity(store).id) // a new process reads the stored value
        assertEquals(1, store.writes)
        assertNotEquals(id, DeviceIdentity(MemoryStore()).id)
    }

    @Test fun hash_is_lowercase_sha256_and_tests_can_use_the_seeded_device() {
        val d = DeviceIdentity(MemoryStore())
        assertEquals(sha256(d.id), d.hash)
        d.overrideForTesting("boolaa-test-device")
        assertEquals("boolaa-test-device", d.id)
        // supabase/seed.sql: encode(digest('boolaa-test-device', 'sha256'), 'hex')
        assertEquals(sha256("boolaa-test-device"), d.hash)
        d.overrideForTesting(null)
        assertNotEquals("boolaa-test-device", d.id)
    }

    @Test fun label_is_model_plus_android_and_capped() {
        assertEquals("Pixel 9 · Android 16", DeviceIdentity.label("Pixel 9", "16"))
        assertEquals("sdk_gphone64_arm64 · Android 16", DeviceIdentity.label("sdk_gphone64_arm64", "16"))
        assertEquals("Android · 16", DeviceIdentity.label("", "16"))
        assertEquals(120, DeviceIdentity.label("x".repeat(300), "16").length)
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = android.app.Application::class)
class GoogleSignInWiringTest {
    @Test fun nonce_google_gets_the_hash_supabase_gets_the_raw_value() {
        val nonce = OAuthNonce.create(SecureRandom())
        assertEquals(43, nonce.raw.length)
        assertEquals(MessageDigest.getInstance("SHA-256").digest(nonce.raw.toByteArray()).joinToString("") { "%02x".format(it) }, nonce.hashed)
        assertNotEquals(nonce.raw, OAuthNonce.create().raw)

        val option = GoogleSignIn.option(nonce)
        assertEquals(BuildConfig.GOOGLE_WEB_CLIENT_ID, option.serverClientId)
        assertEquals("816126337836-0k4begddfi0f1usm1hg2e6va9fddni3m.apps.googleusercontent.com", option.serverClientId)
        assertEquals(nonce.hashed, option.nonce)
        assertFalse(option.filterByAuthorizedAccounts)

        val config = IDToken.Config().apply(GoogleSignIn.idTokenConfig("google-id-token", nonce.raw))
        assertEquals(Google, config.provider)
        assertEquals("google-id-token", config.idToken)
        assertEquals(nonce.raw, config.nonce)
    }

    @Test fun no_google_account_degrades_to_a_message_and_cancel_is_silent() {
        val none = GoogleSignIn.mapFailure(NoCredentialException("no accounts"))
        assertEquals(UserFacingError.GOOGLE_NO_ACCOUNT, none!!.kind)
        assertEquals(UserFacingError.GOOGLE_NO_ACCOUNT, classify(none))
        assertNull(GoogleSignIn.mapFailure(GetCredentialCancellationException("closed")))
        assertEquals(UserFacingError.SIGN_IN_PROVIDER_FAILED, GoogleSignIn.mapFailure(GetCredentialUnknownException("x"))!!.kind)
    }

    @Test fun only_google_id_token_credentials_are_accepted() {
        val other = CustomCredential("some.other.type", android.os.Bundle())
        val e = runCatching { GoogleSignIn.idToken(other) }.exceptionOrNull()
        assertTrue(e is SocialSignInException)
        assertEquals(UserFacingError.SIGN_IN_PROVIDER_FAILED, (e as SocialSignInException).kind)
    }
}
