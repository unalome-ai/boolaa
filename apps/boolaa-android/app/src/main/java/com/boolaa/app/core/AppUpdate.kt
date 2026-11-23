package com.boolaa.app.core

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.net.HttpURLConnection
import java.net.URL

/**
 * Sideloaded updates (no Play Store): the app reads `<web>/android/latest.json`, published with each APK on
 * boolaa.ro/android, and offers the new version. Below `minSupported` the update is required.
 */
@Serializable
data class AndroidRelease(
    val versionCode: Int,
    val versionName: String,
    val minSupported: Int = 1,
    val url: String,
    val sha256: String = "",
)

enum class UpdateKind { NONE, OPTIONAL, REQUIRED }

object AppUpdate {
    private val json = Json { ignoreUnknownKeys = true }
    private const val PREFS = "app_update"
    private const val KEY_DISMISSED = "dismissed_version_code"

    fun parse(body: String): AndroidRelease? = runCatching { json.decodeFromString<AndroidRelease>(body) }.getOrNull()
        ?.takeIf { it.versionCode > 0 && it.url.startsWith("https://") }

    /** What to show for [installed] given [release]; an optional update the user already dismissed stays hidden. */
    fun kind(installed: Int, release: AndroidRelease?, dismissed: Int = 0): UpdateKind = when {
        release == null -> UpdateKind.NONE
        installed < release.minSupported -> UpdateKind.REQUIRED
        installed < release.versionCode && dismissed < release.versionCode -> UpdateKind.OPTIONAL
        else -> UpdateKind.NONE
    }

    /** Fetches the manifest; null on any failure (offline, bad JSON): the check simply tries again next start. */
    suspend fun fetch(manifestUrl: String): AndroidRelease? = withContext(Dispatchers.IO) {
        runCatching {
            val c = URL(manifestUrl).openConnection() as HttpURLConnection
            c.connectTimeout = 10_000; c.readTimeout = 10_000
            c.setRequestProperty("Accept", "application/json")
            try {
                if (c.responseCode != 200) null else parse(c.inputStream.bufferedReader().use { it.readText() })
            } finally { c.disconnect() }
        }.getOrNull()
    }

    fun dismissed(context: Context): Int = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt(KEY_DISMISSED, 0)

    fun dismiss(context: Context, versionCode: Int) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putInt(KEY_DISMISSED, versionCode).apply()
    }
}
