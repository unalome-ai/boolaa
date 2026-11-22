package com.boolaa.app.ui.settings

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.PersonRemove
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.boolaa.app.AppContainer
import com.boolaa.app.R
import com.boolaa.app.model.Bubble
import com.boolaa.app.model.BubbleMember
import com.boolaa.app.model.JoinRequest
import com.boolaa.app.model.MemberRole
import com.boolaa.app.model.ReportTarget
import com.boolaa.app.model.ReportTargetType
import com.boolaa.app.ui.safety.MemberSafetyMenu
import com.boolaa.app.ui.safety.ReportSheet
import com.boolaa.app.ui.BaseViewModel
import com.boolaa.app.ui.ErrorDialogFor
import com.boolaa.app.ui.LocalAppContainer
import com.boolaa.app.ui.components.Avatar
import com.boolaa.app.ui.components.BoolaaTextField
import com.boolaa.app.ui.components.CircleIconButton
import com.boolaa.app.ui.components.ConfirmDialog
import com.boolaa.app.ui.components.PrimaryButton
import com.boolaa.app.ui.components.SecondaryButton
import com.boolaa.app.ui.components.SectionHeader
import com.boolaa.app.ui.components.StatusBadge
import com.boolaa.app.ui.components.boolaaCard
import com.boolaa.app.ui.components.clickableRipple
import com.boolaa.app.ui.components.displayName
import com.boolaa.app.ui.shell.ShellNavigator
import com.boolaa.app.ui.theme.Brand
import com.boolaa.app.ui.theme.BoolaaTheme
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import androidx.lifecycle.viewModelScope
import com.boolaa.app.core.LiveTables
import com.boolaa.app.core.TableWatch

class SettingsViewModel(private val container: AppContainer, private val bubbleId: String) : BaseViewModel() {
    private val _members = MutableStateFlow<List<BubbleMember>>(emptyList())
    val members = _members.asStateFlow()
    private val _requests = MutableStateFlow<List<JoinRequest>?>(null)
    val requests = _requests.asStateFlow()

    /** Live pending-requests and members lists (bubble_members / join_requests are in the realtime publication). */
    private val live = LiveTables.open(
        container.api.client, viewModelScope, "settings:$bubbleId",
        listOf(TableWatch("bubble_members", "bubble_id", bubbleId), TableWatch("join_requests", "bubble_id", bubbleId)),
    ) { table, action ->
        val relevant = when (table) {
            "bubble_members" -> LiveTables.oldValue(action, "bubble_id")?.let { it == bubbleId } ?: true
            else -> LiveTables.oldValue(action, "id")?.let { id -> _requests.value.orEmpty().any { it.id == id } } ?: true
        }
        if (relevant) load()
    }

    init { load() }

    override fun onCleared() {
        container.appScope.launch { live.close() }
    }

    fun load(refresh: Boolean = false) = launchCatching(trackBusy = refresh) {
        coroutineScope {
            val m = async { container.api.members(bubbleId) }
            val r = async { container.api.joinRequests(bubbleId) }
            _members.value = m.await()
            _requests.value = r.await()
        }
    }

    fun approve(r: JoinRequest) = launchCatching(trackBusy = false) {
        if (container.api.approveJoinRequest(r.id)) container.session.reload()
        load()
    }

    fun block(userId: String) = launchCatching(trackBusy = false) { container.session.block(userId) }
    fun unblock(userId: String) = launchCatching(trackBusy = false) { container.session.unblock(userId) }

    fun remove(member: BubbleMember) = launchCatching(trackBusy = false) {
        container.api.removeMember(bubbleId, member.userId)
        load()
    }

    fun reject(r: JoinRequest) = launchCatching(trackBusy = false) {
        container.api.rejectJoinRequest(r.id)
        load()
    }

    fun saveInfo(name: String, description: String, onDone: () -> Unit) = launchCatching(onSuccess = onDone) {
        container.session.updateCurrentBubble(name.trim(), description.trim().ifEmpty { null })
    }

    fun leave() = launchCatching { container.session.leaveCurrentBubble() }
}

