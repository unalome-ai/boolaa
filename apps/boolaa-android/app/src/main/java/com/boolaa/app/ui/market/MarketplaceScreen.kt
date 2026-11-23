package com.boolaa.app.ui.market

import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import com.boolaa.app.ui.shell.pushHighlight
import com.boolaa.app.ui.shell.PushHighlightScroll
import android.content.ContentResolver
import android.net.Uri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.boolaa.app.AppContainer
import com.boolaa.app.R
import com.boolaa.app.core.FeedSpecs
import com.boolaa.app.core.keepFeedLive
import com.boolaa.app.core.ImageBucket
import com.boolaa.app.core.MarketInput
import com.boolaa.app.model.MarketAvailability
import com.boolaa.app.model.MarketItem
import com.boolaa.app.model.MarketStatus
import com.boolaa.app.model.ReportTarget
import com.boolaa.app.model.ReportTargetType
import com.boolaa.app.ui.safety.ReportSheet
import com.boolaa.app.ui.BaseViewModel
import com.boolaa.app.ui.ErrorDialogFor
import com.boolaa.app.ui.LocalAppContainer
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
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
import com.boolaa.app.ui.components.longPressToReact
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
import com.boolaa.app.ui.components.HandOverDialog
import com.boolaa.app.ui.components.IWantItSheet
import com.boolaa.app.ui.components.OwnerRequestsButton
import com.boolaa.app.ui.components.RequestBadge
import com.boolaa.app.ui.components.RequestCountPill
import com.boolaa.app.ui.components.RequesterActions
import com.boolaa.app.ui.components.RequestsSheet
import com.boolaa.app.ui.components.MenuExtra
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
import com.boolaa.app.ui.components.tapArea
import com.boolaa.app.ui.components.tapVisual
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

class MarketViewModel(container: AppContainer, bubbleId: String) :
    com.boolaa.app.ui.RequestsViewModel(container, bubbleId, com.boolaa.app.model.ItemKind.MARKET) {
    private val _items = MutableStateFlow<List<MarketItem>?>(null)
    val items = _items.asStateFlow()
    val reactions = reactionStore(container.api, bubbleId, com.boolaa.app.model.ReactionTarget.MARKET_ITEM, _items) { it.id }

    private val cacheKey = com.boolaa.app.core.CacheKeys.market(bubbleId)
    private val serializer = kotlinx.serialization.builtins.ListSerializer(MarketItem.serializer())

    init {
        offlineAware(container, _items, cacheKey, serializer) { load() }
        load()
        reloadOnBlockChange(container.session) { load() }
    }

    /** Other members' inserts, edits, RSVPs and deletes stream in while the screen is shown (docs/boolaa-spec.md). */
    suspend fun keepLive() = container.api.keepFeedLive(FeedSpecs.market, bubbleId, _items, reactions, requests) { load().join() }

    override fun applyItem(itemId: String, availability: MarketAvailability?, countDelta: Int) = _items.update { list ->
        list?.map { i ->
            if (i.id != itemId) i
            else i.copy(
                availability = availability ?: i.availability,
                // Hand-over decides everything: no open requests are left.
                requestCount = if (availability == MarketAvailability.TAKEN) 0 else (i.requestCount + countDelta).coerceAtLeast(0),
            )
        }?.sortedWith(MarketRules.order)
    }

    override fun reloadAll() { load() }

    fun react(itemId: String, kind: com.boolaa.app.model.ReactionKind) =
        toggleReaction(reactions, itemId, kind, container.session.state.value.userId)

    fun load(refresh: Boolean = false) = runLoad(container, hasData = { _items.value != null }, trackBusy = refresh) {
        val loaded = container.api.marketItems(bubbleId).sortedWith(MarketRules.order)
        _items.value = loaded
        saveCache(container, cacheKey, serializer, loaded)
        reactions.refresh(loaded.map { it.id })
        // "I want it" rows after the list (docs/boolaa-spec.md "Requests and picking", Loading).
        runCatching { loadRequests() }.onFailure { android.util.Log.w("Boolaa", "market requests load failed", it) }
    }

    fun save(existing: MarketItem?, picked: Uri?, title: String, description: String, status: MarketStatus,
             availability: MarketAvailability, resolver: ContentResolver, onDone: () -> Unit) = launchCatching(onSuccess = onDone) {
        val image = picked?.let { uploadPicked(container, resolver, it, ImageBucket.MARKET) } ?: existing?.image ?: return@launchCatching
        val input = MarketInput(image, title.trim(), description.trim().ifEmpty { null }, status, availability)
        val userId = container.session.state.value.userId ?: return@launchCatching
        if (existing == null) container.api.createMarketItem(bubbleId, userId, input) else container.api.updateMarketItem(existing.id, input)
        if (existing != null && existing.image != image) container.api.deleteImage(existing.image, ImageBucket.MARKET, userId)
        load()
    }

    /**
     * Owner only ("Mark as"). Applied locally at once; everyone else gets the UPDATE live. The database maps the new
     * availability onto the requests (Available clears a pick, Reserved restores a winner, Taken = hand over); the same
     * mapping is applied to the rows held here.
     */
    fun setAvailability(item: MarketItem, availability: MarketAvailability) = launchCatching {
        container.api.setMarketAvailability(item.id, availability)
        requests.update { com.boolaa.app.core.RequestRules.applyAvailability(it, item.id, availability) }
        applyItem(item.id, availability, 0)
        if (availability != MarketAvailability.TAKEN) runCatching { loadRequests() } // a restored winner, counts
    }

    fun delete(item: MarketItem) = launchCatching {
        container.api.deleteMarketItem(item.id)
        container.session.state.value.userId?.let { container.api.deleteImage(item.image, ImageBucket.MARKET, it) }
        _items.update { it?.filterNot { i -> i.id == item.id } }
    }
}

