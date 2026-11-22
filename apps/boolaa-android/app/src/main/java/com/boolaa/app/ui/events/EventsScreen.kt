package com.boolaa.app.ui.events

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
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
import com.boolaa.app.ui.components.ItemMenu
import com.boolaa.app.ui.BaseViewModel
import com.boolaa.app.ui.ErrorDialogFor
import com.boolaa.app.ui.LocalAppContainer
import com.boolaa.app.ui.components.AddRow
import com.boolaa.app.ui.components.Avatar
import com.boolaa.app.ui.components.BoolaaTextField
import com.boolaa.app.ui.components.ConfirmDialog
import com.boolaa.app.ui.components.EmptyState
import com.boolaa.app.ui.components.LoadingBox
import com.boolaa.app.ui.components.OwnerMenu
import com.boolaa.app.ui.components.PrimaryButton
import com.boolaa.app.ui.components.SectionHeader
import com.boolaa.app.ui.components.boolaaCard
import com.boolaa.app.ui.components.displayName
import com.boolaa.app.ui.theme.Brand
import com.boolaa.app.ui.theme.BoolaaTheme
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
@OptIn(ExperimentalMaterial3Api::class)
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

    PullToRefreshBox(isRefreshing = busy && events != null, onRefresh = { vm.load(refresh = true) }, modifier = Modifier.fillMaxSize().testTag("events-screen")) {
        LazyColumn(
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = Brand.tabBarClearance),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            item { AddRow(stringResource(R.string.new_event), onClick = { creating = true }) }
            val list = events
            if (list == null) { item { LoadingBox() }; return@LazyColumn }
            if (list.isEmpty()) {
                item { EmptyState(Icons.Default.CalendarMonth, stringResource(R.string.events_empty_title), stringResource(R.string.events_empty_message)) }
                return@LazyColumn
            }
            val mine = list.filter { it.creatorId == me }
            val others = list.filter { it.creatorId != me }
            item { SectionHeader(stringResource(R.string.my_events), mine.size) }
            if (mine.isEmpty()) item { Text(stringResource(R.string.my_events_empty), color = BoolaaTheme.colors.textSecondary, modifier = Modifier.boolaaCard()) }
            items(mine, key = { it.id }) { e ->
                EventCard(e, me, onRsvp = { vm.toggleRsvp(e) }, onEdit = { editing = e }, onDelete = { deleting = e })
            }
            item { SectionHeader(stringResource(R.string.bubble_events), others.size) }
            if (others.isEmpty()) item { Text(stringResource(R.string.bubble_events_empty), color = BoolaaTheme.colors.textSecondary, modifier = Modifier.boolaaCard()) }
            items(others, key = { it.id }) { e ->
                EventCard(e, me, onRsvp = { vm.toggleRsvp(e) }, onEdit = null, onDelete = null, onReport = {
                    reporting = ReportTarget(ReportTargetType.EVENT, e.id, e.creatorId, e.creator?.name?.takeIf { it.isNotBlank() } ?: someone)
                })
            }
        }
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

