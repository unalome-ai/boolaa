package com.boolaa.app.ui.settings

import android.Manifest
import android.content.Context
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.NotificationsOff
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.edit
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.boolaa.app.AppContainer
import com.boolaa.app.R
import com.boolaa.app.core.BubbleMute
import com.boolaa.app.core.Formats
import com.boolaa.app.core.MuteOption
import com.boolaa.app.core.NotificationPrefs
import com.boolaa.app.core.PrefKey
import com.boolaa.app.core.bubbleMute
import com.boolaa.app.core.muteBubble
import com.boolaa.app.core.notificationPrefs
import com.boolaa.app.core.saveNotificationPrefs
import com.boolaa.app.core.unmuteBubble
import com.boolaa.app.ui.BaseViewModel
import com.boolaa.app.ui.ErrorDialogFor
import com.boolaa.app.ui.LocalAppContainer
import com.boolaa.app.ui.components.BoolaaChip
import com.boolaa.app.ui.components.BoolaaIcons
import com.boolaa.app.ui.components.CircleIconButton
import com.boolaa.app.ui.components.FeatureBadge
import com.boolaa.app.ui.components.FitText
import com.boolaa.app.ui.components.PrimaryButton
import com.boolaa.app.ui.components.SecondaryButton
import com.boolaa.app.ui.components.boolaaCard
import com.boolaa.app.ui.theme.BoolaaTheme
import com.boolaa.app.ui.theme.Hue
import com.boolaa.app.ui.theme.Type
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.time.Instant

// Settings → Notifications (account level) and Bubble settings → Mute (docs/push-notifications.md §9).

class NotificationsViewModel(private val container: AppContainer) : BaseViewModel() {
    private val _prefs = MutableStateFlow<NotificationPrefs?>(null)
    val prefs = _prefs.asStateFlow()
    private val userId get() = container.session.state.value.userId

    init { load() }

    fun load() = launchCatching { userId?.let { _prefs.value = container.api.notificationPrefs(it) } }

    /** Optimistic toggle; on failure the saved row is read back. */
    fun set(key: PrefKey, value: Boolean) {
        val me = userId ?: return
        val next = key.set(_prefs.value ?: NotificationPrefs(), value)
        _prefs.value = next
        launchCatching(trackBusy = false) {
            try { container.api.saveNotificationPrefs(me, next) } catch (e: Throwable) { load(); throw e }
        }
    }
}

class MuteViewModel(private val container: AppContainer, private val bubbleId: String) : BaseViewModel() {
    private val _mute = MutableStateFlow<BubbleMute?>(null)
    val mute = _mute.asStateFlow()
    private val userId get() = container.session.state.value.userId

    init { load() }

    fun load() = launchCatching(trackBusy = false) { userId?.let { _mute.value = container.api.bubbleMute(it, bubbleId) } }

    fun mute(option: MuteOption) = launchCatching(trackBusy = false) {
        val me = userId ?: return@launchCatching
        val until = option.until(Instant.now())
        container.api.muteBubble(me, bubbleId, until)
        _mute.value = BubbleMute(me, bubbleId, until?.toString())
    }

    fun unmute() = launchCatching(trackBusy = false) {
        val me = userId ?: return@launchCatching
        container.api.unmuteBubble(me, bubbleId)
        _mute.value = null
    }
}

/** Whether the "Turn on notifications" step is still a runtime prompt (33+, never asked) or the system settings. */
private const val PREFS = "boolaa.push"
private const val KEY_ASKED = "permission_asked"
private const val KEY_CARD_DISMISSED = "permission_card_dismissed"

private fun Context.pushPrefs() = getSharedPreferences(PREFS, Context.MODE_PRIVATE)

/**
 * Asks for notification permission from a click: the runtime prompt the first time on Android 13+, else the app's
 * notification settings (denied before, or switched off on older Android). [onResult] gets the new state.
 */
@Composable
fun rememberNotificationPermissionAsk(onResult: (Boolean) -> Unit = {}): () -> Unit {
    val context = LocalContext.current
    val push = LocalAppContainer.current.push
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        push.refresh()
        onResult(granted)
    }
    return {
        val asked = context.pushPrefs().getBoolean(KEY_ASKED, false)
        if (Build.VERSION.SDK_INT >= 33 && push.needsRuntimePrompt && !asked) {
            context.pushPrefs().edit { putBoolean(KEY_ASKED, true) }
            launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            context.startActivity(push.systemSettingsIntent())
        }
    }
}

