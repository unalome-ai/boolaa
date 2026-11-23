package com.boolaa.app.ui.onboarding

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.background
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.boolaa.app.R
import com.boolaa.app.ui.ErrorDialogFor
import com.boolaa.app.ui.LocalAppContainer
import com.boolaa.app.ui.components.BoolaaIcons
import com.boolaa.app.ui.components.BubbleBackdrop
import com.boolaa.app.ui.components.FitText
import com.boolaa.app.ui.components.SectionHeader
import com.boolaa.app.ui.components.boolaaCard
import com.boolaa.app.ui.components.clickableRipple
import com.boolaa.app.ui.components.popIn
import com.boolaa.app.ui.theme.BoolaaTheme
import com.boolaa.app.ui.theme.Hue
import com.boolaa.app.ui.theme.Motion
import com.boolaa.app.ui.theme.Radius
import com.boolaa.app.ui.theme.Type
import kotlinx.coroutines.launch

/** Signed in with no approved bubbles (spec §3): create, join, and the pending approval list. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OnboardingScreen() {
    val container = LocalAppContainer.current
    val session = container.session
    val state by session.state.collectAsStateWithLifecycle()
    val vm: BubbleFormsViewModel = viewModel(key = "onboarding") { BubbleFormsViewModel(container) }
    val scope = rememberCoroutineScope()
    var mode by rememberSaveable { mutableStateOf(BubbleFormMode.JOIN) }
    var refreshing by rememberSaveable { mutableStateOf(false) }
    val c = BoolaaTheme.colors

    // No polling: SessionStore watches the caller's bubble_members/join_requests rows over realtime, so the
    // routing gate moves to Main as soon as the membership row arrives. Pull to refresh stays as a fallback.

    Box(Modifier.fillMaxSize()) {
        BubbleBackdrop(intensity = 0.8f)
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = { scope.launch { refreshing = true; session.reload(); refreshing = false } },
            modifier = Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding().testTag("onboarding-screen"),
        ) {
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Row(Modifier.popIn(0), verticalAlignment = Alignment.CenterVertically) {
                    com.boolaa.app.ui.components.DisplayTitle(stringResource(R.string.onboarding_title), modifier = Modifier.weight(1f))
                    Row(
                        Modifier.padding(start = 12.dp).heightIn(min = 48.dp).clip(CircleShape).background(c.card.copy(alpha = 0.8f))
                            .clickableRipple(role = Role.Button) { scope.launch { session.signOut() } }.testTag("onboarding-sign-out")
                            .padding(horizontal = 14.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Icon(BoolaaIcons.SignOut, contentDescription = null, tint = Hue.grape.text, modifier = Modifier.size(18.dp))
                        Text(stringResource(R.string.sign_out), color = Hue.grape.text, style = Type.chip, maxLines = 1)
                    }
                }
                Text(stringResource(R.string.onboarding_subtitle), color = c.textSecondary, style = Type.body, modifier = Modifier.popIn(1))

                if (state.pendingRequests.isNotEmpty()) {
                    SectionHeader(stringResource(R.string.pending_approval), modifier = Modifier.testTag("pending-approval-title"))
                    Text(stringResource(R.string.pending_approval_hint), color = c.textSecondary, style = Type.subheadline)
                    PendingRequestsList(state.pendingRequests, onCancel = vm::cancel)
                }

                Column(
                    Modifier.padding(top = 6.dp).popIn(2)
                        .boolaaCard(18.dp, Radius.hero, c.card.copy(alpha = if (c.isDark) 0.78f else 0.72f))
                        .animateContentSize(Motion.gentle()),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    ModePicker(mode) { mode = it }
                    AnimatedContent(mode, transitionSpec = { fadeIn(Motion.fade()) togetherWith fadeOut(Motion.fade()) }) { m ->
                        when (m) {
                            BubbleFormMode.JOIN -> JoinBubbleForm(vm)
                            BubbleFormMode.CREATE -> CreateBubbleForm(vm)
                        }
                    }
                }
            }
        }
    }
    ErrorDialogFor(vm)
}
