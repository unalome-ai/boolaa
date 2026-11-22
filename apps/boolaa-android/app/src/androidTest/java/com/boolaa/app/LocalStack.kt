package com.boolaa.app

import androidx.test.platform.app.InstrumentationRegistry
import com.boolaa.app.core.Backend
import com.boolaa.app.core.BoolaaApi
import com.boolaa.app.core.BoolaaJson
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.builtin.Email
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.URLEncoder
import java.util.UUID

/**
 * Helpers for instrumented tests against the LOCAL stack only:
 * - Mailpit's API (`adb reverse tcp:55324 tcp:55324`) to read emailed codes;
 * - the local service-role key (instrumentation argument from local.properties) to flip `app_settings` flags;
 * - throwaway users made with ephemeral clients.
 */
object LocalStack {
    private val http = OkHttpClient()
    private val args get() = InstrumentationRegistry.getArguments()
    private val mailpit get() = args.getString("mailpitUrl") ?: "http://127.0.0.1:55324"
    const val SEEDED_DEVICE = "boolaa-test-device"

    // Mailpit

    private suspend fun get(url: String): String = withContext(Dispatchers.IO) {
        http.newCall(Request.Builder().url(url).build()).execute().use { r ->
            check(r.isSuccessful) { "GET $url -> ${r.code}" }
            r.body.string()
        }
    }

    /** IDs of the messages Mailpit holds for [email], newest first. */
    suspend fun messageIds(email: String): List<String> {
        val q = URLEncoder.encode("to:\"$email\"", "UTF-8")
        val body = BoolaaJson.json.parseToJsonElement(get("$mailpit/api/v1/search?query=$q&limit=50")).jsonObject
        return body["messages"]!!.jsonArray.map { it.jsonObject["ID"]!!.jsonPrimitive.content }
    }

    /** Waits for a message to [email] that isn't in [before] and returns the 6-digit code in it. */
    suspend fun awaitCode(email: String, before: Collection<String>, timeoutMs: Long = 45_000): String {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val fresh = messageIds(email).firstOrNull { it !in before }
            if (fresh != null) {
                val text = BoolaaJson.json.parseToJsonElement(get("$mailpit/api/v1/message/$fresh")).jsonObject["Text"]!!.jsonPrimitive.content
                return Regex("(?<![\\w])(\\d{6})(?![\\w])").find(text)?.groupValues?.get(1) ?: error("no code in message $fresh")
            }
            delay(400)
        }
        error("no new email for $email")
    }

    // Feature flags (service role, local only)

    suspend fun deviceVerificationEnforced(): Boolean = withContext(Dispatchers.IO) {
        val r = http.newCall(admin("$restUrl/app_settings?select=device_verification_enforced").build()).execute()
        r.use { BoolaaJson.json.parseToJsonElement(it.body.string()).jsonArray.first().jsonObject["device_verification_enforced"]!!.jsonPrimitive.content == "true" }
    }

    suspend fun setDeviceVerificationEnforced(on: Boolean) = withContext(Dispatchers.IO) {
        val body = """{"device_verification_enforced":$on}""".toRequestBody("application/json".toMediaType())
        http.newCall(admin("$restUrl/app_settings?id=eq.true").patch(body).build()).execute().use { check(it.isSuccessful) { "flag -> ${it.code}" } }
    }

    /** Runs [block] with device verification enforced, then restores the previous value. */
    suspend fun <T> withEnforcement(block: suspend () -> T): T {
        val before = deviceVerificationEnforced()
        setDeviceVerificationEnforced(true)
        try {
            return block()
        } finally {
            setDeviceVerificationEnforced(before)
        }
    }

    private val restUrl get() = "${BuildConfig.SUPABASE_URL}/rest/v1"
    private fun admin(url: String): Request.Builder {
        val key = args.getString("serviceRoleKey") ?: error("set supabase.serviceRoleKey in local.properties (local key only)")
        return Request.Builder().url(url).header("apikey", key).header("Authorization", "Bearer $key")
    }

    // Users

    class Throwaway(val email: String, val password: String, val api: BoolaaApi, val id: String)

    /** Signs up a fresh user with an ephemeral client (the app's stored session is untouched). */
    suspend fun throwaway(tag: String): Throwaway {
        val email = "android-$tag-${UUID.randomUUID().toString().take(8)}@boolaa.test"
        val client = Backend.createClient(ephemeral = true)
        client.auth.signUpWith(Email) {
            this.email = email; password = "password123"
            data = com.boolaa.app.state.SessionStore.signUpMetadata("Android $tag", "en")
        }
        if (client.auth.currentUserOrNull() == null) client.auth.signInWith(Email) { this.email = email; password = "password123" }
        return Throwaway(email, "password123", BoolaaApi(client), client.auth.currentUserOrNull()!!.id)
    }

    fun randomDeviceId(): String = "android-test-" + UUID.randomUUID()
}
