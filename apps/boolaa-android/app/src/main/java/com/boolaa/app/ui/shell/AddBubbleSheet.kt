package com.boolaa.app.ui.shell

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.boolaa.app.R
import com.boolaa.app.ui.ErrorDialogFor
import com.boolaa.app.ui.LocalAppContainer
import com.boolaa.app.ui.components.BoolaaSheet
import com.boolaa.app.ui.components.SectionHeader
import com.boolaa.app.ui.onboarding.BubbleFormMode
import com.boolaa.app.ui.onboarding.BubbleFormsViewModel
import com.boolaa.app.ui.onboarding.CreateBubbleForm
import com.boolaa.app.ui.onboarding.JoinBubbleForm
import com.boolaa.app.ui.onboarding.ModePicker
import com.boolaa.app.ui.onboarding.PendingRequestsList

/** "+ New" chip: create another bubble or join one. */
@Composable
fun AddBubbleSheet(onDismiss: () -> Unit) {
    val container = LocalAppContainer.current
    val state by container.session.state.collectAsStateWithLifecycle()
    val vm: BubbleFormsViewModel = viewModel(key = "add-bubble") { BubbleFormsViewModel(container) }
    val created by vm.created.collectAsStateWithLifecycle()
    var mode by rememberSaveable { mutableStateOf(BubbleFormMode.JOIN) }
    val initialCreated = rememberSaveable { created }
    LaunchedEffect(created) { if (created > initialCreated) onDismiss() }

    BoolaaSheet(onDismiss, stringResource(R.string.new_bubble_title), tag = "add-bubble-sheet", spacing = 16.dp) {
        ModePicker(mode) { mode = it }
        when (mode) {
            BubbleFormMode.JOIN -> JoinBubbleForm(vm)
            BubbleFormMode.CREATE -> CreateBubbleForm(vm)
        }
        if (state.pendingRequests.isNotEmpty()) {
            SectionHeader(stringResource(R.string.your_pending_requests))
            PendingRequestsList(state.pendingRequests, onCancel = vm::cancel)
        }
        ErrorDialogFor(vm)
    }
}
