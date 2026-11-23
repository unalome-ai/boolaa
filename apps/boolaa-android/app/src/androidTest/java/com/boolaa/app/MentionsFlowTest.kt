package com.boolaa.app

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.boolaa.app.core.Backend
import com.boolaa.app.core.BoolaaApi
import com.boolaa.app.core.Mentions
import com.boolaa.app.model.ChatMessage
import com.boolaa.app.model.MentionSpan
import com.boolaa.app.state.LocaleManager
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

/**
 * Chat @mentions end to end against the local Supabase: Alice types `@bo`, picks Bob from the list, sends; the row
 * carries one code-point span for Bob. Bob then mentions Alice after an emoji; Alice's chat shows it live as
 * "Bob mentioned you". Both messages are deleted (soft delete) afterwards.
 */
@OptIn(ExperimentalTestApi::class)
@RunWith(AndroidJUnit4::class)
class MentionsFlowTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val container get() = (context.applicationContext as BoolaaApplication).container
    private val timeout = 25_000L
    private val tag = UUID.randomUUID().toString().take(6)
    private var bobApi: BoolaaApi? = null
    private val created = mutableListOf<Pair<Boolean, String>>()

    @Before fun signedOutInEnglish() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync { LocaleManager.set("en") }
        container.device.overrideForTesting(LocalStack.SEEDED_DEVICE)
        runBlocking { container.session.signOut() }
        rule.waitUntilExactlyOneExists(hasTestTag("auth-screen"), timeout)
    }

    @After fun cleanUp() = runBlocking {
        created.forEach { (byBob, id) ->
            runCatching { if (byBob) bobApi?.deleteChatMessage(id) else container.api.deleteChatMessage(id) }
        }
        runCatching { bobApi?.client?.auth?.signOut() }
        container.session.signOut()
        container.device.overrideForTesting(null)
    }

    private suspend fun bob(): BoolaaApi {
        val client = Backend.createClient(ephemeral = true)
        client.auth.signInWith(Email) { email = "bob@boolaa.test"; password = "password123" }
        return BoolaaApi(client).also { bobApi = it }
    }

    private suspend fun aliceRow(bubbleId: String, me: String): ChatMessage? =
        container.api.client.from("chat_messages").select(Columns.raw("*")) {
            filter { eq("bubble_id", bubbleId); eq("sender_id", me); ilike("content", "%$tag%") }
        }.decodeList<ChatMessage>().firstOrNull()

    @Test fun pick_send_and_be_mentioned() {
        rule.onNodeWithTag("email").performTextInput("alice@boolaa.test")
        rule.onNodeWithTag("password").performTextInput("password123")
        rule.onNodeWithTag("auth-submit").performClick()
        rule.waitUntilExactlyOneExists(hasTestTag("chat-fab"), timeout)
        rule.onNodeWithTag("bubble-chip-Flatmates").performClick()
        val state = container.session.state.value
        val bubbleId = state.currentBubble!!.id
        val me = state.userId!!
        val bobApi = runBlocking { bob() }
        val bobId = runBlocking { bobApi.client.auth.currentUserOrNull()!!.id }
        val bobName = runBlocking { container.api.mentionCandidates(bubbleId) }.first { it.userId == bobId }.name

        rule.onNodeWithTag("chat-fab").performClick()
        rule.waitUntilExactlyOneExists(hasTestTag("chat-input"), timeout)
        rule.onNodeWithTag("chat-input").performClick()
        rule.onNodeWithTag("chat-input").performTextInput("Hi @" + bobName.take(2).lowercase())
        rule.waitUntilExactlyOneExists(hasTestTag("mention-strip"), timeout)
        rule.onNode(hasContentDescription("Mention $bobName")).performClick()
        rule.waitUntilDoesNotExist(hasTestTag("mention-strip"), timeout)
        rule.onNodeWithTag("chat-input").performTextInput("are you home? $tag")
        rule.onNodeWithTag("chat-send").performClick()

        // The row as stored: "Hi @Bob are you home? <tag>", one span for Bob in code points.
        val row = runBlocking {
            var r: ChatMessage? = null
            repeat(50) { if (r == null) { r = aliceRow(bubbleId, me); if (r == null) delay(300) } }
            r
        }
        assertNotNull(row)
        created += false to row!!.id
        assertEquals("Hi @$bobName are you home? $tag", row.content)
        assertEquals(listOf(MentionSpan(3, 1 + bobName.codePointCount(0, bobName.length), bobId)), row.mentions)

        // Bob mentions Alice after an emoji: Alice sees it live, read as "Bob mentioned you".
        val aliceName = container.session.state.value.profile!!.name
        val text = "🍕 @$aliceName dinner? $tag"
        val start = text.indexOf('@')
        val span = Mentions.spanOf(text, start, start + 1 + aliceName.length, me)
        assertEquals(2, span.start)
        val sent = runBlocking { bobApi.sendMessage(bubbleId, bobId, text, mentions = listOf(span)) }
        created += true to sent.id
        assertEquals(listOf(span), sent.mentions)
        rule.waitUntilExactlyOneExists(hasContentDescription("$bobName mentioned you, 🍕 @$aliceName dinner? $tag", substring = true), timeout)
    }
}
