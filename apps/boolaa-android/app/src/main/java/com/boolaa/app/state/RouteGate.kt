package com.boolaa.app.state

import com.boolaa.app.model.Bubble

/** Top-level destinations decided by the routing gate (spec §2). */
enum class AppRoute { LAUNCHING, AUTH, ONBOARDING, MAIN }

/** Pure routing rules, kept separate from [SessionStore] so they can be unit tested. */
object RouteGate {
    /**
     * @param approvedBubbleCount null until the signed-in user's memberships have loaded.
     */
    fun resolve(isRestoringSession: Boolean, isSignedIn: Boolean, approvedBubbleCount: Int?): AppRoute = when {
        isRestoringSession -> AppRoute.LAUNCHING
        !isSignedIn -> AppRoute.AUTH
        approvedBubbleCount == null -> AppRoute.LAUNCHING
        approvedBubbleCount == 0 -> AppRoute.ONBOARDING
        else -> AppRoute.MAIN
    }

    /** Keeps the stored bubble if still approved, else the first approved bubble. */
    fun pickCurrentBubble(stored: String?, approved: List<Bubble>): Bubble? =
        approved.firstOrNull { it.id == stored } ?: approved.firstOrNull()
}
