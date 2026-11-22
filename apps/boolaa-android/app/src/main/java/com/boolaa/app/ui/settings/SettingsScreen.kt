package com.boolaa.app.ui.settings

import com.boolaa.app.core.InviteLink
import androidx.compose.ui.geometry.Size
import androidx.compose.foundation.Canvas
import android.widget.Toast
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.LinearProgressIndicator
import com.boolaa.app.core.ImageBucket
import com.boolaa.app.core.ImageCompression
import com.boolaa.app.ui.components.BubbleLogo
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
import com.boolaa.app.ui.shell.ShellNavigator
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import androidx.lifecycle.viewModelScope
import com.boolaa.app.core.LiveTables
import com.boolaa.app.core.TableWatch
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed as gridItemsIndexed
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.boolaa.app.ui.components.AddButton
import com.boolaa.app.ui.components.Avatar
import com.boolaa.app.ui.components.BoolaaChip
import com.boolaa.app.ui.components.BoolaaIcons
import com.boolaa.app.ui.components.BoolaaRefreshBox
import com.boolaa.app.ui.components.BoolaaSheet
import com.boolaa.app.ui.components.BoolaaTextField
import com.boolaa.app.ui.components.BubbleOrb
import com.boolaa.app.ui.components.CircleIconButton
import com.boolaa.app.ui.components.ConfettiOverlay
import com.boolaa.app.ui.components.ConfettiState
import com.boolaa.app.ui.components.ConfirmDialog
import com.boolaa.app.ui.components.EmptyState
import com.boolaa.app.ui.components.FeatureBadge
import com.boolaa.app.ui.components.FitText
import com.boolaa.app.ui.components.Haptics
import com.boolaa.app.ui.components.HintCard
import com.boolaa.app.ui.components.ItemMenu
import com.boolaa.app.ui.components.MorphIcon
import com.boolaa.app.ui.components.PhotoField
import com.boolaa.app.ui.components.PrimaryButton
import com.boolaa.app.ui.components.PushedHeader
import com.boolaa.app.ui.components.RemoteImage
import com.boolaa.app.ui.components.RollingCount
import com.boolaa.app.ui.components.SecondaryButton
import com.boolaa.app.ui.components.SectionHeader
import com.boolaa.app.ui.components.SegmentedPill
import com.boolaa.app.ui.components.SkeletonList
import com.boolaa.app.ui.components.SkeletonTile
import com.boolaa.app.ui.components.StatusBadge
import com.boolaa.app.ui.components.boolaaCard
import com.boolaa.app.ui.components.bounceOn
import com.boolaa.app.ui.components.clickableRipple
import com.boolaa.app.ui.components.dashedBorder
import com.boolaa.app.ui.components.displayName
import com.boolaa.app.ui.components.dockClearance
import com.boolaa.app.ui.components.glow
import com.boolaa.app.ui.components.popIn
import com.boolaa.app.ui.components.scrollFade
import com.boolaa.app.ui.components.uploadPicked
import com.boolaa.app.ui.theme.BoolaaTheme
import com.boolaa.app.ui.theme.Brand
import com.boolaa.app.ui.theme.Display
import com.boolaa.app.ui.theme.Feature
import com.boolaa.app.ui.theme.Hue
import com.boolaa.app.ui.theme.Motion
import com.boolaa.app.ui.theme.Radius
import com.boolaa.app.ui.theme.Type

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

    /** Owner only: a new invite code; old links and QR codes stop working. */
    fun rotateInvite(onDone: () -> Unit) = launchCatching(trackBusy = false, onSuccess = onDone) {
        container.session.rotateInviteCode(bubbleId)
    }

    private val _logoBusy = MutableStateFlow(false)
    val logoBusy = _logoBusy.asStateFlow()

    /** Owner only: picked photo -> ImageCompression (512 px, like avatars) -> bubble.images -> bubbles.logo. */
    fun setLogo(bubble: Bubble, resolver: ContentResolver, uri: Uri) = launchCatching(trackBusy = false) {
        _logoBusy.value = true
        try {
            val jpeg = ImageCompression.jpegFromUri(resolver, uri, ImageBucket.BUBBLE)
            container.session.setBubbleLogo(bubble, jpeg)
        } finally { _logoBusy.value = false }
    }

    fun removeLogo(bubble: Bubble) = launchCatching(trackBusy = false) {
        _logoBusy.value = true
        try { container.session.removeBubbleLogo(bubble) } finally { _logoBusy.value = false }
    }
}

