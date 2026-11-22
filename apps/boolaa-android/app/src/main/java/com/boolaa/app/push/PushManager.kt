package com.boolaa.app.push

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import com.boolaa.app.BuildConfig
import com.boolaa.app.MainActivity
import com.boolaa.app.R
import com.boolaa.app.core.BoolaaApi
import com.boolaa.app.core.DeviceIdentity
import com.boolaa.app.core.PushChannel
import com.boolaa.app.core.PushPayload
import com.boolaa.app.core.PushRouting
import com.boolaa.app.core.registerPushToken
import com.boolaa.app.core.unregisterPushToken
import com.boolaa.app.state.DeviceGate
import com.boolaa.app.state.LocaleManager
import com.boolaa.app.state.SessionState
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

/**
 * FCM client (docs/push-notifications.md §8): channels, the OS permission state, token registration with
 * `register_push_token` (every app start once the session is verified, on a new token and on a language change),
 * `unregister_push_token` before sign-out, foreground display and the tapped-notification route.
 *
 * Without `google-services.json` at build time there is no FirebaseApp: [available] is false and everything here
 * is a no-op apart from the settings screens, which keep working.
 */
class PushManager(
    private val context: Context,
    private val api: BoolaaApi,
    private val device: DeviceIdentity,
    private val scope: CoroutineScope,
    private val prefs: SharedPreferences = context.getSharedPreferences("boolaa.push", Context.MODE_PRIVATE),
) {
    /** A FirebaseApp exists (the google-services plugin ran and its ContentProvider initialised it). */
    val available: Boolean by lazy {
        runCatching { FirebaseApp.getApps(context).isNotEmpty() }.getOrDefault(false)
    }

    private val _permissionGranted = MutableStateFlow(notificationsAllowed())
    /** Notifications allowed at the OS level (POST_NOTIFICATIONS on 33+, the app switch below). */
    val permissionGranted: StateFlow<Boolean> = _permissionGranted.asStateFlow()

    private val _pendingOpen = MutableStateFlow<PushPayload?>(null)
    /** A tapped notification waiting for the main shell (survives sign-in gates). */
    val pendingOpen: StateFlow<PushPayload?> = _pendingOpen.asStateFlow()

    private val _highlight = MutableStateFlow<String?>(null)
    /** Event / food post / market item id (or [HIGHLIGHT_PENDING]) the opened screen scrolls to and highlights. */
    val highlight: StateFlow<String?> = _highlight.asStateFlow()

    /** The bubble whose chat is on screen; chat pushes for it get no banner (§8.4). */
    @Volatile var visibleChatBubble: String? = null
        private set

    private var session: SessionState? = null
    private val mutex = Mutex()
    /** `userId|token|locale` last registered by this process (re-registered on every app start, §8.2). */
    private var registeredKey: String? = null

    /** Follows the session: register once it's verified, forget the key on sign-out. */
    fun start(states: StateFlow<SessionState>) {
        scope.launch {
            states.map { Eligibility.of(it) }.distinctUntilChanged().collect { userId ->
                session = states.value
                if (userId == null) registeredKey = null else refresh()
            }
        }
    }

    /** Re-checks permission and (re-)registers if needed: app start, foreground, permission granted, new token, new language. */
    fun refresh() {
        _permissionGranted.value = notificationsAllowed()
        scope.launch { syncRegistration() }
    }

    private suspend fun syncRegistration() = mutex.withLock {
        val userId = session?.let { Eligibility.of(it) } ?: return@withLock
        if (!available) return@withLock
        val token = currentToken() ?: return@withLock
        if (!notificationsAllowed()) {
            // Blocked in system settings: stop queueing pushes this device would never show.
            if (registeredKey != null || prefs.getString(KEY_TOKEN, null) == token) runCatching { api.unregisterPushToken(token) }
            registeredKey = null
            return@withLock
        }
        val locale = LocaleManager.effective()
        val key = "$userId|$token|$locale"
        if (key == registeredKey) return@withLock
        try {
            api.registerPushToken(token, device.id, locale, BuildConfig.VERSION_NAME)
            registeredKey = key
            prefs.edit { putString(KEY_TOKEN, token) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            // Offline or not verified yet: the next start / foreground tries again.
            Log.w(TAG, "register_push_token failed", e)
        }
    }

    /** FirebaseMessagingService.onNewToken. */
    fun onNewToken(token: String) {
        prefs.edit { putString(KEY_TOKEN, token) }
        registeredKey = null
        refresh()
    }

    /** Before `signOut()`: drop this device's token (best effort, 3 s; the server also drops it with the session). */
    suspend fun unregisterBeforeSignOut() {
        val token = prefs.getString(KEY_TOKEN, null)
        registeredKey = null
        runCatching { NotificationManagerCompat.from(context).cancelAll() }
        if (!available || token == null) return
        withTimeoutOrNull(3_000) { runCatching { api.unregisterPushToken(token) } }
    }

    private suspend fun currentToken(): String? = withTimeoutOrNull(10_000) {
        suspendCancellableCoroutine { cont ->
            runCatching {
                FirebaseMessaging.getInstance().token.addOnCompleteListener { t ->
                    if (cont.isActive) cont.resume(if (t.isSuccessful) t.result else null)
                }
            }.onFailure { if (cont.isActive) cont.resume(null) }
        }
    } ?: prefs.getString(KEY_TOKEN, null)

    // Permission

    fun notificationsAllowed(): Boolean {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false
        return NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    /** Whether the runtime prompt can be shown (33+ and not yet granted); otherwise the system settings are the way. */
    val needsRuntimePrompt: Boolean get() = Build.VERSION.SDK_INT >= 33 && !notificationsAllowed()

    /** The app's notification settings page. */
    fun systemSettingsIntent(): Intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
        .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    // Channels

    /** Creates or renames the three channels in the app's language (call with an activity context after a locale change). */
    fun createChannels(localized: Context) {
        val nm = localized.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannels(PushChannel.entries.map { ch ->
            NotificationChannel(ch.id, localized.getString(channelName(ch)),
                if (ch.highImportance) NotificationManager.IMPORTANCE_HIGH else NotificationManager.IMPORTANCE_DEFAULT)
        })
    }

    private fun channelName(ch: PushChannel) = when (ch) {
        PushChannel.CHAT -> R.string.push_channel_chat
        PushChannel.BUBBLE -> R.string.push_channel_bubble
        PushChannel.EVENTS -> R.string.push_channel_events
    }

    // Receiving and opening

    /** A push while the app is in the foreground (FCM doesn't draw those): show it like the system would. */
    fun showForeground(title: String?, body: String?, data: Map<String, String>, channelId: String?, tag: String?) {
        val payload = PushPayload.from(data)
        if (!PushRouting.shouldShowInForeground(payload, visibleChatBubble)) return
        if (!notificationsAllowed()) return
        val channel = PushChannel.fromId(channelId) ?: payload?.type?.channel ?: PushChannel.BUBBLE
        val notificationTag = tag ?: data["collapse_key"] ?: payload?.tag
        val intent = Intent(context, MainActivity::class.java)
            .setAction(ACTION_OPEN_PUSH)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        data.forEach { (k, v) -> if (k in PAYLOAD_KEYS) intent.putExtra(k, v) }
        val pending = PendingIntent.getActivity(context, (notificationTag ?: "boolaa").hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(context, channel.id)
            .setSmallIcon(R.drawable.ic_stat_boolaa)
            .setColor(ContextCompat.getColor(context, R.color.brand_purple))
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(pending)
            .setPriority(if (channel.highImportance) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(notificationTag, 0, n)
        } catch (e: SecurityException) {
            Log.w(TAG, "notify refused", e)
        }
    }

    /** A tapped notification (system-drawn or ours): route once the main shell is up. */
    fun open(payload: PushPayload) { _pendingOpen.value = payload }

    fun consumeOpen(payload: PushPayload) { if (_pendingOpen.value == payload) _pendingOpen.value = null }

    fun setHighlight(id: String?) { _highlight.value = id }

    fun clearHighlight(id: String) { if (_highlight.value == id) _highlight.value = null }

    /** ChatScreen on screen for [bubbleId] (null when it leaves); also clears that bubble's delivered chat notification. */
    fun setVisibleChat(bubbleId: String?) {
        visibleChatBubble = bubbleId
        if (bubbleId != null) runCatching { NotificationManagerCompat.from(context).cancel("chat:$bubbleId", 0) }
    }

    /** Which signed-in user may register: verified device, no suspension, no pending age screen. */
    internal object Eligibility {
        fun of(s: SessionState): String? =
            s.userId?.takeIf { s.deviceGate == DeviceGate.VERIFIED && s.suspension == null && !s.needsAgeConfirmation && !s.recoveringPassword }
    }

    companion object {
        private const val TAG = "BoolaaPush"
        private const val KEY_TOKEN = "fcm_token"
        const val ACTION_OPEN_PUSH = "ro.boolaa.app.OPEN_PUSH"
        const val HIGHLIGHT_PENDING = "pending-header"
        private val PAYLOAD_KEYS = setOf(PushPayload.KEY_TYPE, PushPayload.KEY_BUBBLE, PushPayload.KEY_TARGET)
    }
}
