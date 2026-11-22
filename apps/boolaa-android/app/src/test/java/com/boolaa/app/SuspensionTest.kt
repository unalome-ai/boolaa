package com.boolaa.app

import com.boolaa.app.core.AccountStatusRow
import com.boolaa.app.core.BoolaaJson
import com.boolaa.app.core.DeviceCheck
import com.boolaa.app.core.DeviceGateDecision
import com.boolaa.app.core.Suspension
import com.boolaa.app.core.UserBanned
import com.boolaa.app.core.UserFacingError
import com.boolaa.app.core.UserFacingError.Companion.classify
import com.boolaa.app.model.ReportReason
import com.boolaa.app.state.AppRoute
import com.boolaa.app.state.DeviceGate
import com.boolaa.app.state.RouteGate
import com.boolaa.app.state.SessionState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/** The `code_required` fallback through `is_device_verified()` (web `gateState`, iOS `DeviceGateDecision`). */
class DeviceGateFallbackTest {
    private val codeRequired = DeviceCheck("code_required")
    private val verified = DeviceCheck("verified")
    private val active = AccountStatusRow(status = "active", ageConfirmedAt = Instant.parse("2026-11-01T00:00:00Z"))

    @Test fun code_required_is_skipped_while_enforcement_is_off() {
        // device_verification_enforced off: is_device_verified() is true, so no code screen.
        assertEquals(DeviceGateDecision.Ok, DeviceGateDecision.decide(codeRequired, deviceVerified = true, account = active, isOAuthUser = false))
        assertTrue(DeviceGateDecision.gateOpen(codeRequired, true))
    }

    @Test fun code_required_blocks_when_enforced_or_unknown() {
        assertEquals(DeviceGateDecision.Code, DeviceGateDecision.decide(codeRequired, deviceVerified = false, account = active, isOAuthUser = false))
        // The RPC failed: keep the gate closed, never let an unverified session through.
        assertEquals(DeviceGateDecision.Code, DeviceGateDecision.decide(codeRequired, deviceVerified = null, account = active, isOAuthUser = false))
        assertFalse(DeviceGateDecision.gateOpen(codeRequired, false))
        assertFalse(DeviceGateDecision.gateOpen(codeRequired, null))
        // A suspended account behind the code screen still sees the code screen first (its row is unreadable).
        val banned = AccountStatusRow(status = "banned")
        assertEquals(DeviceGateDecision.Code, DeviceGateDecision.decide(codeRequired, deviceVerified = false, account = banned, isOAuthUser = false))
    }

    @Test fun verified_device_needs_no_extra_call() {
        assertTrue(DeviceGateDecision.gateOpen(verified, null))
        assertEquals(DeviceGateDecision.Ok, DeviceGateDecision.decide(verified, deviceVerified = null, account = active, isOAuthUser = false))
    }

    @Test fun age_screen_after_the_fallback() {
        val check = DeviceCheck("code_required", needsAgeConfirmation = true)
        assertEquals(DeviceGateDecision.Age, DeviceGateDecision.decide(check, deviceVerified = true, account = active, isOAuthUser = false))
        // First Google/Apple sign-in: 16+ once, even before the server flag is on.
        val noAge = AccountStatusRow(status = "active")
        assertEquals(DeviceGateDecision.Age, DeviceGateDecision.decide(verified, null, noAge, isOAuthUser = true))
        assertEquals(DeviceGateDecision.Ok, DeviceGateDecision.decide(verified, null, noAge, isOAuthUser = false))
        // Row unreadable (offline): don't block on it.
        assertEquals(DeviceGateDecision.Ok, DeviceGateDecision.decide(verified, null, null, isOAuthUser = true))
    }
}

/** docs/moderation.md: inactive = banned, or suspended with no end or an end in the future. */
class SuspensionTest {
    private val now = Instant.parse("2026-11-22T12:00:00Z")
    private val verified = DeviceCheck("verified")

    @Test fun suspension_follows_is_account_active() {
        val until = Instant.parse("2026-11-29T12:00:00Z")
        assertEquals(
            Suspension(Suspension.Kind.SUSPENDED, until, ReportReason.HARASSMENT),
            Suspension.from(AccountStatusRow("suspended", "harassment", until), now),
        )
        assertEquals(Suspension(Suspension.Kind.SUSPENDED, null, null), Suspension.from(AccountStatusRow("suspended", null, null), now))
        // Ended by itself: no job runs, the client applies the same rule.
        assertNull(Suspension.from(AccountStatusRow("suspended", "spam", now), now))
        assertNull(Suspension.from(AccountStatusRow("suspended", "spam", now.minusSeconds(60)), now))
        assertEquals(Suspension(Suspension.Kind.BANNED, null, ReportReason.SELF_HARM), Suspension.from(AccountStatusRow("banned", "self_harm"), now))
        assertNull(Suspension.from(AccountStatusRow("active"), now))
        assertNull(Suspension.from(AccountStatusRow(null), now))
        // Unknown category: no reason line rather than raw text.
        assertNull(Suspension.from(AccountStatusRow("banned", "moderator note"), now)!!.reason)
    }

