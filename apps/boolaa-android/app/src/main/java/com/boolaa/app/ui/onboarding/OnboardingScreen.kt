package com.boolaa.app.ui.onboarding

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.boolaa.app.R
import com.boolaa.app.ui.ErrorDialogFor
import com.boolaa.app.ui.LocalAppContainer
import com.boolaa.app.ui.components.SectionHeader
import com.boolaa.app.ui.theme.Brand
import com.boolaa.app.ui.theme.BoolaaTheme
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

    // No polling: SessionStore watches the caller's bubble_members/join_requests rows over realtime, so the
    // routing gate moves to Main as soon as the membership row arrives. Pull to refresh stays as a fallback.

    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = { scope.launch { refreshing = true; session.reload(); refreshing = false } },
        modifier = Modifier.fillMaxSize().statusBarsPadding().imePadding().testTag("onboarding-screen"),
    ) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.onboarding_title), style = MaterialTheme.typography.displaySmall, modifier = Modifier.weight(1f))
                TextButton(onClick = { scope.launch { session.signOut() } }, modifier = Modifier.testTag("onboarding-sign-out")) {
                    Text(stringResource(R.string.sign_out), color = Brand.purple)
                }
            }
            Text(stringResource(R.string.onboarding_subtitle), color = BoolaaTheme.colors.textSecondary)

            if (state.pendingRequests.isNotEmpty()) {
                SectionHeader(stringResource(R.string.pending_approval), modifier = Modifier.testTag("pending-approval-title"))
                Text(stringResource(R.string.pending_approval_hint), color = BoolaaTheme.colors.textSecondary, style = MaterialTheme.typography.bodyMedium)
                PendingRequestsList(state.pendingRequests, onCancel = vm::cancel)
                Spacer(Modifier.padding(4.dp))
            }

            ModePicker(mode) { mode = it }
            when (mode) {
                BubbleFormMode.JOIN -> JoinBubbleForm(vm)
                BubbleFormMode.CREATE -> CreateBubbleForm(vm)
            }
        }
    }
    ErrorDialogFor(vm)
}
