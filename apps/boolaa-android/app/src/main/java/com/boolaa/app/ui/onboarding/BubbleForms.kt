package com.boolaa.app.ui.onboarding

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.HourglassTop
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.boolaa.app.AppContainer
import com.boolaa.app.R
import com.boolaa.app.model.JoinRequest
import com.boolaa.app.ui.BaseViewModel
import com.boolaa.app.ui.components.BoolaaTextField
import com.boolaa.app.ui.components.PrimaryButton
import com.boolaa.app.ui.components.boolaaCard
import com.boolaa.app.ui.theme.Brand
import com.boolaa.app.ui.theme.BoolaaTheme
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlin.math.roundToInt

enum class BubbleFormMode { JOIN, CREATE }

/** Create / join / cancel actions shared by Onboarding and the "+ New" sheet. */
class BubbleFormsViewModel(private val container: AppContainer) : BaseViewModel() {
    private val _requested = MutableStateFlow<JoinRequest?>(null)
    val requested = _requested.asStateFlow()
    private val _created = MutableStateFlow(0)
    /** Increments after each successful create, so a sheet can close itself. */
    val created = _created.asStateFlow()

    fun join(code: String) = launchCatching {
        _requested.value = container.session.requestToJoin(code)
    }

    fun create(name: String, description: String, maxSize: Int) = launchCatching {
        container.session.createBubble(name.trim(), description.trim().ifEmpty { null }, maxSize)
        _created.value += 1
    }

    fun cancel(request: JoinRequest) = launchCatching { container.session.cancelRequest(request) }

    fun refresh() = launchCatching(trackBusy = false) { container.session.reload()?.let { throw it } }
}

@Composable
fun ModePicker(mode: BubbleFormMode, onChange: (BubbleFormMode) -> Unit) {
    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
        BubbleFormMode.entries.forEachIndexed { i, m ->
            SegmentedButton(
                selected = mode == m,
                onClick = { onChange(m) },
                shape = SegmentedButtonDefaults.itemShape(i, BubbleFormMode.entries.size),
                colors = SegmentedButtonDefaults.colors(activeContainerColor = Brand.purple, activeContentColor = androidx.compose.ui.graphics.Color.White),
                modifier = Modifier.testTag(if (m == BubbleFormMode.JOIN) "mode-join" else "mode-create"),
            ) { Text(stringResource(if (m == BubbleFormMode.JOIN) R.string.join_a_bubble else R.string.create_a_bubble), maxLines = 1) }
        }
    }
}

@Composable
fun JoinBubbleForm(vm: BubbleFormsViewModel) {
    var code by rememberSaveable { mutableStateOf("") }
    val busy by vm.busy.collectAsStateWithLifecycle()
    val requested by vm.requested.collectAsStateWithLifecycle()
    Column(Modifier.boolaaCard(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(R.string.join_a_bubble), style = MaterialTheme.typography.titleMedium)
        Text(stringResource(R.string.join_hint), style = MaterialTheme.typography.bodyMedium, color = BoolaaTheme.colors.textSecondary)
        BoolaaTextField(code, { code = it.uppercase() }, stringResource(R.string.invite_code), Modifier.testTag("invite-code-input"))
        requested?.let { r ->
            Text(
                stringResource(R.string.join_request_sent, r.bubble?.name ?: stringResource(R.string.the_bubble)),
                color = Brand.purple, style = MaterialTheme.typography.bodyMedium,
            )
        }
        PrimaryButton(stringResource(R.string.request_to_join), onClick = { vm.join(code) }, enabled = code.isNotBlank(), loading = busy,
            modifier = Modifier.testTag("join-submit"))
    }
}

@Composable
fun CreateBubbleForm(vm: BubbleFormsViewModel) {
    var name by rememberSaveable { mutableStateOf("") }
    var description by rememberSaveable { mutableStateOf("") }
    var size by rememberSaveable { mutableFloatStateOf(12f) }
    val busy by vm.busy.collectAsStateWithLifecycle()
    val maxSize = size.roundToInt()
    Column(Modifier.boolaaCard(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(R.string.create_a_bubble), style = MaterialTheme.typography.titleMedium)
        BoolaaTextField(name, { name = it.take(60) }, stringResource(R.string.bubble_name), Modifier.testTag("bubble-name-input"))
        BoolaaTextField(description, { description = it }, stringResource(R.string.description), singleLine = false, minLines = 2)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.max_size), style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.weight(1f))
            Text(pluralStringResource(R.plurals.members_count, maxSize, maxSize), color = Brand.purple, style = MaterialTheme.typography.labelLarge)
        }
        Slider(
            value = size, onValueChange = { size = it }, valueRange = 2f..150f,
            colors = SliderDefaults.colors(thumbColor = Brand.purple, activeTrackColor = Brand.purple),
        )
        PrimaryButton(stringResource(R.string.create_bubble), onClick = { vm.create(name, description, maxSize) },
            enabled = name.isNotBlank(), loading = busy, modifier = Modifier.testTag("create-submit"))
    }
}

/** The caller's pending requests, each with its bubble name, approvals so far and a cancel button. */
@Composable
fun PendingRequestsList(requests: List<JoinRequest>, onCancel: (JoinRequest) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        requests.forEach { r ->
            Row(Modifier.boolaaCard().testTag("pending-request"), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.HourglassTop, contentDescription = null, tint = Brand.purple)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(r.bubble?.name ?: stringResource(R.string.the_bubble), style = MaterialTheme.typography.titleMedium)
                    Text(
                        pluralStringResource(R.plurals.approvals_so_far, r.approverIds.size, r.approverIds.size),
                        style = MaterialTheme.typography.bodyMedium, color = BoolaaTheme.colors.textSecondary,
                    )
                }
                TextButton(onClick = { onCancel(r) }, modifier = Modifier.padding(start = 4.dp).testTag("cancel-request")) {
                    Text(stringResource(R.string.cancel_request), color = Brand.danger)
                }
            }
        }
    }
}
