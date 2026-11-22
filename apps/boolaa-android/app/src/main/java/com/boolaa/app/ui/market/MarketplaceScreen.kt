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

class MarketViewModel(private val container: AppContainer, private val bubbleId: String) : BaseViewModel() {
    private val _items = MutableStateFlow<List<MarketItem>?>(null)
    val items = _items.asStateFlow()
    val reactions = reactionStore(container.api, bubbleId, com.boolaa.app.model.ReactionTarget.MARKET_ITEM, _items) { it.id }

    init {
        load()
        reloadOnBlockChange(container.session) { load() }
    }

    /** Other members' inserts, edits, RSVPs and deletes stream in while the screen is shown (docs/boolaa-spec.md). */
    suspend fun keepLive() = container.api.keepFeedLive(FeedSpecs.market, bubbleId, _items, reactions) { load().join() }

    fun react(itemId: String, kind: com.boolaa.app.model.ReactionKind) =
        toggleReaction(reactions, itemId, kind, container.session.state.value.userId)

    fun load(refresh: Boolean = false) = launchCatching(trackBusy = refresh) {
        val loaded = container.api.marketItems(bubbleId).sortedWith(MarketRules.order)
        _items.value = loaded
        reactions.refresh(loaded.map { it.id })
    }.also { it.invokeOnCompletion { if (_items.value == null) _items.value = emptyList() } }

    fun save(existing: MarketItem?, picked: Uri?, title: String, description: String, status: MarketStatus,
             availability: MarketAvailability, resolver: ContentResolver, onDone: () -> Unit) = launchCatching(onSuccess = onDone) {
        val image = picked?.let { uploadPicked(container, resolver, it, ImageBucket.MARKET) } ?: existing?.image ?: return@launchCatching
        val input = MarketInput(image, title.trim(), description.trim().ifEmpty { null }, status, availability)
        val userId = container.session.state.value.userId ?: return@launchCatching
        if (existing == null) container.api.createMarketItem(bubbleId, userId, input) else container.api.updateMarketItem(existing.id, input)
        if (existing != null && existing.image != image) container.api.deleteImage(existing.image, ImageBucket.MARKET, userId)
        load()
    }