/** Settings for the current bubble (spec §11). */
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
    val c = BoolaaTheme.colors

    BoolaaRefreshBox(isRefreshing = busy, onRefresh = { vm.load(refresh = true) }, modifier = Modifier.fillMaxSize().testTag("settings-screen")) {
        LazyColumn(
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = dockClearance()),
            verticalArrangement = Arrangement.spacedBy(14.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            item(key = "info-${bubble.id}") { InfoCard(bubble, members.size, isOwner, vm, Modifier.popIn(0)) }
            item(key = "invite-${bubble.id}") { InviteCard(bubble, isOwner, vm, Modifier.popIn(1)) }
            item(key = "links") {
                SettingsRow(BoolaaIcons.Link, Hue.sky, stringResource(R.string.shared_links), BoolaaIcons.Disclosure, navigator::openLinks,
                    Modifier.popIn(2).testTag("settings-links"))
            }
            item(key = "members-header") { SectionHeader(stringResource(R.string.members), members.size, Modifier.popIn(3)) }
            item(key = "members") {
                Column(Modifier.popIn(4).boolaaCard().testTag("members-list")) {
                    members.forEachIndexed { i, m ->
                        Row(Modifier.fillMaxWidth().heightIn(min = 60.dp).padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                            Avatar(m.user, 40.dp)
                            val you = if (m.userId == me) stringResource(R.string.you_suffix) else null
                            Text(
                                buildAnnotatedString {
                                    append(displayName(m.user))
                                    if (you != null) withStyle(SpanStyle(color = c.textSecondary, fontWeight = FontWeight.Normal)) { append(" $you") }
                                },
                                style = Type.bodyStrong, color = c.textPrimary, maxLines = 2, overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.padding(start = 12.dp).weight(1f),
                            )
                            val blocked = m.userId in state.blockedIds
                            if (blocked) StatusBadge(stringResource(R.string.blocked_badge), danger = true, modifier = Modifier.padding(start = 6.dp))
                            if (m.role == MemberRole.OWNER) StatusBadge(stringResource(R.string.owner), hue = Hue.sunny, icon = BoolaaIcons.Crown, modifier = Modifier.padding(start = 6.dp))
                            else if (isOwner && m.userId != me) {
                                CircleIconButton(BoolaaIcons.RemoveMember, stringResource(R.string.remove_member), onClick = { removing = m },
                                    danger = true, size = 36.dp, modifier = Modifier.testTag("remove-member-${displayName(m.user)}"))
                            }
                            if (m.userId != me) {
                                val name = displayName(m.user)
                                MemberSafetyMenu(name, blocked,
                                    onReport = { reporting = ReportTarget(ReportTargetType.USER, m.userId, m.userId, name) },
                                    onBlock = { blocking = m }, onUnblock = { vm.unblock(m.userId) })
                            }
                        }
                        if (i < members.lastIndex) HorizontalDivider(color = c.hairline)
                    }
                }
            }
            val pending = requests.orEmpty()
            item(key = "pending-header") { SectionHeader(stringResource(R.string.pending_join_requests), pending.size) }
            if (requests != null && pending.isEmpty()) {
                item(key = "pending-empty") { HintCard(stringResource(R.string.no_pending_requests)) }
            }
            items(pending, key = { it.id }) { r ->
                RequestRow(r, members, bubble.maxSize, me, onApprove = { vm.approve(r) }, onReject = { vm.reject(r) },
                    modifier = Modifier.animateItem(fadeInSpec = Motion.fade(), placementSpec = Motion.snappy(), fadeOutSpec = Motion.fade()))
            }
            item(key = "leave") {
                SecondaryButton(stringResource(R.string.leave_bubble), onClick = { confirmLeave = true }, danger = true,
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

/** Settings / profile row: 56 high, radius 20, a 34 badge in a hue, a label and a trailing symbol. */
@Composable
fun SettingsRow(icon: ImageVector, hue: Hue, label: String, trailing: ImageVector?, onClick: () -> Unit, modifier: Modifier = Modifier, value: String? = null) {
    val c = BoolaaTheme.colors
    Row(
        modifier.boolaaCard(0.dp, 20.dp).clickableRipple(role = Role.Button, onClick = onClick).heightIn(min = 56.dp).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        FeatureBadge(icon, hue, size = 34.dp)
        Text(label, style = Type.body.copy(fontWeight = FontWeight.Medium), color = c.textPrimary, modifier = Modifier.padding(start = 12.dp).weight(1f))
        if (value != null) Text(value, style = Type.body, color = c.textSecondary, modifier = Modifier.padding(end = 6.dp))
        if (trailing != null) Icon(trailing, contentDescription = null, tint = c.textSecondary, modifier = Modifier.size(22.dp))
    }
}

@Composable
private fun InfoCard(bubble: Bubble, memberCount: Int, isOwner: Boolean, vm: SettingsViewModel, modifier: Modifier = Modifier) {
    var editing by rememberSaveable { mutableStateOf(false) }
    var name by rememberSaveable { mutableStateOf(bubble.name) }
    var description by rememberSaveable { mutableStateOf(bubble.description.orEmpty()) }
    val c = BoolaaTheme.colors
    val hue = Hue.forId(bubble.id)
    Column(modifier.boolaaCard().animateContentSize(Motion.gentle()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
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
                BubbleLogo(bubble.id, bubble.name, bubble.logo, size = 64.dp, modifier = Modifier.testTag("bubble-logo"))
                Column(Modifier.weight(1f).padding(start = 14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(bubble.name, style = Type.title2, color = c.textPrimary)
                    Text(bubble.description?.takeIf { it.isNotBlank() } ?: stringResource(R.string.no_description), style = Type.subheadline, color = c.textSecondary)
                    Text(
                        pluralStringResource(R.plurals.members_of_max, bubble.maxSize, memberCount, bubble.maxSize),
                        style = Type.caption, color = Hue.grape.text,
                        modifier = Modifier.padding(top = 4.dp).clip(CircleShape).background(Hue.grape.wash).padding(horizontal = 10.dp, vertical = 4.dp),
                    )
                }
                if (isOwner) {
                    CircleIconButton(BoolaaIcons.Edit, stringResource(R.string.edit_bubble),
                        onClick = { name = bubble.name; description = bubble.description.orEmpty(); editing = true },
                        size = 40.dp, modifier = Modifier.testTag("edit-bubble"))
                }
            }
            if (isOwner) BubbleLogoControls(bubble, vm)
        }
    }
}

/** Owner-only: add / change / remove the bubble photo (Android Photo Picker, no permission needed). */
@Composable
private fun BubbleLogoControls(bubble: Bubble, vm: SettingsViewModel) {
    val c = BoolaaTheme.colors
    val resolver = LocalContext.current.contentResolver
    val logoBusy by vm.logoBusy.collectAsStateWithLifecycle()
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) vm.setLogo(bubble, resolver, uri)
    }
    val hasLogo = !bubble.logo.isNullOrBlank()
    Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.testTag("bubble-photo-controls")) {
        Text(stringResource(R.string.bubble_photo), style = Type.headline, color = c.textPrimary)
        Text(stringResource(R.string.bubble_photo_hint), style = Type.caption, color = c.textSecondary)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SecondaryButton(
                stringResource(if (hasLogo) R.string.change_bubble_photo else R.string.add_bubble_photo),
                onClick = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                enabled = !logoBusy, modifier = Modifier.weight(1f).testTag("bubble-photo-pick"),
            )
            if (hasLogo) {
                SecondaryButton(
                    stringResource(R.string.remove_bubble_photo), onClick = { vm.removeLogo(bubble) },
                    enabled = !logoBusy, danger = true, modifier = Modifier.weight(1f).testTag("bubble-photo-remove"),
                )
            }
        }
        if (logoBusy) LinearProgressIndicator(Modifier.fillMaxWidth(), color = Hue.grape.fill)
    }
}

