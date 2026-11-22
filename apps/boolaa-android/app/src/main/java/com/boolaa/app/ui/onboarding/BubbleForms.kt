package com.boolaa.app.ui.onboarding

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.boolaa.app.AppContainer
import com.boolaa.app.R
import com.boolaa.app.model.JoinRequest
import com.boolaa.app.ui.BaseViewModel
import com.boolaa.app.ui.components.BoolaaIcons
import com.boolaa.app.ui.components.BoolaaTextField
import com.boolaa.app.ui.components.BubbleOrb
import com.boolaa.app.ui.components.PrimaryButton
import com.boolaa.app.ui.components.RollingCount
import com.boolaa.app.ui.components.SegmentedPill
import com.boolaa.app.ui.components.boolaaCard
import com.boolaa.app.ui.components.clickableRipple
import com.boolaa.app.ui.components.popIn
import com.boolaa.app.ui.theme.BoolaaTheme
import com.boolaa.app.ui.theme.Hue
import com.boolaa.app.ui.theme.Radius
import com.boolaa.app.ui.theme.Type
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
    SegmentedPill(
        options = listOf(
            BubbleFormMode.JOIN to stringResource(R.string.join_a_bubble),
            BubbleFormMode.CREATE to stringResource(R.string.create_a_bubble),
        ),
        selected = mode, onSelect = onChange,
        tagFor = { if (it == BubbleFormMode.JOIN) "mode-join" else "mode-create" },
    )
}

@Composable
fun JoinBubbleForm(vm: BubbleFormsViewModel) {
    var code by rememberSaveable { mutableStateOf("") }
    val busy by vm.busy.collectAsStateWithLifecycle()
    val requested by vm.requested.collectAsStateWithLifecycle()
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(R.string.join_hint), style = Type.subheadline, color = BoolaaTheme.colors.textSecondary)
        BoolaaTextField(code, { code = it.uppercase() }, stringResource(R.string.invite_code), Modifier.testTag("invite-code-input"))
        requested?.let { r ->
            // Success is mint: an inline banner that pops in.
            Text(
                stringResource(R.string.join_request_sent, r.bubble?.name ?: stringResource(R.string.the_bubble)),
                color = Hue.mint.text, style = Type.subheadline,
                modifier = Modifier.fillMaxWidth().popIn().clip(RoundedCornerShape(Radius.field)).background(Hue.mint.wash).padding(12.dp),
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
    val c = BoolaaTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        BoolaaTextField(name, { name = it.take(60) }, stringResource(R.string.bubble_name), Modifier.testTag("bubble-name-input"))
        BoolaaTextField(description, { description = it }, stringResource(R.string.description), singleLine = false, minLines = 2)
        // Stepper-style shell (field fill, radius 16) around the platform slider; the value rolls in grape.
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(Radius.field)).background(c.field).padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.max_size), style = Type.body, color = c.textPrimary)
                Spacer(Modifier.weight(1f))
                RollingCount(maxSize) { Text(pluralStringResource(R.plurals.members_count, it, it), color = Hue.grape.text, style = Type.headline) }
            }
            Slider(
                value = size, onValueChange = { size = it }, valueRange = 2f..150f,
                colors = SliderDefaults.colors(thumbColor = Hue.grape.fill, activeTrackColor = Hue.grape.fill, inactiveTrackColor = Hue.grape.wash),
            )
        }
        PrimaryButton(stringResource(R.string.create_bubble), onClick = { vm.create(name, description, maxSize) },
            enabled = name.isNotBlank(), loading = busy, modifier = Modifier.testTag("create-submit"))
    }
}

/** The caller's pending requests, each with its bubble's orb, approvals so far and a cancel button. */
@Composable
fun PendingRequestsList(requests: List<JoinRequest>, onCancel: (JoinRequest) -> Unit) {
    val c = BoolaaTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        requests.forEachIndexed { index, r ->
            val hue = Hue.forId(r.bubbleId)
            Row(Modifier.popIn(index).boolaaCard().testTag("pending-request"), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) {
                    BubbleOrb(hue, Modifier.matchParentSize())
                    Icon(BoolaaIcons.Pending, contentDescription = null, tint = hue.onFill, modifier = Modifier.size(22.dp))
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(r.bubble?.name ?: stringResource(R.string.the_bubble), style = Type.headline, color = c.textPrimary)
                    Text(
                        pluralStringResource(R.plurals.approvals_so_far, r.approverIds.size, r.approverIds.size),
                        style = Type.subheadline, color = c.textSecondary,
                    )
                }
                Box(
                    Modifier.padding(start = 8.dp).heightIn(min = 44.dp).clip(CircleShape)
                        .background(c.dangerText.copy(alpha = if (c.isDark) 0.16f else 0.10f))
                        .clickableRipple(role = Role.Button) { onCancel(r) }.testTag("cancel-request")
                        .padding(horizontal = 14.dp, vertical = 8.dp),
                    contentAlignment = Alignment.Center,
                ) { Text(stringResource(R.string.cancel_request), color = c.dangerText, style = Type.chip, maxLines = 1) }
            }
        }
    }
}
