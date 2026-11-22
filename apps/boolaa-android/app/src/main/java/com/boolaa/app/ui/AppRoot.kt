package com.boolaa.app.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.togetherWith
import com.boolaa.app.ui.auth.Wordmark
import com.boolaa.app.ui.components.BoolaaLogo
import com.boolaa.app.ui.components.BubbleBackdrop
import com.boolaa.app.ui.theme.Motion
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.boolaa.app.AppContainer
import com.boolaa.app.DebugHooks
import com.boolaa.app.state.AppRoute
import com.boolaa.app.ui.auth.AuthScreen
import com.boolaa.app.ui.onboarding.OnboardingScreen
import com.boolaa.app.ui.shell.MainShell
import com.boolaa.app.ui.theme.BoolaaTheme

val LocalAppContainer = staticCompositionLocalOf<AppContainer> { error("AppContainer not provided") }

/** Routing gate (spec §2): Auth, Onboarding or Main, decided by [com.boolaa.app.state.RouteGate]. */
@Composable
fun AppRoot(debugHooks: DebugHooks = DebugHooks()) {
    val session = LocalAppContainer.current.session
    val state by session.state.collectAsStateWithLifecycle()

    LaunchedEffect(debugHooks) {
        if (debugHooks.signOut) session.signOut()
        val login = debugHooks.autoLogin
        if (login != null && session.state.value.email != login) {
            runCatching { session.signIn(login, debugHooks.password) }
        }
    }
    LaunchedEffect(state.bubbles, debugHooks.bubble) {
        val wanted = debugHooks.bubble ?: return@LaunchedEffect
        state.bubbles.firstOrNull { it.name == wanted }?.let { if (state.storedBubbleId != it.id) session.selectBubble(it.id) }
    }

    Surface(color = BoolaaTheme.colors.background, modifier = Modifier.fillMaxSize()) {
        // Route change: the new screen fades in from scale 0.94 (gentle), the old one fades out.
        AnimatedContent(
            targetState = state.route,
            transitionSpec = {
                (fadeIn(Motion.gentle()) + scaleIn(Motion.gentle(), initialScale = 0.94f)) togetherWith fadeOut(Motion.fade())
            },
        ) { route ->
            when (route) {
                AppRoute.LAUNCHING -> Splash()
                AppRoute.AUTH -> AuthScreen()
                AppRoute.ONBOARDING -> OnboardingScreen()
                AppRoute.MAIN -> MainShell(initialTab = debugHooks.tab, initialOpen = debugHooks.open)
            }
        }
    }
}

@Composable
private fun Splash() {
    Box(Modifier.fillMaxSize().testTag("splash"), contentAlignment = Alignment.Center) {
        BubbleBackdrop()
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            BoolaaLogo(92.dp)
            Wordmark(Modifier.padding(top = 10.dp))
        }
    }
}