/** The invite code as a ticket: grape wash, dashed outline; the copy button morphs to a mint check for 1.5 s. */
@Composable
private fun InviteCard(bubble: Bubble, isOwner: Boolean, vm: SettingsViewModel, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val view = LocalView.current
    var copied by remember { mutableStateOf(false) }
    var linkCopied by remember { mutableStateOf(false) }
    var showQr by rememberSaveable { mutableStateOf(false) }
    var confirmRotate by rememberSaveable { mutableStateOf(false) }
    val link = InviteLink.url(bubble.inviteCode)
    val linkShareText = stringResource(R.string.invite_link_share_text, bubble.name, link)
    val shareLinkLabel = stringResource(R.string.share_invite_link)
    val copyLinkLabel = stringResource(R.string.copy_invite_link)
    val rotatedText = stringResource(R.string.invite_rotated)
    LaunchedEffect(linkCopied) { if (linkCopied) { delay(Motion.COPIED_MS); linkCopied = false } }
    val shareText = stringResource(R.string.invite_share_text, bubble.name, bubble.inviteCode)
    val shareTitle = stringResource(R.string.share_invite_code)
    val copyLabel = stringResource(R.string.copy_invite_code)
    val grape = Hue.grape
    LaunchedEffect(copied) { if (copied) { delay(Motion.COPIED_MS); copied = false } }
    Column(
        modifier.fillMaxWidth().clip(RoundedCornerShape(Radius.card)).background(grape.wash)
            .dashedBorder(grape.text.copy(alpha = 0.45f), Radius.card, dash = 7.dp, gap = 6.dp).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(stringResource(R.string.invite_code).uppercase(LocalConfiguration.current.locales[0]), style = Type.caption.copy(fontWeight = FontWeight.Black),
            color = grape.text)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(bubble.inviteCode, style = Type.title.copy(letterSpacing = 3.sp), color = grape.text, maxLines = 1, softWrap = false,
                overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).testTag("invite-code"))
            val copyFill by animateColorAsState(if (copied) Hue.mint.fill else grape.fill.copy(alpha = 0.16f), Motion.fade())
            Box(
                Modifier.size(44.dp).bounceOn(copied, from = 0.8f, enabled = copied).clip(CircleShape).background(copyFill)
                    .clickableRipple(scale = 0.88f) {
                        val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                        cm.setPrimaryClip(ClipData.newPlainText(shareTitle, bubble.inviteCode))
                        copied = true
                        Haptics.success(view)
                    }
                    .semantics { contentDescription = copyLabel; role = Role.Button }
                    .testTag("copy-invite"),
                contentAlignment = Alignment.Center,
            ) {
                MorphIcon(if (copied) BoolaaIcons.Check else BoolaaIcons.Copy, tint = if (copied) Hue.mint.onFill else grape.text, modifier = Modifier.size(22.dp))
            }
            Spacer(Modifier.width(8.dp))
            CircleIconButton(BoolaaIcons.Share, shareTitle, onClick = {
                val send = Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, shareText) }
                context.startActivity(Intent.createChooser(send, shareTitle))
            }, filled = true, size = 44.dp, modifier = Modifier.testTag("share-invite"))
        }
        // Invite link https://boolaa.ro/join/CODE (spec "Invite links"): opens the app, or the web page without it.
        Text(stringResource(R.string.invite_link).uppercase(LocalConfiguration.current.locales[0]), style = Type.caption.copy(fontWeight = FontWeight.Black),
            color = grape.text, modifier = Modifier.padding(top = 6.dp))
        Text(link, style = Type.subheadline, color = grape.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.testTag("invite-link"))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            CircleIconButton(if (linkCopied) BoolaaIcons.Check else BoolaaIcons.Copy, copyLinkLabel, onClick = {
                val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                cm.setPrimaryClip(ClipData.newPlainText(copyLinkLabel, link))
                linkCopied = true
                Haptics.success(view)
            }, size = 44.dp, modifier = Modifier.testTag("copy-invite-link"))
            CircleIconButton(BoolaaIcons.Share, shareLinkLabel, onClick = {
                val send = Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, linkShareText) }
                context.startActivity(Intent.createChooser(send, shareLinkLabel))
            }, size = 44.dp, modifier = Modifier.testTag("share-invite-link"))
            CircleIconButton(BoolaaIcons.QrCode, stringResource(R.string.invite_qr_code), onClick = { showQr = true },
                size = 44.dp, modifier = Modifier.testTag("show-invite-qr"))
            Spacer(Modifier.weight(1f))
            if (isOwner) {
                TextButton(onClick = { confirmRotate = true }, modifier = Modifier.testTag("rotate-invite")) {
                    Text(stringResource(R.string.rotate_invite_code), style = Type.headline, color = grape.text)
                }
            }
        }
    }
    if (showQr) InviteQrDialog(bubble.name, link, onDismiss = { showQr = false })
    if (confirmRotate) {
        ConfirmDialog(
            title = stringResource(R.string.rotate_invite_title),
            message = stringResource(R.string.rotate_invite_body),
            confirm = stringResource(R.string.rotate_invite_confirm),
            onConfirm = { vm.rotateInvite { Toast.makeText(context, rotatedText, Toast.LENGTH_SHORT).show() } },
            onDismiss = { confirmRotate = false },
        )
    }
}

