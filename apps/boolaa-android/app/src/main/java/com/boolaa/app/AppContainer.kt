package com.boolaa.app

import android.content.Context
import com.boolaa.app.core.Backend
import com.boolaa.app.core.BoolaaApi
import com.boolaa.app.core.ChatImageUrls
import com.boolaa.app.core.DeviceIdentity
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
    /** Signed `chat.images` URLs, cached per path for their hour. */
    val chatImages = ChatImageUrls(api)
}
