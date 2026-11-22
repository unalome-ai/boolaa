package com.boolaa.app

import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.auth.MemoryCodeVerifierCache
import io.github.jan.supabase.auth.MemorySessionManager
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.serializer.KotlinXSerializer
import io.ktor.client.engine.okhttp.OkHttp
import com.boolaa.app.core.BoolaaApi
import com.boolaa.app.core.BoolaaJson
import com.boolaa.app.core.MuteOption
import com.boolaa.app.core.PrefKey
import com.boolaa.app.core.bubbleMute
import com.boolaa.app.core.muteBubble
import com.boolaa.app.core.notificationPrefs
import com.boolaa.app.core.registerPushToken
import com.boolaa.app.core.saveNotificationPrefs
import com.boolaa.app.core.startDeviceCheck
import com.boolaa.app.core.isDeviceVerified
import com.boolaa.app.core.unmuteBubble
import com.boolaa.app.core.unregisterPushToken
import com.boolaa.app.state.SessionStore
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.postgrest.from
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.Instant
import java.util.UUID

/**
 * The app's own push calls against the LOCAL stack (skipped unless BOOLAA_LOCAL_STACK=1):
 * register_push_token through [registerPushToken] -> a chat message from another member -> a queued outbox row and
 * the dry-run dispatcher's FCM request for exactly this token, with the deep-link data the app routes on.
 * Then prefs, mutes and unregister. Throwaway users, deleted at the end; app_settings flags are never touched.
 *
 *   BOOLAA_LOCAL_STACK=1 BOOLAA_SERVICE_ROLE_KEY=<local key> ./gradlew :app:testDebugUnitTest --tests '*PushLocalStackTest*'
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = android.app.Application::class)
class PushLocalStackTest {
    private val http = OkHttpClient()

    private suspend fun user(name: String): Pair<BoolaaApi, String> {
        // Same plugins as Backend.createClient, with in-memory session storage (no Android settings store under Robolectric).
        val client = createSupabaseClient(BuildConfig.SUPABASE_URL, BuildConfig.SUPABASE_ANON_KEY) {
            httpEngine = OkHttp.create()
            defaultSerializer = KotlinXSerializer(BoolaaJson.json)
            install(Auth) {
                sessionManager = MemorySessionManager(); codeVerifierCache = MemoryCodeVerifierCache()
                autoLoadFromStorage = false; autoSaveToStorage = false; enableLifecycleCallbacks = false; alwaysAutoRefresh = false
            }
            install(Postgrest)
        }
        val email = "push-android-${UUID.randomUUID()}@boolaa.test"
        client.auth.signUpWith(Email) {
            this.email = email; password = "password123"; data = SessionStore.signUpMetadata(name, "ro")
        }
        if (client.auth.currentSessionOrNull() == null) client.auth.signInWith(Email) { this.email = email; password = "password123" }
        val api = BoolaaApi(client)
        return api to client.auth.currentUserOrNull()!!.id
    }

    /** Service-role read of tables clients can't see (outbox, debug log). */
    private fun serviceGet(path: String, key: String): JsonArray {
        val req = Request.Builder().url("${BuildConfig.SUPABASE_URL}/rest/v1/$path")
            .header("apikey", key).header("Authorization", "Bearer $key").build()
        return http.newCall(req).execute().use { BoolaaJson.json.parseToJsonElement(it.body.string()) as JsonArray }
    }

    @Test fun registered_token_gets_a_queued_push_and_settings_round_trip() = runBlocking {
        assumeTrue(System.getenv("BOOLAA_LOCAL_STACK") == "1")
        val serviceKey = System.getenv("BOOLAA_SERVICE_ROLE_KEY")
        val (ana, anaId) = user("Ana")
        val (tom, tomId) = user("Tom")
        try {
            val device = "android-push-test-${UUID.randomUUID()}"
            // As SessionStore's gate: a new device is `code_required`, which only blocks while enforcement is on.
            val check = ana.startDeviceCheck(device, "Robolectric · Android")
            assertTrue(check.verified || ana.isDeviceVerified())
            tom.startDeviceCheck("android-push-test-${UUID.randomUUID()}", "Robolectric · Android")
            val token = "e2e-android-${UUID.randomUUID()}"
            ana.registerPushToken(token, device, "ro", "1.0")

            // The row as the app sees it (select own rows).
            val rows = ana.client.from("push_tokens").select().data.let { BoolaaJson.json.parseToJsonElement(it) as JsonArray }
            val row = rows.single().jsonObject
            assertEquals(listOf("android", token, "ro", "1.0"), listOf("platform", "token", "locale", "app_version").map { row[it]!!.jsonPrimitive.content })

            val bubble = ana.createBubble("Push Android ${System.currentTimeMillis() % 100000}", null, 10)
            val request = tom.requestToJoin(bubble.inviteCode)
            assertTrue(ana.approveJoinRequest(request.id))
            val msg = tom.sendMessage(bubble.id, tomId, "Pizza tonight?")

            if (serviceKey != null) {
                val outbox = serviceGet("notification_outbox?recipient_id=eq.$anaId&bubble_id=eq.${bubble.id}&type=eq.chat&select=type,collapse_key,target_id", serviceKey)
                assertEquals("chat:${bubble.id}", outbox.single().jsonObject["collapse_key"]!!.jsonPrimitive.content)
                // Dry-run dispatcher (PUSH_DRY_RUN=1): the FCM request it would have sent to this token.
                var log = JsonArray(emptyList())
                repeat(40) { if (log.isEmpty()) { delay(500); log = serviceGet("push_debug_log?token=eq.$token&select=provider,title,collapse_key,request", serviceKey) } }
                val sent = log.first().jsonObject
                assertEquals("fcm", sent["provider"]!!.jsonPrimitive.content)
                assertEquals("Tom în ${bubble.name}", sent["title"]!!.jsonPrimitive.content)
                val message = sent["request"]!!.jsonObject["payload"]!!.jsonObject["message"]!!.jsonObject
                val data = message["data"]!!.jsonObject.mapValues { it.value.jsonPrimitive.content }
                assertEquals("chat", data["type"]); assertEquals(bubble.id, data["bubble_id"]); assertEquals(msg.id, data["target_id"])
                assertEquals("chat", message["android"]!!.jsonObject["notification"]!!.jsonObject["channel_id"]!!.jsonPrimitive.content)
                // ...which the app turns into "open this bubble's chat".
                val payload = com.boolaa.app.core.PushPayload.from(data)!!
                assertEquals(com.boolaa.app.core.PushScreen.CHAT, com.boolaa.app.core.PushRouting.resolve(payload, listOf(bubble.id)).screen)
            }

            // Settings: prefs upsert, mute / unmute.
            ana.saveNotificationPrefs(anaId, PrefKey.CHAT.set(ana.notificationPrefs(anaId), false))
            assertFalse(ana.notificationPrefs(anaId).chat)
            ana.muteBubble(anaId, bubble.id, MuteOption.HOUR.until(Instant.now()))
            assertTrue(ana.bubbleMute(anaId, bubble.id)!!.isActive(Instant.now()))
            ana.muteBubble(anaId, bubble.id, null)
            assertNull(ana.bubbleMute(anaId, bubble.id)!!.until)
            ana.unmuteBubble(anaId, bubble.id)
            assertNull(ana.bubbleMute(anaId, bubble.id))

            // Sign-out path: the token is gone.
            ana.unregisterPushToken(token)
            assertEquals("[]", ana.client.from("push_tokens").select().data.trim())
            assertNotNull(msg.id)
        } finally {
            runCatching { tom.deleteMyAccount(tomId) }
            runCatching { ana.deleteMyAccount(anaId) }
        }
    }
}
