package com.boolaa.app.ui.market

import android.content.ContentResolver
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Storefront
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.boolaa.app.AppContainer
import com.boolaa.app.R
import com.boolaa.app.core.ImageBucket
import com.boolaa.app.core.MarketInput
import com.boolaa.app.model.MarketItem
import com.boolaa.app.model.MarketStatus
import com.boolaa.app.model.ReportTarget
import com.boolaa.app.model.ReportTargetType
import com.boolaa.app.ui.safety.ReportSheet
import com.boolaa.app.ui.components.ItemMenu
import com.boolaa.app.ui.BaseViewModel
import com.boolaa.app.ui.ErrorDialogFor
import com.boolaa.app.ui.LocalAppContainer
import com.boolaa.app.ui.components.AddRow
import com.boolaa.app.ui.components.BoolaaChip
import com.boolaa.app.ui.components.BoolaaTextField
import com.boolaa.app.ui.components.ConfirmDialog
import com.boolaa.app.ui.components.EmptyState
import com.boolaa.app.ui.components.LoadingBox
import com.boolaa.app.ui.components.OwnerMenu
import com.boolaa.app.ui.components.PhotoField
import com.boolaa.app.ui.components.PrimaryButton
import com.boolaa.app.ui.components.RemoteImage
import com.boolaa.app.ui.components.StatusBadge
import com.boolaa.app.ui.components.boolaaCard
import com.boolaa.app.ui.components.clickableRipple
import com.boolaa.app.ui.components.displayName
import com.boolaa.app.ui.components.uploadPicked
import com.boolaa.app.ui.theme.Brand
import com.boolaa.app.ui.theme.BoolaaTheme
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

enum class MarketFilter { ALL, FREE, TRADE;
    fun matches(item: MarketItem) = when (this) {
        ALL -> true
        FREE -> item.status == MarketStatus.FREE
        TRADE -> item.status == MarketStatus.TRADE
    }
}

class MarketViewModel(private val container: AppContainer, private val bubbleId: String) : BaseViewModel() {
    private val _items = MutableStateFlow<List<MarketItem>?>(null)
    val items = _items.asStateFlow()

    init {
        load()
        reloadOnBlockChange(container.session) { load() }
    }

    fun load(refresh: Boolean = false) = launchCatching(trackBusy = refresh) {
        _items.value = container.api.marketItems(bubbleId)
    }.also { it.invokeOnCompletion { if (_items.value == null) _items.value = emptyList() } }

    fun save(existing: MarketItem?, picked: Uri?, title: String, description: String, status: MarketStatus,
             resolver: ContentResolver, onDone: () -> Unit) = launchCatching(onSuccess = onDone) {
        val image = picked?.let { uploadPicked(container, resolver, it, ImageBucket.MARKET) } ?: existing?.image ?: return@launchCatching
        val input = MarketInput(image, title.trim(), description.trim().ifEmpty { null }, status)
        val userId = container.session.state.value.userId ?: return@launchCatching
        if (existing == null) container.api.createMarketItem(bubbleId, userId, input) else container.api.updateMarketItem(existing.id, input)
        if (existing != null && existing.image != image) container.api.deleteImage(existing.image, ImageBucket.MARKET, userId)
        load()
    }

    fun delete(item: MarketItem) = launchCatching {
        container.api.deleteMarketItem(item.id)
        container.session.state.value.userId?.let { container.api.deleteImage(item.image, ImageBucket.MARKET, it) }
        _items.update { it?.filterNot { i -> i.id == item.id } }
    }
}

@Composable
fun statusLabel(status: MarketStatus) = stringResource(if (status == MarketStatus.FREE) R.string.status_free else R.string.status_trade)

