package com.boolaa.app

import android.content.Intent
import android.os.Bundle
import android.util.Log
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.runtime.CompositionLocalProvider
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
        handleAuthDeeplink(intent)
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
        handleAuthDeeplink(intent)
    }

    override fun onStart() {
        super.onStart()
        // Every return to the app re-checks the device, so a device revoked elsewhere asks for its code again.
        container.session.recheckDevice()
    }

    /** `ro.boolaa.app://auth/callback?code=...` from the Apple Custom Tab or an email link (PKCE exchange). */
    private fun handleAuthDeeplink(intent: Intent?) {
        if (intent?.data?.scheme != com.boolaa.app.core.Backend.AUTH_SCHEME) return
        container.api.client.handleDeeplinks(intent, onSessionSuccess = {}, onError = { Log.w("Boolaa", "auth deep link failed", it) })
    }
}
