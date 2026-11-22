package com.boolaa.app

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.runtime.CompositionLocalProvider
import com.boolaa.app.ui.AppRoot
import com.boolaa.app.ui.LocalAppContainer
import com.boolaa.app.ui.theme.BoolaaTheme

/** Single activity. AppCompatActivity so AppCompatDelegate.setApplicationLocales works below API 33. */
class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val container = (application as BoolaaApplication).container
        val hooks = DebugHooks.from(intent)
        setContent {
            CompositionLocalProvider(LocalAppContainer provides container) {
                BoolaaTheme {
                    AppRoot(debugHooks = hooks)
                }
            }
        }
    }
}
