package com.boolaa.app.ui.shell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
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
import com.boolaa.app.ui.onboarding.BubbleFormMode
import com.boolaa.app.ui.onboarding.BubbleFormsViewModel
import com.boolaa.app.ui.onboarding.CreateBubbleForm
import com.boolaa.app.ui.onboarding.JoinBubbleForm
import com.boolaa.app.ui.onboarding.ModePicker
import com.boolaa.app.ui.onboarding.PendingRequestsList
import com.boolaa.app.ui.theme.BoolaaTheme

/** "+ New" chip: create another bubble or join one. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddBubbleSheet(onDismiss: () -> Unit) {
    val container = LocalAppContainer.current
    val state by container.session.state.collectAsStateWithLifecycle()
    val vm: BubbleFormsViewModel = viewModel(key = "add-bubble") { BubbleFormsViewModel(container) }
    val created by vm.created.collectAsStateWithLifecycle()
    var mode by rememberSaveable { mutableStateOf(BubbleFormMode.JOIN) }
    val initialCreated = rememberSaveable { created }
    LaunchedEffect(created) { if (created > initialCreated) onDismiss() }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = BoolaaTheme.colors.background,
    ) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).imePadding().padding(horizontal = 20.dp).padding(bottom = 32.dp)
                .testTag("add-bubble-sheet"),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(stringResource(R.string.new_bubble_title), style = MaterialTheme.typography.titleLarge)
            ModePicker(mode) { mode = it }
            when (mode) {
                BubbleFormMode.JOIN -> JoinBubbleForm(vm)
                BubbleFormMode.CREATE -> CreateBubbleForm(vm)
            }
            if (state.pendingRequests.isNotEmpty()) {
                SectionHeader(stringResource(R.string.your_pending_requests))
                PendingRequestsList(state.pendingRequests, onCancel = vm::cancel)
            }
        }
        ErrorDialogFor(vm)
    }
}
