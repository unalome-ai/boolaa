package com.boolaa.app

import android.content.Intent

/**
 * DEBUG-only launch extras for automation and screenshots (ignored in release builds), e.g.
 * `adb shell am start -n com.boolaa.app/.MainActivity --es autoLogin alice@boolaa.test --es bubble "Climbing Crew" --es tab settings`
 * tab: home|events|food|marketplace|settings, open: chat|links|profile|addBubble, signOut: true.
 * simulateOffline: true pretends there is no network (every request fails at once; offline banner, cached screens).
 * deviceId: the device id for this process. autoLogin defaults it to the seeded `boolaa-test-device`, which the local
 * seed trusts for alice, bob and carol, so QA logins skip the emailed device code.
 */
data class DebugHooks(
    val autoLogin: String? = null,
    val password: String = "password123",
    val bubble: String? = null,
    val tab: String? = null,
    val open: String? = null,
    val signOut: Boolean = false,
    val deviceId: String? = null,
    val simulateOffline: Boolean = false,
    /** Screenshot aid: `going`, `firstEvent`, `firstPost`, `firstItem` or `joined` shows that cheer toast once (§8.4). */
    val cheer: String? = null,
) {
    companion object {
        /** Pre-trusted for the seeded users by supabase/seed.sql (local only). */
        const val SEEDED_TEST_DEVICE = "boolaa-test-device"

        fun from(intent: Intent?): DebugHooks {
            if (!BuildConfig.DEBUG || intent == null) return DebugHooks()
            val autoLogin = intent.getStringExtra("autoLogin")
            return DebugHooks(
                autoLogin = autoLogin,
                deviceId = intent.getStringExtra("deviceId") ?: autoLogin?.let { SEEDED_TEST_DEVICE },
                password = intent.getStringExtra("password") ?: "password123",
                bubble = intent.getStringExtra("bubble"),
                tab = intent.getStringExtra("tab"),
                open = intent.getStringExtra("open"),
                signOut = intent.getStringExtra("signOut") == "true" || intent.getBooleanExtra("signOut", false),
                simulateOffline = intent.getStringExtra("simulateOffline") == "true" || intent.getBooleanExtra("simulateOffline", false),
                cheer = intent.getStringExtra("cheer"),
            )
        }
    }
}
