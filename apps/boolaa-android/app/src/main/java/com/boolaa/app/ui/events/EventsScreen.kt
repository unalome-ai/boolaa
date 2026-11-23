package com.boolaa.app.ui.events

import com.boolaa.app.ui.shell.pushHighlight
import com.boolaa.app.ui.shell.PushHighlightScroll
import android.content.ActivityNotFoundException
import android.widget.Toast
import com.boolaa.app.core.CalendarExport
import com.boolaa.app.core.EventSchedule

import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.boolaa.app.AppContainer
import com.boolaa.app.R
import com.boolaa.app.core.FeedSpecs
import com.boolaa.app.core.keepFeedLive
import com.boolaa.app.core.EventInput
import com.boolaa.app.core.Formats
import com.boolaa.app.model.BubbleEvent
import com.boolaa.app.model.ReportTarget
import com.boolaa.app.model.ReportTargetType
import com.boolaa.app.ui.safety.ReportSheet
import com.boolaa.app.ui.BaseViewModel
import com.boolaa.app.ui.ErrorDialogFor
import com.boolaa.app.ui.LocalAppContainer
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.ZonedDateTime
import java.time.temporal.ChronoUnit
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
import androidx.compose.ui.draw.alpha
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
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.collapse
import androidx.compose.ui.semantics.expand
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
import com.boolaa.app.ui.components.fieldShell
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

class EventsViewModel(private val container: AppContainer, private val bubbleId: String) : BaseViewModel() {
    private val _events = MutableStateFlow<List<BubbleEvent>?>(null)
    val events = _events.asStateFlow()
    val reactions = reactionStore(container.api, bubbleId, com.boolaa.app.model.ReactionTarget.EVENT, _events) { it.id }

    private val cacheKey = com.boolaa.app.core.CacheKeys.events(bubbleId)
    private val serializer = kotlinx.serialization.builtins.ListSerializer(BubbleEvent.serializer())

    init {
        offlineAware(container, _events, cacheKey, serializer) { load() }
        load()
        reloadOnBlockChange(container.session) { load() }
    }

    /** Other members' inserts, edits, RSVPs and deletes stream in while the screen is shown (docs/boolaa-spec.md). */
    suspend fun keepLive() = container.api.keepFeedLive(FeedSpecs.events, bubbleId, _events, reactions) { load().join() }

    fun react(eventId: String, kind: com.boolaa.app.model.ReactionKind) =
        toggleReaction(reactions, eventId, kind, container.session.state.value.userId)

    fun load(refresh: Boolean = false) = runLoad(container, hasData = { _events.value != null }, trackBusy = refresh) {
        val loaded = container.api.events(bubbleId).sortedBy { it.datetime }
        _events.value = loaded
        saveCache(container, cacheKey, serializer, loaded)
        reactions.refresh(loaded.map { it.id })
    }

    fun save(existing: BubbleEvent?, input: EventInput, userId: String, onDone: () -> Unit) = launchCatching(onSuccess = onDone) {
        if (existing == null) container.api.createEvent(bubbleId, userId, input) else container.api.updateEvent(existing.id, input)
        load()
    }

    fun delete(event: BubbleEvent) = launchCatching {
        container.api.deleteEvent(event.id)
        _events.update { it?.filterNot { e -> e.id == event.id } }
    }

    fun toggleRsvp(event: BubbleEvent) = launchCatching(trackBusy = false) {
        val list = container.api.toggleRsvp(event.id)
        _events.update { it?.map { e -> if (e.id == event.id) e.copy(rsvpList = list) else e } }
    }
}

