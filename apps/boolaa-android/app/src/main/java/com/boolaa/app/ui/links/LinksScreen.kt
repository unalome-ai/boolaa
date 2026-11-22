package com.boolaa.app.ui.links

import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.boolaa.app.AppContainer
import com.boolaa.app.R
import com.boolaa.app.model.SharedLink
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

class LinksViewModel(private val container: AppContainer, private val bubbleId: String) : BaseViewModel() {
    private val _links = MutableStateFlow<List<SharedLink>?>(null)
    val links = _links.asStateFlow()

    init {
        load()
        reloadOnBlockChange(container.session) { load() }
    }

    fun load() = launchCatching(trackBusy = false) {
        _links.value = container.api.links(bubbleId)
    }.also { it.invokeOnCompletion { if (_links.value == null) _links.value = emptyList() } }

    fun add(url: String, title: String, tags: String, onDone: () -> Unit) = launchCatching(onSuccess = onDone) {
        val userId = container.session.state.value.userId ?: return@launchCatching
        container.api.createLink(bubbleId, userId, SharedLink.normalizeUrl(url), title.trim().ifEmpty { null }, SharedLink.parseTags(tags))
        load()
    }

    fun delete(link: SharedLink) = launchCatching {
        container.api.deleteLink(link.id)
        _links.update { it?.filterNot { l -> l.id == link.id } }
    }
}

/** Shared links: add with title and comma-separated tags, filter by tag, open, delete own (spec §10). */
@Composable
fun LinksScreen(onBack: () -> Unit) {
    val container = LocalAppContainer.current
    val state by container.session.state.collectAsStateWithLifecycle()
    val bubble = state.currentBubble ?: return
    val me = state.userId ?: return
    val vm: LinksViewModel = viewModel(key = "links-${bubble.id}") { LinksViewModel(container, bubble.id) }
    val links by vm.links.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val uriHandler = LocalUriHandler.current
    var url by rememberSaveable { mutableStateOf("") }
    var title by rememberSaveable { mutableStateOf("") }
    var tags by rememberSaveable { mutableStateOf("") }
    var tagFilter by rememberSaveable { mutableStateOf<String?>(null) }
    var deleting by remember { mutableStateOf<SharedLink?>(null) }
    var reporting by remember { mutableStateOf<ReportTarget?>(null) }
    val someone = stringResource(R.string.someone)
    val allTags = links.orEmpty().flatMap { it.tags }.distinct().sorted()
    val hue = Feature.LINKS.hue
    val c = BoolaaTheme.colors

    Column(Modifier.fillMaxSize().statusBarsPadding().imePadding().testTag("links-screen")) {
        PushedHeader(stringResource(R.string.links), bubble.name, Hue.forId(bubble.id), onBack, backTag = "links-back")
        LazyColumn(
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 40.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.navigationBarsPadding(),
        ) {
            item(key = "add") {
                Column(Modifier.popIn(0).boolaaCard(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        FeatureBadge(BoolaaIcons.Link, hue, size = 36.dp)
                        Text(stringResource(R.string.add_link), style = Type.headline, color = c.textPrimary)
                    }
                    BoolaaTextField(url, { url = it }, stringResource(R.string.url), Modifier.testTag("link-url"),
                        keyboardType = androidx.compose.ui.text.input.KeyboardType.Uri)
                    BoolaaTextField(title, { title = it }, stringResource(R.string.title))
                    BoolaaTextField(tags, { tags = it }, stringResource(R.string.tags_hint))
                    PrimaryButton(stringResource(R.string.add), onClick = { vm.add(url, title, tags) { url = ""; title = ""; tags = "" } },
                        enabled = url.isNotBlank(), loading = busy, hue = hue)
                }
            }
            if (allTags.isNotEmpty()) item(key = "tags") {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(vertical = 6.dp)) {
                    item { BoolaaChip(stringResource(R.string.filter_all), tagFilter == null, { tagFilter = null }, hue = hue) }
                    items(allTags) { t ->
                        BoolaaChip("#$t", tagFilter == t, { tagFilter = if (tagFilter == t) null else t }, hue = hue)
                    }
                }
            }
            val list = links
            when {
                list == null -> item(key = "loading") { SkeletonList() }
                list.isEmpty() -> item(key = "empty") {
                    EmptyState(BoolaaIcons.Link, stringResource(R.string.links_empty_title), stringResource(R.string.links_empty_message), hue = hue)
                }
                else -> itemsIndexed(list.filter { tagFilter == null || tagFilter in it.tags }, key = { _, it -> it.id }) { index, link ->
                    val open = { runCatching { uriHandler.openUri(link.url) }; Unit }
                    Row(
                        Modifier.animateItem(fadeInSpec = Motion.fade(), placementSpec = Motion.snappy(), fadeOutSpec = Motion.fade()).popIn(index + 1)
                            .boolaaCard(0.dp).clickableRipple(onClick = open).padding(start = 16.dp, top = 14.dp, bottom = 14.dp, end = 8.dp)
                            .testTag("link-${link.id}"),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        FeatureBadge(BoolaaIcons.Link, hue)
                        Column(Modifier.weight(1f).padding(start = 12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(link.title?.takeIf { it.isNotBlank() } ?: link.url, style = Type.headline, color = c.textPrimary, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Text(runCatching { java.net.URI(link.url).host }.getOrNull() ?: link.url, style = Type.subheadline, color = c.textSecondary,
                                maxLines = 1, overflow = TextOverflow.Ellipsis)
                            if (link.tags.isNotEmpty()) {
                                Text(link.tags.joinToString(" ") { "#$it" }, style = Type.caption, color = hue.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                            Text(displayName(link.user), style = Type.caption2, color = c.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        CircleIconButton(BoolaaIcons.Open, stringResource(R.string.open_link), open, hue = hue, size = 38.dp)
                        if (link.userId == me) {
                            CircleIconButton(BoolaaIcons.Delete, stringResource(R.string.delete), { deleting = link }, danger = true, size = 38.dp,
                                modifier = Modifier.testTag("owner-menu"))
                        } else ItemMenu(onEdit = null, onDelete = null, onReport = {
                            reporting = ReportTarget(ReportTargetType.SHARED_LINK, link.id, link.userId, link.user?.name?.takeIf { it.isNotBlank() } ?: someone)
                        })
                    }
                }
            }
        }
    }
    reporting?.let { ReportSheet(it, onDismiss = { reporting = null }) }
    deleting?.let { l ->
        ConfirmDialog(stringResource(R.string.delete_link_title), l.title ?: l.url, stringResource(R.string.delete),
            onConfirm = { vm.delete(l) }, onDismiss = { deleting = null })
    }
    ErrorDialogFor(vm)
}