@Composable
fun EventCard(event: BubbleEvent, me: String, onRsvp: () -> Unit, onEdit: (() -> Unit)?, onDelete: (() -> Unit)?, onReport: (() -> Unit)? = null) {
    val locale = LocalConfiguration.current.locales[0]
    val going = me in event.rsvpList
    Column(Modifier.boolaaCard().testTag("event-${event.id}"), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(event.title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            if (onDelete != null || onReport != null) ItemMenu(onEdit = onEdit, onDelete = onDelete, onReport = onReport)
        }
        IconLine(Icons.Default.Schedule, Formats.dateTime(event.datetime, locale))
        event.location?.takeIf { it.isNotBlank() }?.let { IconLine(Icons.Default.Place, it) }
        event.description?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Avatar(event.creator, 24.dp)
            Text(displayName(event.creator), style = MaterialTheme.typography.bodySmall, color = BoolaaTheme.colors.textSecondary,
                modifier = Modifier.padding(start = 6.dp).weight(1f))
            Text(
                pluralStringResource(R.plurals.going_count, event.rsvpList.size, event.rsvpList.size),
                style = MaterialTheme.typography.labelMedium, color = BoolaaTheme.colors.textSecondary,
            )
            Spacer(Modifier.width(8.dp))
            FilterChip(
                selected = going,
                onClick = onRsvp,
                label = { Text(stringResource(if (going) R.string.going else R.string.rsvp), fontWeight = FontWeight.SemiBold) },
                leadingIcon = if (going) ({ Icon(Icons.Default.Check, contentDescription = null, modifier = Modifier.size(16.dp)) }) else null,
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = Brand.purple, selectedLabelColor = Color.White, selectedLeadingIconColor = Color.White,
                    labelColor = Brand.purple,
                ),
                modifier = Modifier.testTag("rsvp-${event.id}"),
            )
        }
    }
}

@Composable
private fun IconLine(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = Brand.purple, modifier = Modifier.size(16.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium, color = BoolaaTheme.colors.textSecondary, modifier = Modifier.padding(start = 6.dp))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EventEditor(existing: BubbleEvent?, busy: Boolean, onDismiss: () -> Unit, onSave: (EventInput) -> Unit) {
    val zone = ZoneId.systemDefault()
    val locale = LocalConfiguration.current.locales[0]
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

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = BoolaaTheme.colors.background) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).imePadding().padding(horizontal = 20.dp).padding(bottom = 32.dp)
                .testTag("event-editor"),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(stringResource(if (existing == null) R.string.new_event else R.string.edit_event), style = MaterialTheme.typography.titleLarge)
            BoolaaTextField(title, { title = it.take(120) }, stringResource(R.string.title), Modifier.testTag("event-title"))
            BoolaaTextField(description, { description = it }, stringResource(R.string.description), singleLine = false, minLines = 2)
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedButton(onClick = { pickDate = true }, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Default.CalendarMonth, contentDescription = null, tint = Brand.purple, modifier = Modifier.size(18.dp))
                    Text(Formats.date(when_.toInstant(), locale), color = Brand.purple, modifier = Modifier.padding(start = 6.dp), maxLines = 1)
                }
                OutlinedButton(onClick = { pickTime = true }, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Default.Schedule, contentDescription = null, tint = Brand.purple, modifier = Modifier.size(18.dp))
                    Text(Formats.time(when_.toInstant(), locale), color = Brand.purple, modifier = Modifier.padding(start = 6.dp), maxLines = 1)
                }
            }
            BoolaaTextField(location, { location = it }, stringResource(R.string.location))
            PrimaryButton(
                stringResource(R.string.save),
                onClick = {
                    onSave(EventInput(title.trim(), description.trim().ifEmpty { null }, when_.toInstant(), location.trim().ifEmpty { null }))
                },
                enabled = title.isNotBlank(), loading = busy, modifier = Modifier.testTag("event-save"),
            )
        }
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
                }) { Text(stringResource(R.string.ok)) }
            },
            dismissButton = { TextButton(onClick = { pickDate = false }) { Text(stringResource(R.string.cancel)) } },
        ) { DatePicker(dpState) }
    }
    if (pickTime) {
        val t = LocalTime.parse(time)
        val tpState = rememberTimePickerState(initialHour = t.hour, initialMinute = t.minute,
            is24Hour = android.text.format.DateFormat.is24HourFormat(androidx.compose.ui.platform.LocalContext.current))
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { pickTime = false },
            confirmButton = {
                TextButton(onClick = { time = LocalTime.of(tpState.hour, tpState.minute).toString(); pickTime = false }) { Text(stringResource(R.string.ok)) }
            },
            dismissButton = { TextButton(onClick = { pickTime = false }) { Text(stringResource(R.string.cancel)) } },
            text = { TimePicker(tpState) },
        )
    }
}