/** "My events" and "Bubble events", sorted by date, with create/edit/delete and RSVP (spec §7). */
@Composable
fun EventsScreen() {
    val container = LocalAppContainer.current
    val state by container.session.state.collectAsStateWithLifecycle()
    val bubble = state.currentBubble ?: return
    val me = state.userId ?: return
    val vm: EventsViewModel = viewModel(key = "events-${bubble.id}") { EventsViewModel(container, bubble.id) }
    // Resubscribed (and reloaded once live) on every reconnect and return to the front.
    val generation by container.connectivity.refresh.collectAsStateWithLifecycle()
    LaunchedEffect(vm, generation) { vm.keepLive() }
    val events by vm.events.collectAsStateWithLifecycle()
    val issue by vm.loadIssue.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val reactionRows by vm.reactions.rows.collectAsStateWithLifecycle()
    val reactionsByEvent = remember(reactionRows, me) { com.boolaa.app.core.ReactionMerge.summaries(reactionRows, me) }
    var editing by remember { mutableStateOf<BubbleEvent?>(null) }
    var creating by rememberSaveable { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<BubbleEvent?>(null) }
    var reporting by remember { mutableStateOf<ReportTarget?>(null) }
    val someone = stringResource(R.string.someone)
    val hue = Feature.EVENTS.hue
    val listState = rememberLazyListState()
    PushHighlightScroll(listState, loaded = events != null)
    val confetti = remember { ConfettiState() }
    // Ticks every 30 s so events move to "Past" while the screen is open (an event ends 1 hour after it starts).
    var now by remember { mutableStateOf(java.time.Instant.now()) }
    LaunchedEffect(Unit) {
        while (true) { kotlinx.coroutines.delay(30_000); now = java.time.Instant.now() }
    }
    var showPast by rememberSaveable { mutableStateOf(false) }

    Box(Modifier.fillMaxSize()) {
        BoolaaRefreshBox(isRefreshing = busy && events != null && !creating && editing == null, onRefresh = { vm.load(refresh = true) },
            modifier = Modifier.fillMaxSize().testTag("events-screen")) {
            LazyColumn(
                state = listState,
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 0.dp, bottom = dockClearance()),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                val list = events
                // Upcoming first (mine, then the bubble's); past events last, collapsed, without RSVP.
                val (upcoming, past) = EventSchedule.split(list.orEmpty(), now)
                val mine = upcoming.filter { it.creatorId == me }
                val others = upcoming.filter { it.creatorId != me }
                item(key = "my-header") {
                    SectionHeader(stringResource(R.string.my_events), if (list == null) null else mine.size, hue = hue,
                        action = { AddButton(stringResource(R.string.new_event), onClick = { creating = true }, hue = hue) })
                }
                item(key = "stale") { com.boolaa.app.ui.components.StaleNotice(issue, vm::retryNow) }
                if (list == null) { item(key = "loading") { com.boolaa.app.ui.components.LoadingOrFailed(issue, vm::retryNow) }; return@LazyColumn }
                if (list.isEmpty()) {
                    item(key = "empty") {
                        EmptyState(stringResource(R.string.events_empty_title), stringResource(R.string.events_empty_message), hue = hue)
                    }
                    return@LazyColumn
                }
                if (mine.isEmpty()) item(key = "my-empty") {
                    EmptyState(stringResource(R.string.events_empty_mine_title), stringResource(R.string.my_events_empty), hue = hue)
                }
                itemsIndexed(mine, key = { _, e -> e.id }) { index, e ->
                    EventCard(e, me, onRsvp = { vm.toggleRsvp(e) }, onEdit = { editing = e }, onDelete = { deleting = e }, confetti = confetti,
                        reactions = reactionsByEvent[e.id].orEmpty(), onReact = { vm.react(e.id, it) },
                        modifier = Modifier.pushHighlight(e.id).scrollFade(listState, e.id).popIn(index + 1))
                }
                item(key = "bubble-header") { SectionHeader(stringResource(R.string.bubble_events), others.size, hue = hue) }
                if (others.isEmpty()) item(key = "bubble-empty") {
                    EmptyState(stringResource(R.string.events_empty_title), stringResource(R.string.bubble_events_empty), hue = hue)
                }
                itemsIndexed(others, key = { _, e -> e.id }) { index, e ->
                    EventCard(e, me, onRsvp = { vm.toggleRsvp(e) }, onEdit = null, onDelete = null, confetti = confetti,
                        reactions = reactionsByEvent[e.id].orEmpty(), onReact = { vm.react(e.id, it) },
                        modifier = Modifier.pushHighlight(e.id).scrollFade(listState, e.id).popIn(mine.size + index + 2),
                        onReport = {
                            reporting = ReportTarget(ReportTargetType.EVENT, e.id, e.creatorId, e.creator?.name?.takeIf { it.isNotBlank() } ?: someone)
                        })
                }
                if (past.isNotEmpty()) {
                    item(key = "past-header") { PastHeader(past.size, showPast) { showPast = !showPast } }
                    if (showPast) itemsIndexed(past, key = { _, e -> e.id }) { _, e ->
                        val own = e.creatorId == me
                        EventCard(e, me, onRsvp = {}, ended = true,
                            onEdit = if (own) ({ editing = e }) else null, onDelete = if (own) ({ deleting = e }) else null,
                            reactions = reactionsByEvent[e.id].orEmpty(), onReact = { vm.react(e.id, it) },
                            modifier = Modifier.pushHighlight(e.id).alpha(0.75f),
                            onReport = if (own) null else ({
                                reporting = ReportTarget(ReportTargetType.EVENT, e.id, e.creatorId, e.creator?.name?.takeIf { it.isNotBlank() } ?: someone)
                            }))
                    }
                }
            }
        }
        ConfettiOverlay(confetti)
    }
    if (creating || editing != null) {
        EventEditor(
            existing = editing,
            busy = busy,
            onDismiss = { creating = false; editing = null },
            onSave = { input ->
                // "First" = none upcoming of yours in this bubble before the save (§8.4).
                val first = editing == null && EventSchedule.split(events.orEmpty(), java.time.Instant.now()).first.none { it.creatorId == me }
                vm.save(editing, input, me) {
                    creating = false; editing = null
                    if (first) com.boolaa.app.ui.components.CheerCenter.show(com.boolaa.app.core.Cheer.FIRST_EVENT)
                }
            },
        )
    }
    deleting?.let { e ->
        ConfirmDialog(
            title = stringResource(R.string.delete_event_title), message = e.title, confirm = stringResource(R.string.delete),
            onConfirm = { vm.delete(e) }, onDismiss = { deleting = null },
        )
    }
    reporting?.let { ReportSheet(it, onDismiss = { reporting = null }) }
    ErrorDialogFor(vm)
}