@Composable
fun statusLabel(status: MarketStatus) = stringResource(if (status == MarketStatus.FREE) R.string.status_free else R.string.status_trade)

@Composable
fun availabilityLabel(a: MarketAvailability) = stringResource(when (a) {
    MarketAvailability.AVAILABLE -> R.string.market_available
    MarketAvailability.RESERVED -> R.string.market_reserved
    MarketAvailability.TAKEN -> R.string.market_taken
})

/** Grid with a Free/Trade badge and All/Free/Trade filter chips (spec §9). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MarketplaceScreen(onAskInChat: (com.boolaa.app.ui.chat.ChatDraft) -> Unit = {}) {
    val container = LocalAppContainer.current
    val state by container.session.state.collectAsStateWithLifecycle()
    val bubble = state.currentBubble ?: return
    val me = state.userId ?: return
    val vm: MarketViewModel = viewModel(key = "market-${bubble.id}") { MarketViewModel(container, bubble.id) }
    // Resubscribed (and reloaded once live) on every reconnect and return to the front.
    val generation by container.connectivity.refresh.collectAsStateWithLifecycle()
    LaunchedEffect(vm, generation) { vm.keepLive() }
    val items by vm.items.collectAsStateWithLifecycle()
    val issue by vm.loadIssue.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    var filter by rememberSaveable { mutableStateOf(MarketFilter.ALL) }
    var hideTaken by remember { mutableStateOf(false) }
    val reactionRows by vm.reactions.rows.collectAsStateWithLifecycle()
    val reactionsByItem = remember(reactionRows, me) { com.boolaa.app.core.ReactionMerge.summaries(reactionRows, me) }
    var editing by remember { mutableStateOf<MarketItem?>(null) }
    var creating by rememberSaveable { mutableStateOf(false) }
    // Bumped on every "new item", so the editor's saved state never carries over to the next item.
    var editorSession by rememberSaveable { mutableIntStateOf(0) }
    var deleting by remember { mutableStateOf<MarketItem?>(null) }
    var reporting by remember { mutableStateOf<ReportTarget?>(null) }
    val requests by vm.requests.rows.collectAsStateWithLifecycle()
    val working by vm.working.collectAsStateWithLifecycle()
    var wanting by rememberSaveable { mutableStateOf<String?>(null) }
    var sheetFor by rememberSaveable { mutableStateOf<String?>(null) }
    /** "Mark as" with a pick: Available clears it (confirm), Taken hands over (confirm). */
    var markConfirm by remember { mutableStateOf<Pair<MarketItem, MarketAvailability>?>(null) }
    val someone = stringResource(R.string.someone)
    val context = LocalContext.current
    val hue = Feature.MARKET.hue
    // item_request / item_request_withdrawn push: open the Requests sheet on my item.
    val openRequests by container.push.openRequests.collectAsStateWithLifecycle()
    LaunchedEffect(openRequests, items) {
        val id = openRequests ?: return@LaunchedEffect
        val item = items?.firstOrNull { it.id == id } ?: return@LaunchedEffect
        container.push.consumeOpenRequests(id)
        if (item.ownerId == me) sheetFor = id
    }
    val gridState = rememberLazyGridState()
    PushHighlightScroll(gridState, loaded = items != null)
    // A push or search hit hidden by a filter: show everything so it can be scrolled to.
    val highlight by container.push.highlight.collectAsStateWithLifecycle()
    LaunchedEffect(highlight, items) {
        val target = items?.firstOrNull { it.id == highlight } ?: return@LaunchedEffect
        if (MarketRules.visible(listOf(target), filter, hideTaken).isEmpty()) { filter = MarketFilter.ALL; hideTaken = false }
    }

    BoolaaRefreshBox(isRefreshing = busy && items != null && !creating && editing == null, onRefresh = { vm.load(refresh = true) },
        modifier = Modifier.fillMaxSize().testTag("market-screen")) {
        LazyVerticalGrid(
            // One column at large font scales, so titles and badges are not squeezed into half the width.
            columns = GridCells.Fixed(if (androidx.compose.ui.platform.LocalDensity.current.fontScale >= 1.5f) 1 else 2),
            state = gridState,
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 6.dp, bottom = dockClearance()),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            val list = items
            val visible = MarketRules.visible(list.orEmpty(), filter, hideTaken)
            item(key = "header", span = { GridItemSpan(maxLineSpan) }) {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    FlowRow(
                        Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp),
                        itemVerticalAlignment = Alignment.CenterVertically,
                    ) {
                        Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            MarketFilter.entries.forEach { f ->
                                val label = stringResource(when (f) {
                                    MarketFilter.ALL -> R.string.filter_all
                                    MarketFilter.FREE -> R.string.status_free
                                    MarketFilter.TRADE -> R.string.status_trade
                                })
                                BoolaaChip(label, active = filter == f, onClick = { filter = f }, hue = hue, modifier = Modifier.testTag("filter-${f.name.lowercase()}"))
                            }
                        }
                        BoolaaChip(stringResource(R.string.market_hide_taken), active = hideTaken, onClick = { hideTaken = !hideTaken }, hue = hue,
                            modifier = Modifier.testTag("filter-hide-taken"))
                        AddButton(stringResource(R.string.new_item), onClick = { editorSession++; editing = null; creating = true }, hue = hue)
                    }
                    if (list != null && visible.isNotEmpty()) {
                        RollingCount(visible.size, Modifier.padding(start = 2.dp)) {
                            Text(pluralStringResource(R.plurals.items_count, it, it), style = Type.subheadline, color = BoolaaTheme.colors.textSecondary)
                        }
                    }
                }
            }
            item(key = "stale", span = { GridItemSpan(maxLineSpan) }) { com.boolaa.app.ui.components.StaleNotice(issue, vm::retryNow) }
            when {
                list == null && issue == com.boolaa.app.ui.LoadIssue.FAILED -> item(key = "load-failed", span = { GridItemSpan(maxLineSpan) }) {
                    com.boolaa.app.ui.components.LoadFailed(vm::retryNow)
                }
                list == null -> items(4, key = { "skeleton-$it" }) { SkeletonTile() }
                visible.isEmpty() -> item(key = "empty", span = { GridItemSpan(maxLineSpan) }) {
                    EmptyState(stringResource(R.string.market_empty_title), stringResource(R.string.market_empty_message), hue = hue)
                }
                // Filter change: tiles leaving fade out, arriving ones pop in, the rest slide to their new place.
                else -> gridItemsIndexed(visible, key = { _, it -> it.id }) { index, item ->
                    val mine = item.ownerId == me
                    val ownerName = item.owner?.name?.takeIf { it.isNotBlank() } ?: someone
                    val askDraft = stringResource(R.string.market_ask_draft, ownerName, item.title)
                    val pick = if (mine) com.boolaa.app.core.RequestRules.pick(requests, item.id) else null
                    val myRequest = if (mine) null else com.boolaa.app.core.RequestRules.mine(requests, item.id, me)
                    val view = com.boolaa.app.core.RequestRules.viewerState(item.availability, myRequest)
                    MarketCard(item, if (mine) ({ editorSession++; creating = false; editing = item }) else null, if (mine) ({ deleting = item }) else null,
                        if (mine) null else ({ reporting = ReportTarget(ReportTargetType.MARKET_ITEM, item.id, item.ownerId, ownerName) }),
                        onMark = if (mine) ({ a ->
                            if (pick != null && (a == MarketAvailability.AVAILABLE || a == MarketAvailability.TAKEN)) markConfirm = item to a
                            else vm.setAvailability(item, a)
                        }) else null,
                        // The owner's name becomes a real mention token in the chat when they're a candidate.
                        onAsk = if (MarketRules.canAskOwner(item, me)) ({
                            onAskInChat(com.boolaa.app.ui.chat.ChatDraft(askDraft, item.ownerId, item.owner?.name?.takeIf { it.isNotBlank() }))
                        }) else null,
                        reactions = reactionsByItem[item.id].orEmpty(), onReact = { vm.react(item.id, it) },
                        badge = when {
                            pick != null -> stringResource(R.string.requests_reserved_for, displayName(pick.requester)) to "reserved-for"
                            view == com.boolaa.app.core.RequesterView.RESERVED_FOR_YOU -> stringResource(R.string.requests_reserved_for_you) to "reserved-for-you"
                            view == com.boolaa.app.core.RequesterView.YOURS -> stringResource(R.string.requests_you_got_it) to "request-yours"
                            else -> null
                        },
                        onCountClick = if (mine) ({ sheetFor = item.id }) else null,
                        footer = when {
                            item.availability == MarketAvailability.TAKEN && mine -> null
                            mine -> ({ OwnerRequestsButton(item.requestCount, hue, onClick = { sheetFor = item.id }) })
                            else -> ({
                                RequesterActions(view, item.title, ownerName, hue, busy = working == item.id,
                                    onWant = { wanting = item.id }, onWithdraw = { myRequest?.let(vm::withdraw) })
                            })
                        },
                        modifier = Modifier.pushHighlight(item.id).animateItem(fadeInSpec = Motion.fade(), placementSpec = Motion.snappy(), fadeOutSpec = Motion.fade()).popIn(index))
                }
            }
        }
    }
    if (creating || editing != null) {
        val resolver = LocalContext.current.contentResolver
        androidx.compose.runtime.key(editorSession) {
            MarketEditor(editing, busy, onDismiss = { creating = false; editing = null }) { picked, title, description, status, availability ->
                val first = editing == null && items.orEmpty().none { it.ownerId == me }
                vm.save(editing, picked, title, description, status, availability, resolver) {
                    creating = false; editing = null
                    if (first) com.boolaa.app.ui.components.CheerCenter.show(com.boolaa.app.core.Cheer.FIRST_ITEM)
                }
            }
        }
    }
    wanting?.let { id -> items?.firstOrNull { it.id == id } }?.let { item ->
        val ownerName = item.owner?.name?.takeIf { it.isNotBlank() } ?: someone
        val sent = stringResource(R.string.requests_sent_toast, ownerName)
        IWantItSheet(hue, busy = working == item.id, onDismiss = { wanting = null }) { note ->
            wanting = null
            vm.request(item.id, item.ownerId, note) { android.widget.Toast.makeText(context, sent, android.widget.Toast.LENGTH_SHORT).show() }
        }
    }
    sheetFor?.let { id -> items?.firstOrNull { it.id == id && it.availability != MarketAvailability.TAKEN } }?.let { item ->
        val rows = com.boolaa.app.core.RequestRules.sheetRows(requests, item.id)
        val pickedTemplate = stringResource(R.string.requests_picked_toast)
        RequestsSheet(com.boolaa.app.model.ItemKind.MARKET, item.title, rows, busy = working == item.id, hue = hue,
            onPick = { r ->
                val text = pickedTemplate.format(r.requester?.name?.takeIf { it.isNotBlank() } ?: someone)
                vm.pick(r) { android.widget.Toast.makeText(context, text, android.widget.Toast.LENGTH_SHORT).show() }
            },
            onUndo = { vm.unpick(item.id) },
            onHandOver = { sheetFor = null; vm.handOver(item.id) },
            onDismiss = { sheetFor = null })
    }
    markConfirm?.let { (item, a) ->
        val pickName = com.boolaa.app.core.RequestRules.pick(requests, item.id)?.requester?.let { displayName(it) } ?: someone
        if (a == MarketAvailability.TAKEN) {
            HandOverDialog(stringResource(R.string.requests_hand_over_body_market, pickName, item.title),
                onConfirm = { vm.handOver(item.id) }, onDismiss = { markConfirm = null })
        } else {
            ConfirmDialog(stringResource(R.string.market_mark_as, availabilityLabel(a)), stringResource(R.string.requests_clear_pick_confirm, pickName),
                stringResource(R.string.market_mark_as, availabilityLabel(a)), onConfirm = { vm.setAvailability(item, a) },
                onDismiss = { markConfirm = null }, destructive = false)
        }
    }
    deleting?.let { i ->
        ConfirmDialog(stringResource(R.string.delete_item_title), i.title, stringResource(R.string.delete),
            onConfirm = { vm.delete(i) }, onDismiss = { deleting = null })
    }
    reporting?.let { ReportSheet(it, onDismiss = { reporting = null }) }
    ErrorDialogFor(vm)
}