/** Settings → Notifications: OS permission state, master switch, one switch per type, message previews. */
@Composable
fun NotificationsScreen(onBack: () -> Unit) {
    val container = LocalAppContainer.current
    val vm: NotificationsViewModel = viewModel(key = "notification-prefs") { NotificationsViewModel(container) }
    val prefs by vm.prefs.collectAsStateWithLifecycle()
    val granted by container.push.permissionGranted.collectAsStateWithLifecycle()
    val ask = rememberNotificationPermissionAsk()
    // Back from the system settings: read the permission again.
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { container.push.refresh() }
    val c = BoolaaTheme.colors

    Column(Modifier.fillMaxSize().statusBarsPadding().testTag("notifications-screen")) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            CircleIconButton(BoolaaIcons.Back, stringResource(R.string.back), onBack, Modifier.testTag("notifications-back"), surface = true, size = 44.dp)
            FitText(stringResource(R.string.notifications_title), Type.title, color = c.textPrimary,
                modifier = Modifier.padding(start = 12.dp).semantics { heading() })
        }
        LazyColumn(
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 40.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            if (!container.push.available) {
                item(key = "unavailable") {
                    Text(stringResource(R.string.notifications_unavailable), style = Type.subheadline, color = c.textSecondary,
                        modifier = Modifier.boolaaCard().testTag("notifications-unavailable"))
                }
            } else if (!granted) {
                item(key = "blocked") {
                    Column(Modifier.boolaaCard().testTag("notifications-blocked"), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            FeatureBadge(Icons.Rounded.NotificationsOff, Hue.coral, size = 34.dp)
                            Text(stringResource(R.string.notifications_blocked), style = Type.subheadline, color = c.textPrimary,
                                modifier = Modifier.padding(start = 12.dp).weight(1f))
                        }
                        val needsPrompt = Build.VERSION.SDK_INT >= 33 && !LocalContext.current.pushPrefs().getBoolean(KEY_ASKED, false)
                        PrimaryButton(stringResource(if (needsPrompt) R.string.notifications_ask else R.string.notifications_open_settings), onClick = ask,
                            modifier = Modifier.testTag("notifications-ask"))
                    }
                }
            }
            item(key = "prefs") {
                val p = prefs ?: NotificationPrefs()
                Column(Modifier.boolaaCard(padding = 8.dp).testTag("notification-prefs")) {
                    PrefSwitch(stringResource(R.string.notifications_enabled), p.enabled, enabled = prefs != null, strong = true,
                        tag = "pref-enabled") { vm.set(PrefKey.ENABLED, it) }
                    HorizontalDivider(color = c.hairline)
                    val sub = prefs != null && p.enabled
                    listOf(
                        PrefKey.CHAT to R.string.notifications_chat,
                        PrefKey.JOIN_REQUESTS to R.string.notifications_join_requests,
                        PrefKey.APPROVALS to R.string.notifications_approvals,
                        PrefKey.NEW_EVENTS to R.string.notifications_new_events,
                        PrefKey.EVENT_REMINDERS to R.string.notifications_event_reminders,
                        PrefKey.FOOD to R.string.notifications_food,
                        PrefKey.MARKET to R.string.notifications_market,
                    ).forEach { (key, label) ->
                        PrefSwitch(stringResource(label), key.get(p), enabled = sub, tag = "pref-${key.column}") { vm.set(key, it) }
                    }
                }
            }
            item(key = "preview") {
                val p = prefs ?: NotificationPrefs()
                Column(Modifier.boolaaCard(padding = 8.dp)) {
                    PrefSwitch(stringResource(R.string.notifications_preview), p.previewContent, enabled = prefs != null && p.enabled,
                        tag = "pref-preview_content") { vm.set(PrefKey.PREVIEW, it) }
                    // The current bubble's name (user content), like the push itself; "Boolaa" without one.
                    val sessionState by LocalAppContainer.current.session.state.collectAsStateWithLifecycle()
                    Text(stringResource(R.string.notifications_preview_hint, sessionState.currentBubble?.name ?: "Boolaa"),
                        style = Type.caption, color = c.textSecondary,
                        modifier = Modifier.padding(start = 8.dp, end = 8.dp, bottom = 8.dp).testTag("notifications-preview-hint"))
                }
            }
        }
    }
    ErrorDialogFor(vm)
}