/** Tilted calendar tile: month on a coral strip, day number on coral wash. Grows with the font scale (up to 84 × 96). */
@Composable
private fun DateTile(instant: Instant, locale: java.util.Locale) {
    val hue = Feature.EVENTS.hue
    val date = instant.atZone(ZoneId.systemDefault())
    val scale = LocalDensity.current.fontScale.coerceIn(1f, 1.5f)
    Column(
        Modifier.size(56.dp * scale, 64.dp * scale).rotate(-4f).clip(RoundedCornerShape(Radius.field)).background(hue.wash)
            .clearAndSetSemantics { },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(Modifier.fillMaxWidth().background(hue.gradient).padding(vertical = 3.dp), contentAlignment = Alignment.Center) {
            Text(
                date.month.getDisplayName(java.time.format.TextStyle.SHORT, locale).uppercase(locale).trimEnd('.'),
                style = Type.caption2.copy(fontFamily = Display, fontWeight = FontWeight.Black), color = hue.onFill, maxLines = 1,
            )
        }
        Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
            Text(Formats.number(date.dayOfMonth.toLong(), locale), style = Type.title2, color = hue.text, maxLines = 1)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun EventCard(
    event: BubbleEvent, me: String, onRsvp: () -> Unit, onEdit: (() -> Unit)?, onDelete: (() -> Unit)?,
    modifier: Modifier = Modifier, confetti: ConfettiState? = null, onReport: (() -> Unit)? = null,
    reactions: List<com.boolaa.app.core.ReactionSummary> = emptyList(), onReact: ((com.boolaa.app.model.ReactionKind) -> Unit)? = null,
    /** A past event: "Ended" instead of RSVP (toggle_rsvp refuses it) and "N went". */
    ended: Boolean = false,
) {
    val locale = LocalConfiguration.current.locales[0]
    val c = BoolaaTheme.colors
    val going = me in event.rsvpList
    val picker = com.boolaa.app.ui.components.rememberReactionPicker()
    // At large font scales the date tile sits above the details so the text keeps the card's full width.
    val stacked = LocalDensity.current.fontScale >= 1.5f
    Column(modifier.boolaaCard().testTag("event-${event.id}"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        val details = @Composable { m: Modifier ->
            // Long press on the details opens the reaction picker; TalkBack reads them as one stop.
            Column(m.then(if (onReact != null) Modifier.longPressToReact(picker) else Modifier).semantics(mergeDescendants = true) { },
                verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text(event.title, style = Type.headline, color = c.textPrimary, modifier = Modifier.semantics { heading() })
                IconLine(BoolaaIcons.Time, Formats.dateTime(event.datetime, locale))
                event.location?.takeIf { it.isNotBlank() }?.let { IconLine(BoolaaIcons.Place, it) }
                event.description?.takeIf { it.isNotBlank() }?.let { Text(it, style = Type.subheadline, color = c.textPrimary) }
            }
        }
        if (stacked) {
            Row(verticalAlignment = Alignment.Top) {
                // The date is already in the time row below, so the tile is decoration for screen readers.
                DateTile(event.datetime, locale)
                Spacer(Modifier.weight(1f))
                if (onDelete != null || onReport != null) ItemMenu(onEdit = onEdit, onDelete = onDelete, onReport = onReport)
            }
            details(Modifier.fillMaxWidth())
        } else {
            Row(verticalAlignment = Alignment.Top) {
                // The date is already in the time row below, so the tile is decoration for screen readers.
                DateTile(event.datetime, locale)
                details(Modifier.weight(1f).padding(start = 14.dp))
                if (onDelete != null || onReport != null) ItemMenu(onEdit = onEdit, onDelete = onDelete, onReport = onReport)
            }
        }
        // The RSVP pill drops onto its own row when it does not fit (large text, long translations).
        FlowRow(
            Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp),
            itemVerticalAlignment = Alignment.CenterVertically,
        ) {
            // The min width makes the buttons wrap below instead of squeezing the name to "Ana A…" (fr, ro).
            Row(Modifier.weight(1f).widthIn(min = 168.dp), verticalAlignment = Alignment.CenterVertically) {
                Avatar(event.creator, 24.dp)
                Text(displayName(event.creator), style = Type.subheadline, color = c.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(start = 6.dp).weight(1f))
                RollingCount(event.rsvpList.size) {
                    Text(pluralStringResource(if (ended) R.plurals.went_count else R.plurals.going_count, it, it),
                        style = Type.caption, color = c.textSecondary, maxLines = 1)
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                AddToCalendarButton(event)
                if (ended) EndedChip(going, Modifier.testTag("rsvp-ended-${event.id}"))
                else RsvpPill(going, onRsvp, confetti, Modifier.testTag("rsvp-${event.id}"))
            }
        }
        if (onReact != null) {
            com.boolaa.app.ui.components.ReactionBar(reactions, onReact, hue = Feature.EVENTS.hue, picker = picker, tag = "reactions-${event.id}")
        }
    }
}

/** Opens the calendar app's prefilled "new event" screen (no permission; the user confirms there). */
@Composable
private fun AddToCalendarButton(event: BubbleEvent) {
    val context = LocalContext.current
    val missing = stringResource(R.string.events_no_calendar_app)
    CircleIconButton(
        BoolaaIcons.AddToCalendar, stringResource(R.string.events_add_to_calendar),
        onClick = {
            try {
                context.startActivity(CalendarExport.intent(CalendarExport.draft(event)))
            } catch (_: ActivityNotFoundException) {
                Toast.makeText(context, missing, Toast.LENGTH_SHORT).show()
            }
        },
        hue = Feature.EVENTS.hue, modifier = Modifier.testTag("calendar-${event.id}"),
    )
}

/**
 * RSVP pill. Not going: coral wash, coral text, plus-circle. Going: mint gradient, ink, check-circle and glow.
 * When the server confirms "going" the icon morphs, confetti bursts from the pill and a success haptic plays.
 */
@Composable
private fun RsvpPill(going: Boolean, onClick: () -> Unit, confetti: ConfettiState?, modifier: Modifier = Modifier) {
    val view = LocalView.current
    val coral = Feature.EVENTS.hue
    val mint = Hue.mint
    val fill by animateFloatAsState(if (going) 1f else 0f, Motion.bouncy())
    val content by animateColorAsState(if (going) mint.onFill else coral.text, Motion.fade())
    var centre by remember { mutableStateOf(Offset.Zero) }
    var wasGoing by remember { mutableStateOf(going) }
    var taps by remember { mutableStateOf(0) }
    LaunchedEffect(going) {
        // The server confirmed your RSVP: confetti and the cheer toast (which plays the success haptic, §8.4).
        if (going && !wasGoing && taps > 0) { confetti?.fire(centre); com.boolaa.app.ui.components.CheerCenter.show(com.boolaa.app.core.Cheer.GOING) }
        wasGoing = going
    }
    Row(
        modifier
            .heightIn(min = 48.dp).padding(vertical = 2.dp)
            .onGloballyPositioned { centre = it.boundsInRoot().center }
            .bounceOn(going, from = 0.9f)
            .then(if (going) Modifier.glow(mint.fill.copy(alpha = 0.4f), 10.dp, 5.dp) else Modifier)
            .clip(CircleShape)
            .background(coral.wash)
            .drawBehind { drawRect(mint.gradient, alpha = fill.coerceIn(0f, 1f)) }
            .clickableRipple(role = Role.Button) { taps++; Haptics.play(view, com.boolaa.app.core.Interaction.RSVP_TAP); onClick() }
            .semantics { selected = going }
            .padding(start = 12.dp, end = 16.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        MorphIcon(if (going) BoolaaIcons.Going else BoolaaIcons.Rsvp, tint = content, modifier = Modifier.size(20.dp))
        Text(stringResource(if (going) R.string.going else R.string.rsvp), color = content, style = Type.chip, maxLines = 1)
    }
}

/** Shown instead of the RSVP pill on a past event: not clickable. */
@Composable
private fun EndedChip(going: Boolean, modifier: Modifier = Modifier) {
    val c = BoolaaTheme.colors
    Row(
        modifier.heightIn(min = 48.dp).padding(vertical = 3.dp).clip(CircleShape).background(c.field)
            .padding(start = 12.dp, end = 16.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(if (going) BoolaaIcons.Going else BoolaaIcons.Time, contentDescription = null, tint = c.textSecondary, modifier = Modifier.size(20.dp))
        Text(stringResource(R.string.events_ended), color = c.textSecondary, style = Type.chip, maxLines = 1)
    }
}

/** "Past events (N)": tap to show or hide the past events (collapsed by default). */
@Composable
private fun PastHeader(count: Int, expanded: Boolean, onToggle: () -> Unit) {
    val c = BoolaaTheme.colors
    Row(
        Modifier.fillMaxWidth().padding(top = 12.dp).clip(RoundedCornerShape(14.dp))
            .clickableRipple(role = Role.Button) { onToggle() }
            .semantics {
                heading()
                // TalkBack: "Past events, 3, collapsed" / "expanded".
                if (expanded) collapse { onToggle(); true } else expand { onToggle(); true }
            }
            .testTag("past-events")
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(BoolaaIcons.Events, contentDescription = null, tint = c.textSecondary, modifier = Modifier.size(20.dp))
        Text(stringResource(R.string.events_past), style = Type.headline, color = c.textSecondary)
        Text(count.toString(), style = Type.caption, color = c.textSecondary,
            modifier = Modifier.clip(CircleShape).background(c.field).padding(horizontal = 8.dp, vertical = 2.dp).testTag("past-count"))
        Spacer(Modifier.weight(1f))
        Icon(BoolaaIcons.ChevronDown, contentDescription = null, tint = c.textSecondary,
            modifier = Modifier.size(20.dp).graphicsLayer { rotationZ = if (expanded) 180f else 0f })
    }
}

@Composable
private fun IconLine(icon: ImageVector, text: String) {
    val c = BoolaaTheme.colors
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = c.textSecondary, modifier = Modifier.size(16.dp))
        Text(text, style = Type.subheadline, color = c.textSecondary, modifier = Modifier.padding(start = 6.dp))
    }
}

/** A date or time row: the same shell as a text field, with the value in grape display type. */
@Composable
private fun PickerRow(icon: ImageVector, value: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier.heightIn(min = 52.dp).fieldShell(BoolaaTheme.colors)
            .clickableRipple(role = Role.Button, onClick = onClick).padding(horizontal = 14.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(icon, contentDescription = null, tint = Hue.grape.text, modifier = Modifier.size(20.dp))
        FitText(value, Type.headline, color = Hue.grape.text)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EventEditor(existing: BubbleEvent?, busy: Boolean, onDismiss: () -> Unit, onSave: (EventInput) -> Unit) {
    val zone = ZoneId.systemDefault()
    val locale = LocalConfiguration.current.locales[0]
    val hue = Feature.EVENTS.hue
    val initial = existing?.datetime?.atZone(zone)
        ?: ZonedDateTime.now(zone).plusDays(1).withHour(19).truncatedTo(ChronoUnit.HOURS)
    var title by rememberSaveable { mutableStateOf(existing?.title.orEmpty()) }
    var description by rememberSaveable { mutableStateOf(existing?.description.orEmpty()) }
    var location by rememberSaveable { mutableStateOf(existing?.location.orEmpty()) }
    var date by rememberSaveable { mutableStateOf(initial.toLocalDate().toString()) }
    var time by rememberSaveable { mutableStateOf(initial.toLocalTime().toString()) }
    var pickDate by remember { mutableStateOf(false) }
    var pickTime by remember { mutableStateOf(false) }
    val when_ = ZonedDateTime.of(LocalDate.parse(date), LocalTime.parse(time), zone)

    BoolaaSheet(onDismiss, stringResource(if (existing == null) R.string.new_event else R.string.edit_event), tag = "event-editor", spacing = 12.dp) {
        BoolaaTextField(title, { title = it.take(120) }, stringResource(R.string.title), Modifier.testTag("event-title"))
        BoolaaTextField(description, { description = it }, stringResource(R.string.description), singleLine = false, minLines = 2)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            PickerRow(BoolaaIcons.Events, Formats.date(when_.toInstant(), locale), { pickDate = true }, Modifier.weight(1.3f))
            PickerRow(BoolaaIcons.Time, Formats.time(when_.toInstant(), locale), { pickTime = true }, Modifier.weight(1f))
        }
        BoolaaTextField(location, { location = it }, stringResource(R.string.location))
        PrimaryButton(
            stringResource(R.string.save),
            onClick = {
                onSave(EventInput(title.trim(), description.trim().ifEmpty { null }, when_.toInstant(), location.trim().ifEmpty { null }))
            },
            enabled = title.isNotBlank(), loading = busy, hue = hue, modifier = Modifier.padding(top = 4.dp).testTag("event-save"),
        )
    }
    if (pickDate) {
        val dpState = rememberDatePickerState(
            initialSelectedDateMillis = LocalDate.parse(date).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli(),
        )
        DatePickerDialog(
            onDismissRequest = { pickDate = false },
            confirmButton = {
                TextButton(onClick = {
                    dpState.selectedDateMillis?.let { date = Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString() }
                    pickDate = false
                }) { Text(stringResource(R.string.ok), style = Type.headline) }
            },
            dismissButton = { TextButton(onClick = { pickDate = false }) { Text(stringResource(R.string.cancel), style = Type.headline) } },
        ) { DatePicker(dpState) }
    }
    if (pickTime) {
        val t = LocalTime.parse(time)
        val tpState = rememberTimePickerState(initialHour = t.hour, initialMinute = t.minute,
            is24Hour = android.text.format.DateFormat.is24HourFormat(LocalContext.current))
        AlertDialog(
            onDismissRequest = { pickTime = false },
            confirmButton = {
                TextButton(onClick = { time = LocalTime.of(tpState.hour, tpState.minute).toString(); pickTime = false }) { Text(stringResource(R.string.ok), style = Type.headline) }
            },
            dismissButton = { TextButton(onClick = { pickTime = false }) { Text(stringResource(R.string.cancel), style = Type.headline) } },
            text = { TimePicker(tpState) },
        )
    }
}