/** Free = mint gradient + gift; Trade = sunny gradient + swap. */
@Composable
fun MarketBadge(status: MarketStatus, modifier: Modifier = Modifier) {
    val free = status == MarketStatus.FREE
    StatusBadge(statusLabel(status), modifier, hue = if (free) Hue.mint else Hue.sunny, icon = if (free) BoolaaIcons.Free else BoolaaIcons.Trade)
}

/** Shown only for Reserved (sunny) and Taken (muted grey); Available needs no badge. */
@Composable
fun AvailabilityBadge(availability: MarketAvailability, modifier: Modifier = Modifier) {
    when (availability) {
        MarketAvailability.AVAILABLE -> Unit
        MarketAvailability.RESERVED -> StatusBadge(availabilityLabel(availability), modifier.testTag("availability-reserved"), hue = Hue.tangerine,
            icon = BoolaaIcons.Reserved)
        MarketAvailability.TAKEN -> Row(
            modifier.clip(CircleShape).background(Brand.taken).padding(horizontal = 10.dp, vertical = 4.dp)
                .testTag("availability-taken"),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Icon(BoolaaIcons.Taken, contentDescription = null, tint = Color.White, modifier = Modifier.size(13.dp))
            Text(availabilityLabel(availability).uppercase(), style = Type.caption2.copy(fontWeight = FontWeight.Black), color = Color.White, maxLines = 1)
        }
    }
}