/** The invite link as a QR code (dark modules on white, so cameras read it in dark mode too). */
@Composable
private fun InviteQrDialog(bubbleName: String, link: String, onDismiss: () -> Unit) {
    val matrix = remember(link) { InviteLink.qrMatrix(link) }
    val qrLabel = stringResource(R.string.invite_qr_code)
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.done), style = Type.headline, color = Hue.grape.text) } },
        title = { Text(qrLabel, style = Type.title2) },
        text = {
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Canvas(
                    Modifier.size(240.dp).clip(RoundedCornerShape(16.dp)).background(Color.White)
                        .semantics { contentDescription = qrLabel }.testTag("invite-qr"),
                ) {
                    val cell = size.minDimension / matrix.width
                    for (y in 0 until matrix.height) for (x in 0 until matrix.width) {
                        if (matrix[x, y]) drawRect(Color.Black, topLeft = Offset(x * cell, y * cell), size = Size(cell + 0.5f, cell + 0.5f))
                    }
                }
                Text(stringResource(R.string.invite_qr_hint, bubbleName), style = Type.subheadline, textAlign = TextAlign.Center)
            }
        },
        shape = RoundedCornerShape(Radius.hero), containerColor = BoolaaTheme.colors.card,
    )
}

@Composable
private fun RequestRow(request: JoinRequest, members: List<BubbleMember>, maxSize: Int, me: String, onApprove: () -> Unit, onReject: () -> Unit, modifier: Modifier = Modifier) {
    val needed = JoinRequest.approvalsNeeded(members.size)
    // Only current members' votes count (approve_join_request / try_admit_join_request).
    val approvals = JoinRequest.currentApprovals(request, members.map { it.userId })
    val waitingForSeat = approvals >= needed && members.size >= maxSize
    val alreadyApproved = me in request.approverIds
    val c = BoolaaTheme.colors
    Row(modifier.boolaaCard().testTag("join-request-${request.id}"), verticalAlignment = Alignment.CenterVertically) {
        Avatar(request.user, 40.dp)
        Column(Modifier.weight(1f).padding(start = 12.dp)) {
            Text(displayName(request.user), style = Type.headline, color = c.textPrimary)
            RollingCount(approvals) {
                Text(pluralStringResource(R.plurals.approvals_of_needed, needed, it, needed), style = Type.subheadline, color = c.textSecondary)
            }
            if (waitingForSeat) {
                Text(stringResource(R.string.approved_waiting_for_spot), style = Type.caption, color = Hue.mint.text,
                    modifier = Modifier.testTag("waiting-for-spot"))
            }
        }
        if (!alreadyApproved) {
            CircleIconButton(BoolaaIcons.Check, stringResource(R.string.approve), onApprove, filled = true, hue = Hue.mint, size = 40.dp,
                modifier = Modifier.testTag("approve-request"))
        }
        CircleIconButton(BoolaaIcons.Close, stringResource(R.string.reject), onReject, danger = true, size = 40.dp,
            modifier = Modifier.testTag("reject-request"))
    }
}
