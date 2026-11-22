package com.boolaa.app

import android.content.Intent

/**
 * DEBUG-only launch extras for automation and screenshots (ignored in release builds), e.g.
 * `adb shell am start -n com.boolaa.app/.MainActivity --es autoLogin alice@boolaa.test --es bubble "Climbing Crew" --es tab settings`
 * tab: home|events|food|marketplace|settings, open: chat|links|profile|addBubble, signOut: true.
 */
data class DebugHooks(
    val autoLogin: String? = null,
    val password: String = "password123",
    val bubble: String? = null,
    val tab: String? = null,
    val open: String? = null,
    val signOut: Boolean = false,
) {
    companion object {
        fun from(intent: Intent?): DebugHooks {
            if (!BuildConfig.DEBUG || intent == null) return DebugHooks()
            return DebugHooks(
                autoLogin = intent.getStringExtra("autoLogin"),
                password = intent.getStringExtra("password") ?: "password123",
                bubble = intent.getStringExtra("bubble"),
                tab = intent.getStringExtra("tab"),
                open = intent.getStringExtra("open"),
                signOut = intent.getStringExtra("signOut") == "true" || intent.getBooleanExtra("signOut", false),
            )
        }
    }
}
