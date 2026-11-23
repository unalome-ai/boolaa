package com.boolaa.app.core

import com.boolaa.app.BuildConfig
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.auth.ExternalAuthAction
import io.github.jan.supabase.auth.FlowType
import io.github.jan.supabase.functions.Functions
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.realtime.Realtime
import io.github.jan.supabase.serializer.KotlinXSerializer
import io.github.jan.supabase.storage.Storage
import io.ktor.client.engine.okhttp.OkHttp
import okhttp3.Interceptor
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.time.Duration.Companion.milliseconds

/** Builds the single SupabaseClient. URL and anon key come from local.properties through BuildConfig. */
object Backend {
    const val CONNECT_TIMEOUT_MS = 10_000L
    const val REQUEST_TIMEOUT_MS = 15_000L
    const val UPLOAD_TIMEOUT_MS = 60_000L

    /** OAuth and email links come back to `ro.boolaa.app://auth/callback` (manifest intent filter, Supabase allow-list). */
    const val AUTH_SCHEME = "ro.boolaa.app"
    const val AUTH_HOST = "auth"
    const val AUTH_REDIRECT = "$AUTH_SCHEME://$AUTH_HOST/callback"

    fun createClient(
        url: String = BuildConfig.SUPABASE_URL,
        anonKey: String = BuildConfig.SUPABASE_ANON_KEY,
        /** In-memory session only (tests that sign in two users at once). */
        ephemeral: Boolean = false,
        /** Every request's outcome for the connectivity monitor: true = any HTTP response, false = network error. */
        onNetworkResult: ((Boolean) -> Unit)? = null,
        /** DEBUG / tests: fail every request at once, as if there were no network. */
        simulatedOffline: () -> Boolean = { false },
    ): SupabaseClient = createSupabaseClient(supabaseUrl = url, supabaseKey = anonKey) {
        httpEngine = OkHttp.create {
            config {
                // A dead connection fails in seconds instead of hanging (docs/boolaa-spec.md "Offline and poor network").
                connectTimeout(CONNECT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
                addInterceptor(NetworkReportInterceptor(onNetworkResult, simulatedOffline))
            }
        }
        // REST, RPC and Auth calls give up after 15 s and surface a retry; uploads override it (60 s).
        requestTimeout = REQUEST_TIMEOUT_MS.milliseconds
        defaultSerializer = KotlinXSerializer(BoolaaJson.json)
        install(Auth) {
            // PKCE: the OAuth redirect carries a one-time code, never tokens, in the deep link.
            flowType = FlowType.PKCE
            scheme = AUTH_SCHEME
            host = AUTH_HOST
            defaultExternalAuthAction = ExternalAuthAction.CustomTabs()
            if (ephemeral) {
                autoLoadFromStorage = false
                autoSaveToStorage = false
                enableLifecycleCallbacks = false
            }
        }
        install(Postgrest)
        install(Realtime)
        install(Storage)
        install(Functions)
    }
}

/**
 * Reports each request's outcome to the connectivity monitor (a response of any status = reachable; an IOException
 * that isn't a cancellation = network error) and, when simulated offline, fails at once.
 */
class NetworkReportInterceptor(
    private val report: ((Boolean) -> Unit)?,
    private val simulatedOffline: () -> Boolean,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        if (simulatedOffline()) throw IOException("simulated offline")
        return try {
            chain.proceed(chain.request()).also { report?.invoke(true) }
        } catch (e: IOException) {
            if (!chain.call().isCanceled()) report?.invoke(false)
            throw e
        }
    }
}