@Composable
fun MarketCard(
    item: MarketItem, onEdit: (() -> Unit)?, onDelete: (() -> Unit)?, onReport: (() -> Unit)? = null,
    onMark: ((MarketAvailability) -> Unit)? = null, onAsk: (() -> Unit)? = null, modifier: Modifier = Modifier,
    reactions: List<com.boolaa.app.core.ReactionSummary> = emptyList(), onReact: ((com.boolaa.app.model.ReactionKind) -> Unit)? = null,
    /** "Reserved for {name}" (owner), "Reserved for you" or "It's yours" with its test tag; replaces the plain badge. */
    badge: Pair<String, String>? = null,
    onCountClick: (() -> Unit)? = null,
    footer: (@Composable () -> Unit)? = null,
) {
    val c = BoolaaTheme.colors
    val taken = item.availability == MarketAvailability.TAKEN
    val picker = com.boolaa.app.ui.components.rememberReactionPicker()
    Column(modifier.boolaaCard(0.dp).testTag("market-${item.id}")) {
        // Long press on the photo opens the reaction picker.
        Box(if (onReact != null) Modifier.longPressToReact(picker) else Modifier) {
            RemoteImage(item.image, Modifier.fillMaxWidth().height(140.dp).graphicsLayer { alpha = if (taken) 0.45f else 1f },
                stringResource(R.string.a11y_photo_from, displayName(item.owner)))
            Column(Modifier.align(Alignment.TopStart).padding(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                MarketBadge(item.status)
                if (badge != null) RequestBadge(badge.first, Feature.MARKET.hue, badge.second) else AvailabilityBadge(item.availability)
                if (!taken) RequestCountPill(item.requestCount, Feature.MARKET.hue, onClick = onCountClick)
            }
        }
        Row(Modifier.padding(start = 12.dp, top = 8.dp, bottom = 10.dp), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f).padding(top = 2.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(item.title, style = Type.chip, color = c.textPrimary, maxLines = 2, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.semantics { heading() })
                item.description?.takeIf { it.isNotBlank() }?.let {
                    Text(it, style = Type.caption2, color = c.textSecondary, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Avatar(item.owner, 20.dp)
                    Text(displayName(item.owner), style = Type.caption2, color = c.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            if (onDelete != null || onReport != null) {
                ItemMenu(onEdit, onDelete, onReport, extra = onMark?.let { mark ->
                    MarketAvailability.entries.filter { it != item.availability }.map { a ->
                        MenuExtra(stringResource(R.string.market_mark_as, availabilityLabel(a)), "mark-${a.wire}") { mark(a) }
                    }
                }.orEmpty())
            } else Spacer(Modifier.width(12.dp))
        }
        if (onReact != null) {
            com.boolaa.app.ui.components.ReactionBar(reactions, onReact, Modifier.padding(start = 12.dp, end = 12.dp, bottom = 10.dp),
                hue = Feature.MARKET.hue, picker = picker, tag = "reactions-${item.id}")
        }
        if (footer != null) Box(Modifier.padding(start = 12.dp, end = 12.dp, bottom = 4.dp)) { footer() }
        if (onAsk != null) {
            // 48dp touch target around the slimmer pill.
            val askSource = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }
            Box(
                Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, bottom = 4.dp)
                    .tapArea(askSource, role = Role.Button, onClick = onAsk).testTag("ask-${item.id}"),
                contentAlignment = Alignment.Center,
            ) { Row(
                Modifier.fillMaxWidth().tapVisual(askSource, CircleShape, Modifier.background(Feature.MARKET.hue.wash)).padding(vertical = 8.dp),
                horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(BoolaaIcons.Chat, contentDescription = null, tint = Feature.MARKET.hue.text, modifier = Modifier.size(16.dp))
                Text(stringResource(R.string.market_ask_in_chat), style = Type.caption.copy(fontWeight = FontWeight.Bold), color = Feature.MARKET.hue.text,
                    maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = androidx.compose.ui.text.style.TextAlign.Center, modifier = Modifier.padding(start = 6.dp))
            } }
        }
    }
}

@Composable
fun MarketEditor(existing: MarketItem?, busy: Boolean, onDismiss: () -> Unit, onSave: (Uri?, String, String, MarketStatus, MarketAvailability) -> Unit) {
    var picked by remember { mutableStateOf<Uri?>(null) }
    var title by rememberSaveable { mutableStateOf(existing?.title.orEmpty()) }
    var description by rememberSaveable { mutableStateOf(existing?.description.orEmpty()) }
    var status by rememberSaveable { mutableStateOf(existing?.status ?: MarketStatus.FREE) }
    var availability by rememberSaveable { mutableStateOf(existing?.availability ?: MarketAvailability.AVAILABLE) }
    val hue = Feature.MARKET.hue
    BoolaaSheet(onDismiss, stringResource(if (existing == null) R.string.new_item else R.string.edit_item), spacing = 12.dp) {
        PhotoField(existing?.image, picked, onPick = { picked = it }, hue = hue)
        BoolaaTextField(title, { title = it.take(120) }, stringResource(R.string.title))
        BoolaaTextField(description, { description = it }, stringResource(R.string.description), singleLine = false, minLines = 2)
        SegmentedPill(MarketStatus.entries.map { it to statusLabel(it) }, status, { status = it }, hue = hue)
        Text(stringResource(R.string.market_availability), style = Type.subheadline, color = BoolaaTheme.colors.textSecondary)
        SegmentedPill(MarketAvailability.entries.map { it to availabilityLabel(it) }, availability, { availability = it }, hue = hue)
        PrimaryButton(stringResource(R.string.save), onClick = { onSave(picked, title, description, status, availability) },
            enabled = title.isNotBlank() && (picked != null || existing != null), loading = busy, hue = hue, modifier = Modifier.padding(top = 4.dp))
    }
}
