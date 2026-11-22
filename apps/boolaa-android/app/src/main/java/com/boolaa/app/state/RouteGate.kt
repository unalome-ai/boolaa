package com.boolaa.app.state

import com.boolaa.app.model.Bubble

/** Top-level destinations decided by the routing gate (spec §2, docs/auth-security.md §8, docs/moderation.md). */
enum class AppRoute { LAUNCHING, AUTH, RESET_PASSWORD, DEVICE_CODE, AGE_CONFIRMATION, SUSPENDED, ONBOARDING, MAIN }

/** Where the signed-in session stands in the device check (`start_device_check`). */
enum class DeviceGate { CHECKING, CODE_REQUIRED, VERIFIED }

/** Pure routing rules, kept separate from [SessionStore] so they can be unit tested. */
object RouteGate {
    /**
     * @param approvedBubbleCount null until the signed-in user's memberships have loaded.
     * @param recoveringPassword the session came from a reset code and still needs its new password.
     * @param suspended the account is suspended or banned (signed in), or sign-in answered `user_banned` (signed out).
     */
    fun resolve(
        isRestoringSession: Boolean,
        isSignedIn: Boolean,
        approvedBubbleCount: Int?,
        deviceGate: DeviceGate = DeviceGate.VERIFIED,
        needsAgeConfirmation: Boolean = false,
        recoveringPassword: Boolean = false,
        suspended: Boolean = false,
    ): AppRoute = when {
        isRestoringSession -> AppRoute.LAUNCHING
        !isSignedIn -> if (suspended) AppRoute.SUSPENDED else AppRoute.AUTH
        recoveringPassword -> AppRoute.RESET_PASSWORD
        // Unverified sessions never reach the bubble screens.
        deviceGate == DeviceGate.CHECKING -> AppRoute.LAUNCHING
        deviceGate == DeviceGate.CODE_REQUIRED -> AppRoute.DEVICE_CODE
        suspended -> AppRoute.SUSPENDED
        needsAgeConfirmation -> AppRoute.AGE_CONFIRMATION
        approvedBubbleCount == null -> AppRoute.LAUNCHING
        approvedBubbleCount == 0 -> AppRoute.ONBOARDING
        else -> AppRoute.MAIN
    }

    /** Keeps the stored bubble if still approved, else the first approved bubble. */
    fun pickCurrentBubble(stored: String?, approved: List<Bubble>): Bubble? =
        approved.firstOrNull { it.id == stored } ?: approved.firstOrNull()

    /** Auto-send a code on entering the code screen, unless one went out less than [cooldownMs] ago (§8.2). */
    fun shouldAutoSend(lastSentAtMs: Long?, nowMs: Long, cooldownMs: Long = CODE_COOLDOWN_MS): Boolean =
        lastSentAtMs == null || nowMs - lastSentAtMs >= cooldownMs

    /** Seconds left before "Resend code" is enabled again. */
    fun resendSecondsLeft(lastSentAtMs: Long?, nowMs: Long, cooldownMs: Long = CODE_COOLDOWN_MS): Int =
        if (lastSentAtMs == null) 0 else ((cooldownMs - (nowMs - lastSentAtMs) + 999) / 1000).toInt().coerceAtLeast(0)

    const val CODE_COOLDOWN_MS = 60_000L
}
