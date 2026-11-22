package com.boolaa.app

import android.content.Context
import com.boolaa.app.core.Backend
import com.boolaa.app.core.BoolaaApi
import com.boolaa.app.state.SessionStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

/** Manual DI: one Supabase client, one API and one SessionStore per process. */
class AppContainer(context: Context) {
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    val api = BoolaaApi(Backend.createClient())
    val session = SessionStore(
        api = api,
        prefs = context.getSharedPreferences("boolaa", Context.MODE_PRIVATE),
        scope = appScope,
    )
}
