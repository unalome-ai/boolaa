package com.boolaa.app

import android.content.Context
import com.boolaa.app.core.Backend
import com.boolaa.app.core.BoolaaApi
import com.boolaa.app.core.ChatImageUrls
import com.boolaa.app.core.DeviceIdentity
import com.boolaa.app.core.PhotoUrls
import com.boolaa.app.push.PushManager
import com.boolaa.app.state.SessionStore
import com.boolaa.app.state.UnreadStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/** Manual DI: one Supabase client, one API and one SessionStore per process. */
class AppContainer(context: Context) {
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    val api = BoolaaApi(Backend.createClient())
    /** This install's device id for device verification (docs/auth-security.md §2). */
    val device = DeviceIdentity.create(context)
    val session = SessionStore(
        api = api,
        prefs = context.getSharedPreferences("boolaa", Context.MODE_PRIVATE),
        scope = appScope,
        device = device,
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
}
