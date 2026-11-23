package com.boolaa.app.ui.search

import android.util.Log
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.boolaa.app.AppContainer
import com.boolaa.app.R
import com.boolaa.app.core.Formats
import com.boolaa.app.core.SearchHit
import com.boolaa.app.core.SearchKind
import com.boolaa.app.core.SearchRules
import com.boolaa.app.core.UserFacingError
import com.boolaa.app.core.highlightRanges
import com.boolaa.app.state.SecurityEvents
import com.boolaa.app.ui.LocalAppContainer
import com.boolaa.app.ui.components.BoolaaIcons
import com.boolaa.app.ui.components.CircleIconButton
import com.boolaa.app.ui.components.EmptyState
import com.boolaa.app.ui.components.SecondaryButton
import com.boolaa.app.ui.components.boolaaCard
import com.boolaa.app.ui.components.clickableRipple
import com.boolaa.app.ui.theme.BoolaaTheme
import com.boolaa.app.ui.theme.Feature
import com.boolaa.app.ui.theme.Hue
import com.boolaa.app.ui.theme.Motion
import com.boolaa.app.ui.theme.Type
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** What the search screen shows. */
sealed interface SearchUiState {
    /** Empty field: the hint. */
    data object Idle : SearchUiState
    /** One character: "Type at least 2 characters". */
    data object TooShort : SearchUiState
    /** A request in flight; [previous] results stay on screen under the progress indicator. */
    data class Loading(val query: String, val previous: List<SearchHit>?) : SearchUiState
    data class Results(val query: String, val hits: List<SearchHit>) : SearchUiState
    data class Failed(val query: String) : SearchUiState
}

/**
 * Search in one bubble (`search_bubble`). Input is debounced 300 ms; each new query cancels the request in flight,
 * so only the latest query's result is ever shown.
 */
class SearchViewModel(private val container: AppContainer, private val bubbleId: String) : ViewModel() {
    private val _state = MutableStateFlow<SearchUiState>(SearchUiState.Idle)
    val state = _state.asStateFlow()
    private var job: Job? = null
    private var query = ""

    fun onQueryChange(text: String) { query = text; run(SearchRules.DEBOUNCE_MS, force = false) }
    /** IME Search: run now (unless that query is already shown or loading). */
    fun submit() = run(0, force = false)
    fun retry() = run(0, force = true)

    private fun run(delayMs: Long, force: Boolean) {
        val q = query.trim()
        val current = _state.value
        if (!SearchRules.canSearch(q)) {
            job?.cancel()
            _state.value = if (q.isEmpty()) SearchUiState.Idle else SearchUiState.TooShort
            return
        }
        // Only whitespace changed: keep what's shown (or loading) for the same query.
        if (!force && ((current is SearchUiState.Results && current.query == q) || (current is SearchUiState.Loading && current.query == q))) return
        job?.cancel()
        val previous = (current as? SearchUiState.Results)?.hits ?: (current as? SearchUiState.Loading)?.previous
        job = viewModelScope.launch {
            delay(delayMs)
            _state.value = SearchUiState.Loading(q, previous)
            try {
                _state.value = SearchUiState.Results(q, container.api.searchBubble(bubbleId, q))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                Log.w("Boolaa", "search failed", e)
                SecurityEvents.emitFor(UserFacingError.classify(e))
                _state.value = SearchUiState.Failed(q)
            }
        }
    }
}

/** Feature colour, icon and label of a hit's kind (chat grape, events coral, food tangerine, market mint, links sky). */
private data class KindStyle(val hue: Hue, val icon: ImageVector, val label: Int)

private fun styleOf(kind: SearchKind): KindStyle = when (kind) {
    SearchKind.CHAT_MESSAGE -> KindStyle(Feature.CHAT.hue, BoolaaIcons.Chat, R.string.search_kind_message)
    SearchKind.EVENT -> KindStyle(Feature.EVENTS.hue, BoolaaIcons.Events, R.string.search_kind_event)
    SearchKind.FOOD_POST -> KindStyle(Feature.FOOD.hue, BoolaaIcons.Food, R.string.search_kind_food)
    SearchKind.MARKET_ITEM -> KindStyle(Feature.MARKET.hue, BoolaaIcons.Market, R.string.search_kind_item)
    SearchKind.SHARED_LINK -> KindStyle(Feature.LINKS.hue, BoolaaIcons.Link, R.string.search_kind_link)
}