/** Settings for the current bubble (spec §11). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(navigator: ShellNavigator) {
    val container = LocalAppContainer.current
    val state by container.session.state.collectAsStateWithLifecycle()
    val bubble = state.currentBubble ?: return
    val me = state.userId ?: return
    val vm: SettingsViewModel = viewModel(key = "settings-${bubble.id}") { SettingsViewModel(container, bubble.id) }
    val members by vm.members.collectAsStateWithLifecycle()
    val requests by vm.requests.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    var confirmLeave by remember { mutableStateOf(false) }
    var removing by remember { mutableStateOf<BubbleMember?>(null) }
    var reporting by remember { mutableStateOf<ReportTarget?>(null) }
    var blocking by remember { mutableStateOf<BubbleMember?>(null) }
    val isOwner = state.currentRole == MemberRole.OWNER

    PullToRefreshBox(isRefreshing = busy, onRefresh = { vm.load(refresh = true) }, modifier = Modifier.fillMaxSize().testTag("settings-screen")) {
        LazyColumn(
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = Brand.tabBarClearance),
            verticalArrangement = Arrangement.spacedBy(14.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            item { InfoCard(bubble, members.size, isOwner, vm) }
            item { InviteCard(bubble) }
            item {
                Row(
                    Modifier.clip(RoundedCornerShape(Brand.cardRadius)).clickableRipple(navigator::openLinks).boolaaCard().testTag("settings-links"),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Default.Link, contentDescription = null, tint = Brand.purple)
                    Text(stringResource(R.string.shared_links), style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 10.dp).weight(1f))
                    Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = BoolaaTheme.colors.textSecondary)
                }
            }
            item { SectionHeader(stringResource(R.string.members), members.size) }
            item {
                Column(Modifier.boolaaCard().testTag("members-list")) {
                    members.forEachIndexed { i, m ->
                        Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Avatar(m.user, 36.dp)
                            Text(displayName(m.user), style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, modifier = Modifier.padding(start = 12.dp))
                            if (m.userId == me) Text(stringResource(R.string.you_suffix), color = BoolaaTheme.colors.textSecondary, modifier = Modifier.padding(start = 4.dp))
                            Spacer(Modifier.weight(1f))
                            val blocked = m.userId in state.blockedIds
                            if (blocked) StatusBadge(stringResource(R.string.blocked_badge), color = Brand.danger, modifier = Modifier.padding(end = 6.dp))
                            if (m.role == MemberRole.OWNER) StatusBadge(stringResource(R.string.owner))
                            else if (isOwner && m.userId != me) {
                                CircleIconButton(Icons.Default.PersonRemove, stringResource(R.string.remove_member), onClick = { removing = m },
                                    tint = Brand.danger, size = 34.dp, modifier = Modifier.testTag("remove-member-${displayName(m.user)}"))
                            }
                            if (m.userId != me) {
                                val name = displayName(m.user)
                                MemberSafetyMenu(name, blocked,
                                    onReport = { reporting = ReportTarget(ReportTargetType.USER, m.userId, m.userId, name) },
                                    onBlock = { blocking = m }, onUnblock = { vm.unblock(m.userId) })
                            }
                        }
                        if (i < members.lastIndex) HorizontalDivider(color = BoolaaTheme.colors.divider)
                    }
                }
            }
            val pending = requests.orEmpty()
            item { SectionHeader(stringResource(R.string.pending_join_requests), pending.size) }
            if (requests != null && pending.isEmpty()) {
                item { Text(stringResource(R.string.no_pending_requests), color = BoolaaTheme.colors.textSecondary, modifier = Modifier.boolaaCard()) }
            }
            items(pending, key = { it.id }) { r ->
                RequestRow(r, members, bubble.maxSize, me, onApprove = { vm.approve(r) }, onReject = { vm.reject(r) })
            }
            item {
                SecondaryButton(stringResource(R.string.leave_bubble), onClick = { confirmLeave = true }, color = Brand.danger,
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp).testTag("leave-bubble"))
            }
        }
    }
    reporting?.let { ReportSheet(it, onDismiss = { reporting = null }) }
    blocking?.let { m ->
        ConfirmDialog(
            title = stringResource(R.string.block_user_title, displayName(m.user)),
            message = stringResource(R.string.block_explainer),
            confirm = stringResource(R.string.block),
            onConfirm = { vm.block(m.userId) }, onDismiss = { blocking = null },
        )
    }
    removing?.let { m ->
        ConfirmDialog(
            title = stringResource(R.string.remove_member_confirm_title, displayName(m.user)),
            message = stringResource(R.string.remove_member_confirm_message),
            confirm = stringResource(R.string.remove_member),
            onConfirm = { vm.remove(m) }, onDismiss = { removing = null },
        )
    }
    if (confirmLeave) {
        ConfirmDialog(
            title = stringResource(R.string.leave_bubble_confirm_title, bubble.name),
            message = stringResource(R.string.leave_bubble_confirm_message),
            confirm = stringResource(R.string.leave_bubble),
            onConfirm = vm::leave, onDismiss = { confirmLeave = false },
        )
    }
    ErrorDialogFor(vm)
}

@Composable
private fun InfoCard(bubble: Bubble, memberCount: Int, isOwner: Boolean, vm: SettingsViewModel) {
    var editing by rememberSaveable { mutableStateOf(false) }
    var name by rememberSaveable { mutableStateOf(bubble.name) }
    var description by rememberSaveable { mutableStateOf(bubble.description.orEmpty()) }
    Column(Modifier.boolaaCard(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (editing) {
            BoolaaTextField(name, { name = it.take(60) }, stringResource(R.string.bubble_name))
            BoolaaTextField(description, { description = it }, stringResource(R.string.description), singleLine = false, minLines = 2)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SecondaryButton(stringResource(R.string.cancel), onClick = { editing = false }, modifier = Modifier.weight(1f))
                PrimaryButton(stringResource(R.string.save), onClick = { vm.saveInfo(name, description) { editing = false } },
                    enabled = name.isNotBlank(), modifier = Modifier.weight(1f))
            }
        } else {
            Row(verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(bubble.name, style = MaterialTheme.typography.titleLarge)
                    Text(bubble.description?.takeIf { it.isNotBlank() } ?: stringResource(R.string.no_description), color = BoolaaTheme.colors.textSecondary)
                    Text(
                        pluralStringResource(R.plurals.members_of_max, bubble.maxSize, memberCount, bubble.maxSize),
                        style = MaterialTheme.typography.labelMedium, color = BoolaaTheme.colors.textSecondary,
                    )
                }
                if (isOwner) {
                    CircleIconButton(Icons.Default.Edit, stringResource(R.string.edit_bubble),
                        onClick = { name = bubble.name; description = bubble.description.orEmpty(); editing = true },
                        size = 36.dp, modifier = Modifier.testTag("edit-bubble"))
                }
            }
        }
    }
}

@Composable
private fun InviteCard(bubble: Bubble) {
    val context = LocalContext.current
    var copied by remember { mutableStateOf(false) }
    val shareText = stringResource(R.string.invite_share_text, bubble.name, bubble.inviteCode)
    val shareTitle = stringResource(R.string.share_invite_code)
    LaunchedEffect(copied) { if (copied) { delay(1500); copied = false } }
    Column(Modifier.boolaaCard(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(R.string.invite_code).uppercase(), style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold,
            color = BoolaaTheme.colors.textSecondary)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(bubble.inviteCode, fontSize = 26.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace, color = Brand.purple,
                modifier = Modifier.weight(1f).testTag("invite-code"))
            CircleIconButton(if (copied) Icons.Default.Check else Icons.Default.ContentCopy, stringResource(R.string.copy_invite_code), onClick = {
                val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                cm.setPrimaryClip(ClipData.newPlainText(shareTitle, bubble.inviteCode))
                copied = true
            }, modifier = Modifier.testTag("copy-invite"))
            Spacer(Modifier.width(8.dp))
            CircleIconButton(Icons.Default.Share, shareTitle, onClick = {
                val send = Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, shareText) }
                context.startActivity(Intent.createChooser(send, shareTitle))
            }, modifier = Modifier.testTag("share-invite"))
        }
    }
}

@Composable
private fun RequestRow(request: JoinRequest, members: List<BubbleMember>, maxSize: Int, me: String, onApprove: () -> Unit, onReject: () -> Unit) {
    val needed = JoinRequest.approvalsNeeded(members.size)
    // Only current members' votes count (approve_join_request / try_admit_join_request).
    val approvals = JoinRequest.currentApprovals(request, members.map { it.userId })
    val waitingForSeat = approvals >= needed && members.size >= maxSize
    val alreadyApproved = me in request.approverIds
    Row(Modifier.boolaaCard().testTag("join-request-${request.id}"), verticalAlignment = Alignment.CenterVertically) {
        Avatar(request.user, 40.dp)
        Column(Modifier.weight(1f).padding(start = 12.dp)) {
            Text(displayName(request.user), style = MaterialTheme.typography.titleMedium)
            Text(
                pluralStringResource(R.plurals.approvals_of_needed, needed, approvals, needed),
                style = MaterialTheme.typography.bodyMedium, color = BoolaaTheme.colors.textSecondary,
            )
            if (waitingForSeat) {
                Text(stringResource(R.string.approved_waiting_for_spot), style = MaterialTheme.typography.bodySmall, color = Brand.purple,
                    fontWeight = FontWeight.SemiBold, modifier = Modifier.testTag("waiting-for-spot"))
            }
        }
        if (!alreadyApproved) {
            CircleIconButton(Icons.Default.Check, stringResource(R.string.approve), onApprove, filled = true, size = 38.dp,
                modifier = Modifier.testTag("approve-request"))
            Spacer(Modifier.width(8.dp))
        }
        CircleIconButton(Icons.Default.Close, stringResource(R.string.reject), onReject, tint = Brand.danger, size = 38.dp,
            modifier = Modifier.testTag("reject-request"))
    }
}