    @Test fun suspended_wins_over_age_and_ok() {
        val row = AccountStatusRow("suspended", "spam", now.plusSeconds(3600))
        val d = DeviceGateDecision.decide(DeviceCheck("verified", needsAgeConfirmation = true), null, row, isOAuthUser = true, now = now)
        assertEquals(DeviceGateDecision.Suspended(Suspension(Suspension.Kind.SUSPENDED, now.plusSeconds(3600), ReportReason.SPAM)), d)
        // Enforcement off and code_required, but suspended: the suspended screen, not the code screen.
        val off = DeviceGateDecision.decide(DeviceCheck("code_required"), true, row, isOAuthUser = false, now = now)
        assertTrue(off is DeviceGateDecision.Suspended)
        assertEquals(DeviceGateDecision.Ok, DeviceGateDecision.decide(verified, null, AccountStatusRow("suspended", "spam", now.minusSeconds(1)), false, now))
    }

    @Test fun own_row_decodes() {
        val row = BoolaaJson.json.decodeFromString<AccountStatusRow>(
            """{"status":"suspended","status_reason":"hate","status_until":"2026-11-29T12:00:00.123456+00:00","age_confirmed_at":null}""",
        )
        assertEquals("suspended", row.status)
        assertEquals("hate", row.statusReason)
        assertEquals(Instant.parse("2026-11-29T12:00:00.123456Z"), row.statusUntil)
        assertNull(row.ageConfirmedAt)
    }

    @Test fun routing() {
        // Signed in and suspended: after the device gate, before age / onboarding / main.
        assertEquals(AppRoute.SUSPENDED, RouteGate.resolve(false, true, null, DeviceGate.VERIFIED, needsAgeConfirmation = true, suspended = true))
        assertEquals(AppRoute.SUSPENDED, RouteGate.resolve(false, true, 3, DeviceGate.VERIFIED, suspended = true))
        assertEquals(AppRoute.DEVICE_CODE, RouteGate.resolve(false, true, null, DeviceGate.CODE_REQUIRED, suspended = true))
        assertEquals(AppRoute.LAUNCHING, RouteGate.resolve(false, true, null, DeviceGate.CHECKING, suspended = true))
        assertEquals(AppRoute.RESET_PASSWORD, RouteGate.resolve(false, true, null, DeviceGate.VERIFIED, recoveringPassword = true, suspended = true))
        // Signed out after `user_banned`: the "can't sign in" screen; otherwise Auth.
        assertEquals(AppRoute.SUSPENDED, RouteGate.resolve(false, false, null, suspended = true))
        assertEquals(AppRoute.AUTH, RouteGate.resolve(false, false, null))
        assertEquals(AppRoute.LAUNCHING, RouteGate.resolve(true, false, null, suspended = true))
        // SessionState wires the suspension into the route.
        assertEquals(AppRoute.SUSPENDED, SessionState(isRestoringSession = false, suspension = Suspension.signInBlocked).route)
        assertEquals(AppRoute.AUTH, SessionState(isRestoringSession = false).route)
    }

    @Test fun errors_map_to_suspension() {
        assertEquals(UserFacingError.ACCOUNT_SUSPENDED, classify("account suspended", "42501"))
        assertEquals(UserFacingError.USER_BANNED, classify("User is banned", null))
        assertEquals(UserFacingError.USER_BANNED, classify("user_banned User is banned", null))
        assertEquals(UserFacingError.ACCOUNT_SUSPENDED, classify(IllegalStateException("account suspended")))
        // Still the device gate's own error when the device is the problem.
        assertEquals(UserFacingError.SESSION_NOT_VERIFIED, classify("session not verified", "42501"))
    }

    @Test fun user_banned_in_auth_callback() {
        assertTrue(UserBanned.inCallback("ro.boolaa.app://auth/callback#error=access_denied&error_code=user_banned&error_description=User+is+banned"))
        assertTrue(UserBanned.inCallback("ro.boolaa.app://auth/callback?error=server_error&error_description=User%20is%20banned"))
        assertTrue(UserBanned.inCallback("ro.boolaa.app://auth/callback?error_code=user_banned"))
        assertFalse(UserBanned.inCallback("ro.boolaa.app://auth/callback?code=abc123"))
        assertFalse(UserBanned.inCallback("ro.boolaa.app://auth/callback#error_code=otp_expired&error_description=Email+link+is+invalid"))
        assertFalse(UserBanned.inCallback(null))
    }
}
