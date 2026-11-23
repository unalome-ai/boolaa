package com.boolaa.app

import android.content.Context
import coil3.SingletonImageLoader
import com.boolaa.app.core.Backend
import com.boolaa.app.core.BoolaaApi
import com.boolaa.app.core.ChatImageUrls
import com.boolaa.app.core.ChatOutbox
import com.boolaa.app.core.ConnectivityMonitor
import com.boolaa.app.core.DeviceIdentity
import com.boolaa.app.core.OfflineCache
import com.boolaa.app.core.OutboxRules
import com.boolaa.app.core.PendingMessage
import com.boolaa.app.core.PhotoUrls
import com.boolaa.app.model.ChatMessage
import com.boolaa.app.push.PushManager
import com.boolaa.app.state.SessionStore
import com.boolaa.app.state.UnreadStore
import io.github.jan.supabase.postgrest.exception.PostgrestRestException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.TimeUnit

/** Manual DI: one Supabase client, one API and one SessionStore per process. */
class AppContainer(context: Context) {
    private val appContext = context.applicationContext
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    /** Offline / unreachable / online, "Back online", and the refetch generation (docs/boolaa-spec.md "Offline and poor network"). */
    val connectivity = ConnectivityMonitor(appScope, probe = ::probeHealth)
    val api = BoolaaApi(Backend.createClient(
        onNetworkResult = { ok -> connectivity.report(ok) },
        simulatedOffline = { connectivity.simulatedOffline },
    ))
    /** The last loaded data of each main screen, per user (cacheDir/offline). */
    val offlineCache = OfflineCache(File(context.cacheDir, "offline"))
    /** Chat messages written offline or on a bad network (filesDir/outbox). */
    val outbox = ChatOutbox(File(context.filesDir, "outbox"), appScope, isOnline = { connectivity.isOnline }, attempt = ::deliverMessage)

    /** This install's device id for device verification (docs/auth-security.md §2). */
    val device = DeviceIdentity.create(context)
    val session = SessionStore(
        api = api,
        prefs = context.getSharedPreferences("boolaa", Context.MODE_PRIVATE),
        scope = appScope,
        device = device,
        offlineCache = offlineCache,
    )
    /** Unread chat badges (chat_unread_counts) for the bubble chips and the chat button. */
    val unread = UnreadStore(api, session, appScope)
    /** Signed URLs for every private photo bucket, batched and cached per path (Coil's PhotoUrlInterceptor). */
    val photoUrls = PhotoUrls(sign = { bucket, paths -> api.signedImageUrls(bucket, paths) })
    /** FCM token registration, channels and tapped-notification routing (docs/push-notifications.md §8). */
    val push = PushManager(context.applicationContext, api, device, appScope).also { p ->
        session.beforeSignOut = { p.unregisterBeforeSignOut(); photoUrls.reset() }
        session.onLocaleChanged = { p.refresh() }
    }
    /** Signed `chat.images` URLs, cached per path for their hour. */
    val chatImages = ChatImageUrls(api)

    init {
        session.onSignedIn = { userId -> outbox.restore(userId) }
        // Privacy: nothing of one account is left for the next (cache, unsent messages, decoded photos).
        session.onSignedOut = {
            outbox.clear()
            appScope.launch(Dispatchers.IO) {
                offlineCache.clearAll()
                runCatching {
                    SingletonImageLoader.get(appContext).let { it.memoryCache?.clear(); it.diskCache?.clear() }
                }
            }
        }
        // Back online (or back in front): send what waited.
        appScope.launch { connectivity.refresh.drop(1).collect { outbox.flush() } }
    }

    /**
     * One outbox attempt: the photo to `<uid>/<client id>.jpg` (an object already there counts), then the row with
     * the client id. A duplicate id (23505) means an earlier attempt arrived: the row is fetched instead.
     */
    private suspend fun deliverMessage(p: PendingMessage): ChatMessage {
        val path = p.photoPath
        if (path != null) api.uploadChatImageAt(p.photo!!, path)
        return try {
            api.sendMessage(p.bubbleId, p.senderId, p.content, path, id = p.clientId)
        } catch (e: PostgrestRestException) {
            if (!OutboxRules.isUniqueViolation(e.code)) throw e
            api.chatMessage(p.clientId) ?: throw e
        }
    }

    private val probeClient by lazy {
        OkHttpClient.Builder().connectTimeout(5, TimeUnit.SECONDS).callTimeout(8, TimeUnit.SECONDS).build()
    }

    /** `GET /auth/v1/health`: any HTTP answer means Supabase is reachable again. */
    private suspend fun probeHealth(): Boolean = withContext(Dispatchers.IO) {
        if (connectivity.simulatedOffline) return@withContext false
        runCatching {
            val request = Request.Builder().url(BuildConfig.SUPABASE_URL.trimEnd('/') + "/auth/v1/health")
                .header("apikey", BuildConfig.SUPABASE_ANON_KEY).build()
            probeClient.newCall(request).execute().use { true }
        }.getOrDefault(false)
    }
}
