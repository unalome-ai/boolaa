package com.boolaa.app.ui.events

import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.boolaa.app.AppContainer
import com.boolaa.app.R
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

class EventsViewModel(private val container: AppContainer, private val bubbleId: String) : BaseViewModel() {
    private val _events = MutableStateFlow<List<BubbleEvent>?>(null)
    val events = _events.asStateFlow()

    init {
        load()
        reloadOnBlockChange(container.session) { load() }
    }

    fun load(refresh: Boolean = false) = launchCatching(trackBusy = refresh) {
        _events.value = container.api.events(bubbleId).sortedBy { it.datetime }
    }.also { it.invokeOnCompletion { if (_events.value == null) _events.value = emptyList() } }

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
    val events by vm.events.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    var editing by remember { mutableStateOf<BubbleEvent?>(null) }
    var creating by rememberSaveable { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<BubbleEvent?>(null) }
    var reporting by remember { mutableStateOf<ReportTarget?>(null) }
    val someone = stringResource(R.string.someone)
    val hue = Feature.EVENTS.hue
    val listState = rememberLazyListState()
    val confetti = remember { ConfettiState() }

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
                val mine = list.orEmpty().filter { it.creatorId == me }
                val others = list.orEmpty().filter { it.creatorId != me }
                item(key = "my-header") {
                    SectionHeader(stringResource(R.string.my_events), if (list == null) null else mine.size, hue = hue,
                        action = { AddButton(stringResource(R.string.new_event), onClick = { creating = true }, hue = hue) })
                }
                if (list == null) { item(key = "loading") { SkeletonList() }; return@LazyColumn }
                if (list.isEmpty()) {
                    item(key = "empty") {
                        EmptyState(BoolaaIcons.NewEvent, stringResource(R.string.events_empty_title), stringResource(R.string.events_empty_message), hue = hue)
                    }
                    return@LazyColumn
                }
                if (mine.isEmpty()) item(key = "my-empty") {
                    EmptyState(BoolaaIcons.NewEvent, stringResource(R.string.events_empty_title), stringResource(R.string.my_events_empty), hue = hue)
                }
                itemsIndexed(mine, key = { _, e -> e.id }) { index, e ->
                    EventCard(e, me, onRsvp = { vm.toggleRsvp(e) }, onEdit = { editing = e }, onDelete = { deleting = e }, confetti = confetti,
                        modifier = Modifier.scrollFade(listState, e.id).popIn(index + 1))
                }
                item(key = "bubble-header") { SectionHeader(stringResource(R.string.bubble_events), others.size, hue = hue) }
                if (others.isEmpty()) item(key = "bubble-empty") {
                    EmptyState(BoolaaIcons.Events, stringResource(R.string.events_empty_title), stringResource(R.string.bubble_events_empty), hue = hue)
                }
                itemsIndexed(others, key = { _, e -> e.id }) { index, e ->
                    EventCard(e, me, onRsvp = { vm.toggleRsvp(e) }, onEdit = null, onDelete = null, confetti = confetti,
                        modifier = Modifier.scrollFade(listState, e.id).popIn(mine.size + index + 2),
                        onReport = {
                            reporting = ReportTarget(ReportTargetType.EVENT, e.id, e.creatorId, e.creator?.name?.takeIf { it.isNotBlank() } ?: someone)
                        })
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
            onSave = { input -> vm.save(editing, input, me) { creating = false; editing = null } },
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
        Modifier.size(56.dp * scale, 64.dp * scale).rotate(-4f).clip(RoundedCornerShape(Radius.field)).background(hue.wash),
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
) {
    val locale = LocalConfiguration.current.locales[0]
    val c = BoolaaTheme.colors
    val going = me in event.rsvpList
    Column(modifier.boolaaCard().testTag("event-${event.id}"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.Top) {
            // The date is already in the time row below, so the tile is decoration for screen readers.
            DateTile(event.datetime, locale)
            Column(Modifier.weight(1f).padding(start = 14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text(event.title, style = Type.headline, color = c.textPrimary)
                IconLine(BoolaaIcons.Time, Formats.dateTime(event.datetime, locale))
                event.location?.takeIf { it.isNotBlank() }?.let { IconLine(BoolaaIcons.Place, it) }
                event.description?.takeIf { it.isNotBlank() }?.let { Text(it, style = Type.subheadline, color = c.textPrimary) }
            }
            if (onDelete != null || onReport != null) ItemMenu(onEdit = onEdit, onDelete = onDelete, onReport = onReport)
        }
        // The RSVP pill drops onto its own row when it does not fit (large text, long translations).
        FlowRow(
            Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp),
            itemVerticalAlignment = Alignment.CenterVertically,
        ) {
            Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                Avatar(event.creator, 24.dp)
                Text(displayName(event.creator), style = Type.subheadline, color = c.textSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(start = 6.dp).weight(1f))
                RollingCount(event.rsvpList.size) {
                    Text(pluralStringResource(R.plurals.going_count, it, it), style = Type.caption, color = c.textSecondary, maxLines = 1)
                }
            }
            RsvpPill(going, onRsvp, confetti, Modifier.testTag("rsvp-${event.id}"))
        }
    }
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
    LaunchedEffect(going) {
        if (going && !wasGoing) { Haptics.success(view); confetti?.fire(centre) }
        wasGoing = going
    }
    Row(
        modifier
            .heightIn(min = 44.dp).padding(vertical = 3.dp)
            .onGloballyPositioned { centre = it.boundsInRoot().center }
            .bounceOn(going, from = 0.9f)
            .then(if (going) Modifier.glow(mint.fill.copy(alpha = 0.4f), 10.dp, 5.dp) else Modifier)
            .clip(CircleShape)
            .background(coral.wash)
            .drawBehind { drawRect(mint.gradient, alpha = fill.coerceIn(0f, 1f)) }
            .clickableRipple(role = Role.Button) { Haptics.light(view); onClick() }
            .semantics { selected = going }
            .padding(start = 12.dp, end = 16.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        MorphIcon(if (going) BoolaaIcons.Going else BoolaaIcons.Rsvp, tint = content, modifier = Modifier.size(20.dp))
        Text(stringResource(if (going) R.string.going else R.string.rsvp), color = content, style = Type.chip, maxLines = 1)
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
        modifier.heightIn(min = 52.dp).clip(RoundedCornerShape(Radius.field)).background(BoolaaTheme.colors.field)
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