/**
 * Full-screen search for the current bubble (docs/boolaa-spec.md "Search"). [onOpen] gets the tapped hit; the shell
 * closes search and opens it in context. Switching bubble gives a fresh, empty search.
 */
@Composable
fun SearchScreen(onBack: () -> Unit, onOpen: (SearchHit) -> Unit) {
    val container = LocalAppContainer.current
    val session by container.session.state.collectAsStateWithLifecycle()
    val bubble = session.currentBubble ?: return
    val vm: SearchViewModel = viewModel(key = "search-${bubble.id}") { SearchViewModel(container, bubble.id) }
    val state by vm.state.collectAsStateWithLifecycle()
    var text by rememberSaveable(bubble.id) { mutableStateOf("") }
    val focus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    val c = BoolaaTheme.colors
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }

    Column(Modifier.fillMaxSize().statusBarsPadding().imePadding().testTag("search-screen")) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            CircleIconButton(BoolaaIcons.Back, stringResource(R.string.back), onBack, Modifier.testTag("search-back"), surface = true, size = 44.dp)
            val source = remember { MutableInteractionSource() }
            val focused by source.collectIsFocusedAsState()
            val ring by animateColorAsState(if (focused) Hue.grape.fill else c.hairline, Motion.fade())
            val shape = RoundedCornerShape(24.dp)
            val clearLabel = stringResource(R.string.search_clear)
            TextField(
                value = text,
                onValueChange = { text = it; vm.onQueryChange(it) },
                placeholder = {
                    Text(stringResource(R.string.search_placeholder, bubble.name), style = Type.body, color = c.textSecondary,
                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                },
                leadingIcon = { Icon(BoolaaIcons.Search, contentDescription = null, tint = c.textSecondary) },
                trailingIcon = if (text.isEmpty()) null else ({
                    Box(
                        Modifier.size(48.dp).clickableRipple(scale = 0.88f, role = Role.Button) {
                            text = ""; vm.onQueryChange(""); runCatching { focus.requestFocus() }
                        }.semantics { contentDescription = clearLabel }.testTag("search-clear"),
                        contentAlignment = Alignment.Center,
                    ) { Icon(BoolaaIcons.Close, contentDescription = null, tint = c.textSecondary, modifier = Modifier.size(20.dp)) }
                }),
                singleLine = true,
                textStyle = Type.body,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { vm.submit(); keyboard?.hide() }),
                interactionSource = source,
                shape = shape,
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = c.card, unfocusedContainerColor = c.card,
                    focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent, cursorColor = Hue.grape.fill,
                    focusedTextColor = c.textPrimary, unfocusedTextColor = c.textPrimary,
                ),
                modifier = Modifier.weight(1f).padding(start = 12.dp).border(if (focused) 2.dp else 1.dp, ring, shape)
                    .focusRequester(focus).testTag("search-input"),
            )
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when (val s = state) {
                SearchUiState.Idle -> Note(stringResource(R.string.search_hint), "search-hint")
                SearchUiState.TooShort -> Note(stringResource(R.string.search_min_length), "search-min-length")
                is SearchUiState.Failed -> Column(
                    Modifier.fillMaxWidth().padding(24.dp).testTag("search-error"),
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Text(stringResource(R.string.search_error), style = Type.body, color = c.textPrimary, textAlign = TextAlign.Center,
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                    SecondaryButton(stringResource(R.string.search_retry), onClick = vm::retry, modifier = Modifier.testTag("search-retry"))
                }
                is SearchUiState.Loading -> {
                    if (s.previous != null) Results(s.previous, loading = true, onOpen = onOpen)
                    else Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.TopCenter) { Spinner() }
                }
                is SearchUiState.Results -> {
                    if (s.hits.isEmpty()) {
                        EmptyState(
                            BoolaaIcons.Search, stringResource(R.string.search_no_results, s.query), stringResource(R.string.search_no_results_hint),
                            Modifier.padding(16.dp).semantics { liveRegion = LiveRegionMode.Polite }.testTag("search-empty"),
                        )
                    } else Results(s.hits, loading = false, onOpen = onOpen)
                }
            }
        }
    }
}

