package com.boolaa.app.ui.safety

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.boolaa.app.AppContainer
import com.boolaa.app.R
import com.boolaa.app.model.ReportReason
import com.boolaa.app.model.ReportTarget
import com.boolaa.app.ui.BaseViewModel
import com.boolaa.app.ui.ErrorDialogFor
import com.boolaa.app.ui.LocalAppContainer
import com.boolaa.app.ui.components.BoolaaTextField
import com.boolaa.app.ui.components.PrimaryButton
import com.boolaa.app.ui.components.SecondaryButton
import com.boolaa.app.ui.components.boolaaCard
import com.boolaa.app.ui.theme.Brand
import com.boolaa.app.ui.theme.BoolaaTheme
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

@StringRes
fun ReportReason.label(): Int = when (this) {
    ReportReason.SPAM -> R.string.report_reason_spam
    ReportReason.HARASSMENT -> R.string.report_reason_harassment
    ReportReason.HATE -> R.string.report_reason_hate
    ReportReason.SEXUAL -> R.string.report_reason_sexual
    ReportReason.VIOLENCE -> R.string.report_reason_violence
    ReportReason.SELF_HARM -> R.string.report_reason_self_harm
    ReportReason.OTHER -> R.string.report_reason_other
}

class ReportViewModel(private val container: AppContainer) : BaseViewModel() {
    private val _sent = MutableStateFlow(false)
    val sent = _sent.asStateFlow()

    fun submit(target: ReportTarget, reason: ReportReason, details: String) = launchCatching {
        container.api.report(target.type, target.id, reason, details.trim().take(1000))
        _sent.value = true
    }

    fun block(userId: String, onDone: () -> Unit) = launchCatching(onSuccess = onDone) { container.session.block(userId) }
}

/** Report flow (App Store 1.2): 7 reasons + optional details, then "Also block <name>?". */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReportSheet(target: ReportTarget, onDismiss: () -> Unit) {
    val container = LocalAppContainer.current
    val state by container.session.state.collectAsStateWithLifecycle()
    val vm: ReportViewModel = viewModel(key = "report-${target.type}-${target.id}") { ReportViewModel(container) }
    val sent by vm.sent.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    var reason by rememberSaveable { mutableStateOf<ReportReason?>(null) }
    var details by rememberSaveable { mutableStateOf("") }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = BoolaaTheme.colors.background) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).imePadding().padding(horizontal = 20.dp).padding(bottom = 32.dp)
                .testTag("report-sheet"),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (!sent) {
                Text(stringResource(R.string.report_title), style = MaterialTheme.typography.titleLarge)
                Text(stringResource(R.string.report_subtitle, target.authorName), color = BoolaaTheme.colors.textSecondary)
                Column(Modifier.boolaaCard(4.dp).selectableGroup()) {
                    ReportReason.entries.forEach { r ->
                        Row(
                            Modifier.fillMaxWidth().selectable(selected = reason == r, onClick = { reason = r }, role = Role.RadioButton)
                                .padding(horizontal = 8.dp, vertical = 4.dp).testTag("reason-${r.wire}"),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(selected = reason == r, onClick = null, colors = RadioButtonDefaults.colors(selectedColor = Brand.purple))
                            Text(stringResource(r.label()), modifier = Modifier.padding(start = 8.dp))
                        }
                    }
                }
                BoolaaTextField(details, { details = it.take(1000) }, stringResource(R.string.report_details), singleLine = false, minLines = 2)
                PrimaryButton(stringResource(R.string.report_submit), onClick = { reason?.let { vm.submit(target, it, details) } },
                    enabled = reason != null, loading = busy, modifier = Modifier.testTag("report-submit"))
            } else {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.CheckCircle, contentDescription = null, tint = Brand.purple)
                    Text(stringResource(R.string.report_sent), style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 10.dp))
                }
                if (target.authorId != state.userId && target.authorId !in state.blockedIds) {
                    Column(Modifier.boolaaCard(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(stringResource(R.string.also_block, target.authorName), style = MaterialTheme.typography.titleMedium)
                        Text(stringResource(R.string.block_explainer), color = BoolaaTheme.colors.textSecondary)
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            SecondaryButton(stringResource(R.string.not_now), onClick = onDismiss, modifier = Modifier.weight(1f))
                            PrimaryButton(stringResource(R.string.block), onClick = { vm.block(target.authorId, onDismiss) }, loading = busy,
                                modifier = Modifier.weight(1f).testTag("report-block"))
                        }
                    }
                } else {
                    PrimaryButton(stringResource(R.string.done), onClick = onDismiss)
                }
            }
        }
        ErrorDialogFor(vm)
    }
}