/** Grid with a Free/Trade badge and All/Free/Trade filter chips (spec §9). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MarketplaceScreen() {
    val container = LocalAppContainer.current
    val state by container.session.state.collectAsStateWithLifecycle()
    val bubble = state.currentBubble ?: return
    val me = state.userId ?: return
    val vm: MarketViewModel = viewModel(key = "market-${bubble.id}") { MarketViewModel(container, bubble.id) }
    val items by vm.items.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    var filter by rememberSaveable { mutableStateOf(MarketFilter.ALL) }
    var editing by remember { mutableStateOf<MarketItem?>(null) }
    var creating by rememberSaveable { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<MarketItem?>(null) }
    var reporting by remember { mutableStateOf<ReportTarget?>(null) }
    val someone = stringResource(R.string.someone)

    PullToRefreshBox(isRefreshing = busy && items != null && !creating && editing == null, onRefresh = { vm.load(refresh = true) },
        modifier = Modifier.fillMaxSize().testTag("market-screen")) {
        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = Brand.tabBarClearance),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    AddRow(stringResource(R.string.new_item), onClick = { creating = true })
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        MarketFilter.entries.forEach { f ->
                            val label = stringResource(when (f) {
                                MarketFilter.ALL -> R.string.filter_all
                                MarketFilter.FREE -> R.string.status_free
                                MarketFilter.TRADE -> R.string.status_trade
                            })
                            BoolaaChip(label, active = filter == f,
                                modifier = Modifier.clip(CircleShape).clickableRipple { filter = f }.testTag("filter-${f.name.lowercase()}"))
                        }
                    }
                }
            }
            val list = items
            when {
                list == null -> item(span = { GridItemSpan(maxLineSpan) }) { LoadingBox() }
                list.none(filter::matches) -> item(span = { GridItemSpan(maxLineSpan) }) {
                    EmptyState(Icons.Default.Storefront, stringResource(R.string.market_empty_title), stringResource(R.string.market_empty_message))
                }
                else -> items(list.filter(filter::matches), key = { it.id }) { item ->
                    val mine = item.ownerId == me
                    MarketCard(item, if (mine) ({ editing = item }) else null, if (mine) ({ deleting = item }) else null,
                        if (mine) null else ({ reporting = ReportTarget(ReportTargetType.MARKET_ITEM, item.id, item.ownerId, item.owner?.name?.takeIf { it.isNotBlank() } ?: someone) }))
                }
            }
        }
    }
    if (creating || editing != null) {
        val resolver = LocalContext.current.contentResolver
        MarketEditor(editing, busy, onDismiss = { creating = false; editing = null }) { picked, title, description, status ->
            vm.save(editing, picked, title, description, status, resolver) { creating = false; editing = null }
        }
    }
    deleting?.let { i ->
        ConfirmDialog(stringResource(R.string.delete_item_title), i.title, stringResource(R.string.delete),
            onConfirm = { vm.delete(i) }, onDismiss = { deleting = null })
    }
    reporting?.let { ReportSheet(it, onDismiss = { reporting = null }) }
    ErrorDialogFor(vm)
}

@Composable
fun MarketCard(item: MarketItem, onEdit: (() -> Unit)?, onDelete: (() -> Unit)?, onReport: (() -> Unit)? = null) {
    Column(Modifier.boolaaCard(0.dp).testTag("market-${item.id}")) {
        Box {
            RemoteImage(item.image, Modifier.fillMaxWidth().aspectRatio(1f), item.title)
            StatusBadge(statusLabel(item.status), Modifier.align(Alignment.TopStart).padding(8.dp),
                color = if (item.status == MarketStatus.FREE) Brand.purple else Brand.accent)
        }
        Row(Modifier.padding(start = 10.dp, top = 8.dp, bottom = 10.dp), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f)) {
                Text(item.title, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(displayName(item.owner), style = MaterialTheme.typography.bodySmall, color = BoolaaTheme.colors.textSecondary, maxLines = 1)
                item.description?.takeIf { it.isNotBlank() }?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
            if (onDelete != null || onReport != null) ItemMenu(onEdit, onDelete, onReport)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MarketEditor(existing: MarketItem?, busy: Boolean, onDismiss: () -> Unit, onSave: (Uri?, String, String, MarketStatus) -> Unit) {
    var picked by remember { mutableStateOf<Uri?>(null) }
    var title by rememberSaveable { mutableStateOf(existing?.title.orEmpty()) }
    var description by rememberSaveable { mutableStateOf(existing?.description.orEmpty()) }
    var status by rememberSaveable { mutableStateOf(existing?.status ?: MarketStatus.FREE) }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = BoolaaTheme.colors.background) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).imePadding().padding(horizontal = 20.dp).padding(bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(stringResource(if (existing == null) R.string.new_item else R.string.edit_item), style = MaterialTheme.typography.titleLarge)
            PhotoField(existing?.image, picked, onPick = { picked = it }, modifier = Modifier.height(190.dp).clip(RoundedCornerShape(Brand.cardRadius)))
            BoolaaTextField(title, { title = it.take(120) }, stringResource(R.string.title))
            BoolaaTextField(description, { description = it }, stringResource(R.string.description), singleLine = false, minLines = 2)
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                MarketStatus.entries.forEachIndexed { i, s ->
                    SegmentedButton(
                        selected = status == s, onClick = { status = s },
                        shape = SegmentedButtonDefaults.itemShape(i, MarketStatus.entries.size),
                        colors = SegmentedButtonDefaults.colors(activeContainerColor = Brand.purple, activeContentColor = Color.White),
                    ) { Text(statusLabel(s)) }
                }
            }
            PrimaryButton(stringResource(R.string.save), onClick = { onSave(picked, title, description, status) },
                enabled = title.isNotBlank() && (picked != null || existing != null), loading = busy)
        }
    }
}