@Composable
private fun Spinner(modifier: Modifier = Modifier) =
    CircularProgressIndicator(color = Hue.grape.fill, strokeWidth = 2.5.dp, modifier = modifier.size(22.dp).testTag("search-loading"))

@Composable
private fun Note(text: String, tag: String) {
    Text(
        text, style = Type.subheadline, color = BoolaaTheme.colors.textSecondary, textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 24.dp).testTag(tag),
    )
}

@Composable
private fun Results(hits: List<SearchHit>, loading: Boolean, onOpen: (SearchHit) -> Unit) {
    val count = pluralStringResource(R.plurals.search_results, hits.size, hits.size)
    LazyColumn(
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
        modifier = Modifier.fillMaxSize().navigationBarsPadding().testTag("search-results"),
    ) {
        item(key = "count") {
            Row(Modifier.fillMaxWidth().height(28.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                // Announced politely to TalkBack whenever the count changes.
                Text(count, style = Type.caption2, color = BoolaaTheme.colors.textSecondary,
                    modifier = Modifier.weight(1f).semantics { liveRegion = LiveRegionMode.Polite }.testTag("search-count"))
                if (loading) Spinner(Modifier.size(18.dp))
            }
        }
        items(hits, key = { "${it.kind.wire}-${it.id}" }) { hit -> ResultRow(hit) { onOpen(hit) } }
    }
}

/** [text] with every match of [words] in bold on the kind's wash. */
private fun highlighted(text: String, words: List<String>, wash: Color): AnnotatedString = buildAnnotatedString {
    append(text)
    highlightRanges(text, words).forEach { r -> addStyle(SpanStyle(fontWeight = FontWeight.Bold, background = wash), r.first, r.last + 1) }
}

@Composable
private fun ResultRow(hit: SearchHit, onClick: () -> Unit) {
    val c = BoolaaTheme.colors
    val style = styleOf(hit.kind)
    val kindLabel = stringResource(style.label)
    val locale = LocalConfiguration.current.locales[0]
    val author = hit.authorName?.takeIf { it.isNotBlank() } ?: stringResource(R.string.someone)
    val title = hit.title?.takeIf { it.isNotBlank() }
    // Chat messages and food posts have no title: the author is the first line.
    val titleIsAuthor = hit.kind == SearchKind.CHAT_MESSAGE || hit.kind == SearchKind.FOOD_POST || title == null
    val line1 = if (titleIsAuthor) author else title!!
    val snippet = hit.snippet?.takeIf { it.isNotBlank() }
    val date = if (hit.kind == SearchKind.EVENT && hit.eventAt != null) Formats.dateTime(hit.eventAt, locale) else Formats.relative(hit.createdAt, locale)
    val meta = listOfNotNull(kindLabel, author.takeUnless { titleIsAuthor }, date).joinToString(" · ")
    val description = listOfNotNull(kindLabel, line1, snippet, date).joinToString(", ")
    val wash = style.hue.wash
    Row(
        Modifier.boolaaCard(0.dp)
            .clickableRipple(scale = 0.98f, role = Role.Button, onClick = onClick)
            .testTag("search-result-${hit.id}")
            .clearAndSetSemantics { contentDescription = description; role = Role.Button; onClick { onClick(); true } }
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(40.dp).background(style.hue.gradient, CircleShape), contentAlignment = Alignment.Center) {
            Icon(style.icon, contentDescription = null, tint = style.hue.onFill, modifier = Modifier.size(20.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                if (titleIsAuthor) AnnotatedString(line1) else highlighted(line1, hit.matchedWords, wash),
                style = Type.headline, color = c.textPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
            if (snippet != null) {
                Text(highlighted(snippet, hit.matchedWords, wash), style = Type.subheadline, color = c.textPrimary,
                    maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            Text(meta, style = Type.caption2, color = c.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}
