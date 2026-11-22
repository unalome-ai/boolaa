package com.boolaa.app.ui.links

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Link
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.boolaa.app.AppContainer
import com.boolaa.app.R
import com.boolaa.app.model.SharedLink
import com.boolaa.app.model.ReportTarget
import com.boolaa.app.model.ReportTargetType
import com.boolaa.app.ui.safety.ReportSheet
import com.boolaa.app.ui.components.ItemMenu
import com.boolaa.app.ui.BaseViewModel
import com.boolaa.app.ui.ErrorDialogFor
import com.boolaa.app.ui.LocalAppContainer
import com.boolaa.app.ui.components.BoolaaChip
import com.boolaa.app.ui.components.BoolaaTextField
import com.boolaa.app.ui.components.CircleIconButton
import com.boolaa.app.ui.components.ConfirmDialog
import com.boolaa.app.ui.components.EmptyState
import com.boolaa.app.ui.components.LoadingBox
import com.boolaa.app.ui.components.OwnerMenu
import com.boolaa.app.ui.components.PrimaryButton
import com.boolaa.app.ui.components.boolaaCard
import com.boolaa.app.ui.components.clickableRipple
import com.boolaa.app.ui.components.displayName
import com.boolaa.app.ui.theme.Brand
import com.boolaa.app.ui.theme.BoolaaTheme
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

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

    Column(Modifier.fillMaxSize().background(BoolaaTheme.colors.background).statusBarsPadding().imePadding().testTag("links-screen")) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            CircleIconButton(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back), onBack)
            Column(Modifier.padding(start = 12.dp)) {
                Text(stringResource(R.string.links), style = MaterialTheme.typography.headlineSmall, modifier = Modifier.testTag("screen-title"))
                Text(bubble.name, style = MaterialTheme.typography.bodyMedium, color = Brand.purple)
            }
        }
        LazyColumn(
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 40.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Column(Modifier.boolaaCard(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(stringResource(R.string.add_link), style = MaterialTheme.typography.titleMedium)
                    BoolaaTextField(url, { url = it }, stringResource(R.string.url), Modifier.testTag("link-url"),
                        keyboardType = androidx.compose.ui.text.input.KeyboardType.Uri)
                    BoolaaTextField(title, { title = it }, stringResource(R.string.title))
                    BoolaaTextField(tags, { tags = it }, stringResource(R.string.tags_hint))
                    PrimaryButton(stringResource(R.string.add), onClick = { vm.add(url, title, tags) { url = ""; title = ""; tags = "" } },
                        enabled = url.isNotBlank(), loading = busy)
                }
            }
            if (allTags.isNotEmpty()) item {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    item { BoolaaChip(stringResource(R.string.filter_all), tagFilter == null, Modifier.clip(CircleShape).clickableRipple { tagFilter = null }) }
                    items(allTags) { t ->
                        BoolaaChip("#$t", tagFilter == t, Modifier.clip(CircleShape).clickableRipple { tagFilter = if (tagFilter == t) null else t })
                    }
                }
            }
            val list = links
            when {
                list == null -> item { LoadingBox() }
                list.isEmpty() -> item { EmptyState(Icons.Default.Link, stringResource(R.string.links_empty_title), stringResource(R.string.links_empty_message)) }
                else -> items(list.filter { tagFilter == null || tagFilter in it.tags }, key = { it.id }) { link ->
                    Row(
                        Modifier.clip(RoundedCornerShape(Brand.cardRadius)).clickableRipple { runCatching { uriHandler.openUri(link.url) } }
                            .boolaaCard().testTag("link-${link.id}"),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = stringResource(R.string.open_link), tint = Brand.purple)
                        Column(Modifier.weight(1f).padding(start = 12.dp)) {
                            Text(link.title?.takeIf { it.isNotBlank() } ?: link.url, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Text(link.url, style = MaterialTheme.typography.bodySmall, color = Brand.purple, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            val meta = (link.tags.map { "#$it" } + displayName(link.user)).joinToString(" · ")
                            Text(meta, style = MaterialTheme.typography.bodySmall, color = BoolaaTheme.colors.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        if (link.userId == me) OwnerMenu(onEdit = null, onDelete = { deleting = link })
                        else ItemMenu(onEdit = null, onDelete = null, onReport = {
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
