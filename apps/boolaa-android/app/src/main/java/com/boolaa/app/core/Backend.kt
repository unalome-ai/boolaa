package com.boolaa.app.core

import com.boolaa.app.BuildConfig
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.realtime.Realtime
import io.github.jan.supabase.serializer.KotlinXSerializer
import io.github.jan.supabase.storage.Storage
import io.ktor.client.engine.okhttp.OkHttp

/** Builds the single SupabaseClient. URL and anon key come from local.properties through BuildConfig. */
object Backend {
    fun createClient(
        url: String = BuildConfig.SUPABASE_URL,
        anonKey: String = BuildConfig.SUPABASE_ANON_KEY,
        /** In-memory session only (tests that sign in two users at once). */
        ephemeral: Boolean = false,
    ): SupabaseClient = createSupabaseClient(supabaseUrl = url, supabaseKey = anonKey) {
        httpEngine = OkHttp.create()
        defaultSerializer = KotlinXSerializer(BoolaaJson.json)
        install(Auth) {
            if (ephemeral) {
                autoLoadFromStorage = false
                autoSaveToStorage = false
                enableLifecycleCallbacks = false
            }
        }
        install(Postgrest)
        install(Realtime)
        install(Storage)
    }
}
