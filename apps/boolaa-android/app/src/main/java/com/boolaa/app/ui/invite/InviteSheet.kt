package com.boolaa.app.ui.invite

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.boolaa.app.AppContainer
import com.boolaa.app.R
import com.boolaa.app.core.InvitePreview
import com.boolaa.app.ui.BaseViewModel
import com.boolaa.app.ui.ErrorDialogFor
import com.boolaa.app.ui.LocalAppContainer
import com.boolaa.app.ui.components.BoolaaSheet
import com.boolaa.app.ui.components.BubbleOrb
import com.boolaa.app.ui.components.HintCard
import com.boolaa.app.ui.components.PrimaryButton
import com.boolaa.app.ui.components.RemoteImage
import com.boolaa.app.ui.components.SecondaryButton
import com.boolaa.app.ui.components.popIn
import com.boolaa.app.ui.theme.BoolaaTheme
import com.boolaa.app.ui.theme.Hue
import com.boolaa.app.ui.theme.Radius
import com.boolaa.app.ui.theme.Type
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Loading, a preview row, or "no such invite". */
sealed interface InviteState {
    data object Loading : InviteState
    data object Invalid : InviteState
    data class Found(val preview: InvitePreview, val requested: Boolean = false) : InviteState
}

class InviteViewModel(private val container: AppContainer, private val code: String) : BaseViewModel() {
    private val _state = MutableStateFlow<InviteState>(InviteState.Loading)
    val state = _state.asStateFlow()

    init { load() }

    private fun load() = launchCatching(trackBusy = false) {
        _state.value = container.session.invitePreview(code)?.let { InviteState.Found(it) } ?: InviteState.Invalid
    }

    /** request_to_join, then the memberships / pending list reload (Onboarding shows the request). */
    fun requestToJoin() = launchCatching {
        container.session.requestToJoin(code)
        val found = _state.value as? InviteState.Found ?: return@launchCatching
        _state.value = found.copy(requested = true, preview = found.preview.copy(status = "pending"))
    }

    fun openBubble(bubbleId: String) {
        container.session.selectBubble(bubbleId)
        container.session.clearInvite()
    }
}

/**
 * Join preview for an opened invite link (spec "Invite links"): name, logo, member count and the approval rule, then
 * "Request to join". It never joins by itself: the members still vote.
 */
@Composable
fun InviteSheet(code: String) {
    val container = LocalAppContainer.current
    val vm: InviteViewModel = viewModel(key = "invite-$code") { InviteViewModel(container, code) }
    val state by vm.state.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val c = BoolaaTheme.colors
    val dismiss = container.session::clearInvite
    val title = if (state is InviteState.Invalid) stringResource(R.string.invite_invalid_title) else stringResource(R.string.invite_title)

    BoolaaSheet(dismiss, title, tag = "invite-sheet", spacing = 16.dp) {
        when (val s = state) {
            InviteState.Loading -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Hue.grape.fill)
            }
            InviteState.Invalid -> {
                Text(stringResource(R.string.invite_invalid_body), style = Type.body, color = c.textSecondary,
                    modifier = Modifier.testTag("invite-invalid"))
                SecondaryButton(stringResource(R.string.ok), onClick = dismiss)
            }
            is InviteState.Found -> {
                val p = s.preview
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (p.logo != null) RemoteImage(p.logo, Modifier.size(64.dp).clip(CircleShape))
                    else BubbleOrb(Hue.forId(p.bubbleId ?: p.name), Modifier.size(64.dp))
                    Column(Modifier.weight(1f).padding(start = 14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(p.name, style = Type.title2, color = c.textPrimary, modifier = Modifier.testTag("invite-bubble-name"))
                        Text(
                            pluralStringResource(R.plurals.members_of_max, p.maxSize, p.memberCount, p.maxSize),
                            style = Type.caption, color = Hue.grape.text,
                            modifier = Modifier.clip(CircleShape).background(Hue.grape.wash).padding(horizontal = 10.dp, vertical = 4.dp),
                        )
                    }
                }
                when (p.kind) {
                    InvitePreview.Status.OPEN -> {
                        HintCard(stringResource(R.string.invite_approval_note))
                        PrimaryButton(stringResource(R.string.request_to_join), onClick = vm::requestToJoin, loading = busy,
                            modifier = Modifier.testTag("invite-request"))
                    }
                    InvitePreview.Status.PENDING -> {
                        if (s.requested) {
                            Text(stringResource(R.string.invite_request_sent), color = Hue.mint.text, style = Type.headline,
                                modifier = Modifier.fillMaxWidth().popIn().clip(RoundedCornerShape(Radius.field)).background(Hue.mint.wash)
                                    .padding(12.dp).testTag("invite-requested"))
                        }
                        HintCard(stringResource(R.string.invite_pending), Modifier.testTag("invite-pending"))
                        SecondaryButton(stringResource(R.string.ok), onClick = dismiss)
                    }
                    InvitePreview.Status.MEMBER -> {
                        HintCard(stringResource(R.string.invite_member))
                        PrimaryButton(stringResource(R.string.invite_open_bubble), onClick = { p.bubbleId?.let(vm::openBubble) ?: dismiss() },
                            modifier = Modifier.testTag("invite-open"))
                    }
                    InvitePreview.Status.FULL -> {
                        HintCard(stringResource(R.string.error_bubble_full))
                        SecondaryButton(stringResource(R.string.ok), onClick = dismiss)
                    }
                }
            }
        }
        ErrorDialogFor(vm)
    }
}