    /** Owner only. Applied locally at once; everyone else gets the UPDATE live. */
    fun setAvailability(item: MarketItem, availability: MarketAvailability) = launchCatching {
        container.api.setMarketAvailability(item.id, availability)
        _items.update { list -> list?.map { if (it.id == item.id) it.copy(availability = availability) else it }?.sortedWith(MarketRules.order) }
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
fun MarketplaceScreen(onAskInChat: (String) -> Unit = {}) {
    val container = LocalAppContainer.current
    val state by container.session.state.collectAsStateWithLifecycle()
    val bubble = state.currentBubble ?: return
    val me = state.userId ?: return
    val vm: MarketViewModel = viewModel(key = "market-${bubble.id}") { MarketViewModel(container, bubble.id) }
    LaunchedEffect(vm) { vm.keepLive() }
    val items by vm.items.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    var filter by rememberSaveable { mutableStateOf(MarketFilter.ALL) }
    var hideTaken by remember { mutableStateOf(false) }
    val reactionRows by vm.reactions.rows.collectAsStateWithLifecycle()
    val reactionsByItem = remember(reactionRows, me) { com.boolaa.app.core.ReactionMerge.summaries(reactionRows, me) }
    var editing by remember { mutableStateOf<MarketItem?>(null) }
    var creating by rememberSaveable { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<MarketItem?>(null) }
    var reporting by remember { mutableStateOf<ReportTarget?>(null) }
    val someone = stringResource(R.string.someone)
    val hue = Feature.MARKET.hue
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
            columns = GridCells.Fixed(2),
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
                        AddButton(stringResource(R.string.new_item), onClick = { creating = true }, hue = hue)
                    }
                    if (list != null && visible.isNotEmpty()) {
                        RollingCount(visible.size, Modifier.padding(start = 2.dp)) {
                            Text(pluralStringResource(R.plurals.items_count, it, it), style = Type.subheadline, color = BoolaaTheme.colors.textSecondary)
                        }
                    }
                }
            }
            when {
                list == null -> items(4, key = { "skeleton-$it" }) { SkeletonTile() }
                visible.isEmpty() -> item(key = "empty", span = { GridItemSpan(maxLineSpan) }) {
                    EmptyState(BoolaaIcons.Market, stringResource(R.string.market_empty_title), stringResource(R.string.market_empty_message), hue = hue)
                }
                // Filter change: tiles leaving fade out, arriving ones pop in, the rest slide to their new place.
                else -> gridItemsIndexed(visible, key = { _, it -> it.id }) { index, item ->
                    val mine = item.ownerId == me
                    val ownerName = item.owner?.name?.takeIf { it.isNotBlank() } ?: someone
                    val askDraft = stringResource(R.string.market_ask_draft, ownerName, item.title)
                    MarketCard(item, if (mine) ({ editing = item }) else null, if (mine) ({ deleting = item }) else null,
                        if (mine) null else ({ reporting = ReportTarget(ReportTargetType.MARKET_ITEM, item.id, item.ownerId, ownerName) }),
                        onMark = if (mine) ({ a -> vm.setAvailability(item, a) }) else null,
                        onAsk = if (MarketRules.canAskOwner(item, me)) ({ onAskInChat(askDraft) }) else null,
                        reactions = reactionsByItem[item.id].orEmpty(), onReact = { vm.react(item.id, it) },
                        modifier = Modifier.pushHighlight(item.id).animateItem(fadeInSpec = Motion.fade(), placementSpec = Motion.snappy(), fadeOutSpec = Motion.fade()).popIn(index))
                }
            }
        }
    }
    if (creating || editing != null) {
        val resolver = LocalContext.current.contentResolver
        MarketEditor(editing, busy, onDismiss = { creating = false; editing = null }) { picked, title, description, status, availability ->
            vm.save(editing, picked, title, description, status, availability, resolver) { creating = false; editing = null }
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
    val c = BoolaaTheme.colors
    when (availability) {
        MarketAvailability.AVAILABLE -> Unit
        MarketAvailability.RESERVED -> StatusBadge(availabilityLabel(availability), modifier.testTag("availability-reserved"), hue = Hue.tangerine,
            icon = BoolaaIcons.Reserved)
        MarketAvailability.TAKEN -> Row(
            modifier.clip(CircleShape).background(c.textSecondary.copy(alpha = 0.92f)).padding(horizontal = 10.dp, vertical = 4.dp)
                .testTag("availability-taken"),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Icon(BoolaaIcons.Taken, contentDescription = null, tint = c.card, modifier = Modifier.size(13.dp))
            Text(availabilityLabel(availability).uppercase(), style = Type.caption2.copy(fontWeight = FontWeight.Black), color = c.card, maxLines = 1)
        }
    }
}

@Composable
fun MarketCard(
    item: MarketItem, onEdit: (() -> Unit)?, onDelete: (() -> Unit)?, onReport: (() -> Unit)? = null,
    onMark: ((MarketAvailability) -> Unit)? = null, onAsk: (() -> Unit)? = null, modifier: Modifier = Modifier,
    reactions: List<com.boolaa.app.core.ReactionSummary> = emptyList(), onReact: ((com.boolaa.app.model.ReactionKind) -> Unit)? = null,
) {
    val c = BoolaaTheme.colors
    val taken = item.availability == MarketAvailability.TAKEN
    val picker = com.boolaa.app.ui.components.rememberReactionPicker()
    Column(modifier.boolaaCard(0.dp).testTag("market-${item.id}")) {
        // Long press on the photo opens the reaction picker.
        Box(if (onReact != null) Modifier.longPressToReact(picker) else Modifier) {
            RemoteImage(item.image, Modifier.fillMaxWidth().height(140.dp).graphicsLayer { alpha = if (taken) 0.45f else 1f }, item.title)
            Column(Modifier.align(Alignment.TopStart).padding(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                MarketBadge(item.status)
                AvailabilityBadge(item.availability)
            }
        }
        Row(Modifier.padding(start = 12.dp, top = 8.dp, bottom = 10.dp), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f).padding(top = 2.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(item.title, style = Type.chip, color = c.textPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
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
        if (onAsk != null) {
            Row(
                Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, bottom = 12.dp).clip(CircleShape).background(Feature.MARKET.hue.wash)
                    .clickableRipple(onClick = onAsk).padding(vertical = 8.dp).testTag("ask-${item.id}"),
                horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(BoolaaIcons.Chat, contentDescription = null, tint = Feature.MARKET.hue.text, modifier = Modifier.size(16.dp))
                Text(stringResource(R.string.market_ask_in_chat), style = Type.caption.copy(fontWeight = FontWeight.Bold), color = Feature.MARKET.hue.text,
                    maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = 6.dp))
            }
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
