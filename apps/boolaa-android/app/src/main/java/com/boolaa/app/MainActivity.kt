package com.boolaa.app

import android.content.Intent
import android.os.Bundle
import android.util.Log
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.runtime.CompositionLocalProvider
import com.boolaa.app.core.InviteLink
import com.boolaa.app.core.PushPayload
import com.boolaa.app.core.UserBanned
import com.boolaa.app.core.UserFacingError
import com.boolaa.app.ui.AppRoot
import com.boolaa.app.ui.LocalAppContainer
import com.boolaa.app.ui.theme.BoolaaTheme
import io.github.jan.supabase.auth.handleDeeplinks

/** Single activity. AppCompatActivity so AppCompatDelegate.setApplicationLocales works below API 33. */
class MainActivity : AppCompatActivity() {
    private val container get() = (application as BoolaaApplication).container

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val hooks = DebugHooks.from(intent)
        hooks.deviceId?.let { container.device.overrideForTesting(it) }
        if (hooks.simulateOffline) container.connectivity.setSimulatedOffline(true)
        // Channel names follow the app language (this context has it, also below API 33).
        container.push.createChannels(this)
        // A recreated activity (rotation, language change) gets the same intent again: route a tapped push only once.
        handleDeeplink(intent, pushAllowed = savedInstanceState == null)
        setContent {
            CompositionLocalProvider(LocalAppContainer provides container) {
                BoolaaTheme {
                    AppRoot(debugHooks = hooks)
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleDeeplink(intent)
    }

    private var startedOnce = false

    override fun onStart() {
        super.onStart()
        // Back in front: visible screens refetch, live screens resubscribe, the outbox flushes (not on the first start).
        if (startedOnce) container.connectivity.foreground()
        startedOnce = true
        // Every return to the app re-checks the device, so a device revoked elsewhere asks for its code again.
        container.session.recheckDevice()
        // Unread chat badges are refreshed on every return to the foreground.
        container.unread.refresh()
        // Permission may have changed in system settings; registers the FCM token on every start (push §8.2).
        container.push.refresh()
    }

    /** A tapped push (its `data` keys are the intent extras), an invite link (App Link or custom scheme), else an auth callback. */
    private fun handleDeeplink(intent: Intent?, pushAllowed: Boolean = true) {
        PushPayload.from { key -> intent?.getStringExtra(key) }?.let { payload ->
            if (pushAllowed) container.push.open(payload)
            listOf(PushPayload.KEY_TYPE, PushPayload.KEY_BUBBLE, PushPayload.KEY_TARGET).forEach { intent?.removeExtra(it) }
            return
        }
        if (intent?.action == Intent.ACTION_VIEW) {
            InviteLink.parse(intent.dataString)?.let { container.session.openInvite(it); return }
        }
        handleAuthDeeplink(intent)
    }

    /** `ro.boolaa.app://auth/callback?code=...` from the Apple Custom Tab or an email link (PKCE exchange). */
    private fun handleAuthDeeplink(intent: Intent?) {
        if (intent?.data?.scheme != com.boolaa.app.core.Backend.AUTH_SCHEME) return
        // A suspended or banned account comes back with error_code=user_banned: the "can't sign in" screen.
        if (UserBanned.inCallback(intent.dataString)) { container.session.markSignInBlocked(); return }
        container.api.client.handleDeeplinks(intent, onSessionSuccess = {}, onError = {
            Log.w("Boolaa", "auth deep link failed", it)
            if (UserFacingError.classify(it) == UserFacingError.USER_BANNED) container.session.markSignInBlocked()
        })
    }
}