@Composable
private fun PrefSwitch(label: String, checked: Boolean, enabled: Boolean, tag: String, strong: Boolean = false, onChange: (Boolean) -> Unit) {
    val c = BoolaaTheme.colors
    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = if (strong) Type.headline else Type.body.copy(fontWeight = FontWeight.Medium),
            color = if (enabled) c.textPrimary else c.textSecondary, modifier = Modifier.weight(1f).padding(end = 12.dp))
        Switch(checked, onCheckedChange = onChange, enabled = enabled, modifier = Modifier.testTag(tag),
            colors = SwitchDefaults.colors(checkedTrackColor = Hue.grape.fill, checkedThumbColor = Hue.grape.onFill))
    }
}

/** Bubble settings: mute this bubble for 1 h / 8 h / 1 week / until unmuted, or show until when and Unmute. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MuteCard(bubbleId: String, modifier: Modifier = Modifier) {
    val container = LocalAppContainer.current
    val vm: MuteViewModel = viewModel(key = "mute-$bubbleId") { MuteViewModel(container, bubbleId) }
    val mute by vm.mute.collectAsStateWithLifecycle()
    val c = BoolaaTheme.colors
    val locale = LocalConfiguration.current.locales[0]
    val active = mute?.takeIf { it.isActive(Instant.now()) }
    Column(modifier.boolaaCard().testTag("mute-card"), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            FeatureBadge(if (active != null) Icons.Rounded.NotificationsOff else Icons.Rounded.Notifications, Hue.indigo, size = 34.dp)
            Column(Modifier.padding(start = 12.dp).weight(1f)) {
                Text(stringResource(R.string.mute_title), style = Type.headline, color = c.textPrimary)
                if (active != null) {
                    val text = active.untilInstant?.let { stringResource(R.string.mute_until, Formats.dateTime(it, locale)) }
                        ?: stringResource(R.string.mute_muted_forever)
                    Text(text, style = Type.caption, color = c.textSecondary, modifier = Modifier.testTag("mute-status"))
                }
            }
        }
        if (active != null) {
            SecondaryButton(stringResource(R.string.mute_unmute), onClick = vm::unmute, modifier = Modifier.fillMaxWidth().testTag("mute-unmute"))
        } else {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                MuteOption.entries.forEach { option ->
                    val label = stringResource(when (option) {
                        MuteOption.HOUR -> R.string.mute_1h
                        MuteOption.EIGHT_HOURS -> R.string.mute_8h
                        MuteOption.WEEK -> R.string.mute_1w
                        MuteOption.FOREVER -> R.string.mute_forever
                    })
                    BoolaaChip(label, active = false, onClick = { vm.mute(option) }, hue = Hue.indigo,
                        modifier = Modifier.testTag("mute-${option.name.lowercase()}"))
                }
            }
        }
    }
    ErrorDialogFor(vm)
}

/**
 * Home: a dismissible "Turn on notifications" card while the OS permission is missing (never a prompt at launch:
 * the system dialog only opens from the button).
 */
@Composable
fun NotificationsAskCard(modifier: Modifier = Modifier) {
    val container = LocalAppContainer.current
    val context = LocalContext.current
    val granted by container.push.permissionGranted.collectAsStateWithLifecycle()
    var dismissed by remember { mutableStateOf(context.pushPrefs().getBoolean(KEY_CARD_DISMISSED, false)) }
    LaunchedEffect(Unit) { container.push.refresh() }
    if (!container.push.available || granted || dismissed) return
    val ask = rememberNotificationPermissionAsk { if (it) dismissed = true }
    val c = BoolaaTheme.colors
    Column(modifier.boolaaCard().testTag("notifications-ask-card"), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            FeatureBadge(Icons.Rounded.Notifications, Hue.grape, size = 34.dp)
            Text(stringResource(R.string.notifications_ask_hint), style = Type.subheadline, color = c.textPrimary,
                modifier = Modifier.padding(start = 12.dp).weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SecondaryButton(stringResource(R.string.notifications_not_now), onClick = {
                context.pushPrefs().edit { putBoolean(KEY_CARD_DISMISSED, true) }
                dismissed = true
            }, modifier = Modifier.weight(1f).testTag("notifications-not-now"))
            PrimaryButton(stringResource(R.string.notifications_ask), onClick = ask, modifier = Modifier.weight(1f).testTag("notifications-ask-card-button"))
        }
    }
}
