package com.boolaa.app

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.net.Uri
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.boolaa.app.core.Backend
import com.boolaa.app.core.BoolaaApi
import com.boolaa.app.core.ImageBucket
import com.boolaa.app.core.requestItem
import com.boolaa.app.model.ItemKind
import com.boolaa.app.state.LocaleManager
import com.boolaa.app.ui.components.DebugPhotoPicks
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

/**
 * Food Circle "I want it" end to end against the local Supabase (`adb reverse tcp:55321 tcp:55321`): Alice adds two
 * posts through the form (the second "new post" must open an EMPTY editor), Bob asks for the second one, Alice sees
 * the request live, picks Bob and hands it over, and the post leaves her list. Everything it creates is deleted.
 */
@OptIn(ExperimentalTestApi::class)
@RunWith(AndroidJUnit4::class)
class RequestsFlowTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val container get() = (context.applicationContext as BoolaaApplication).container
    private val timeout = 25_000L
    private val tag = UUID.randomUUID().toString().take(6)

    @Before fun signedOutInEnglish() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync { LocaleManager.set("en") }
        container.device.overrideForTesting(LocalStack.SEEDED_DEVICE)
        runBlocking { container.session.signOut() }
        rule.waitUntilExactlyOneExists(hasTestTag("auth-screen"), timeout)
    }

    @After fun cleanUp() = runBlocking {
        DebugPhotoPicks.next = null
        val me = container.session.state.value.userId
        if (me != null) {
            val mine = container.api.client.from("food_posts").select(Columns.raw("id, image, description")) {
                filter { eq("user_id", me); ilike("description", "%$tag%") }
            }.decodeList<Map<String, String?>>()
            mine.forEach { row ->
                container.api.client.from("food_posts").delete { filter { eq("id", row["id"]!!) } }
                row["image"]?.let { runCatching { container.api.deleteImage(it, ImageBucket.FOOD, me) } }
            }
        }
        container.session.signOut()
        container.device.overrideForTesting(null)
    }

    /** A 640x480 JPEG in the cache, standing in for the Photo Picker's answer. */
    private fun fixture(): Uri {
        val bmp = Bitmap.createBitmap(640, 480, Bitmap.Config.ARGB_8888)
        Canvas(bmp).drawColor(Color.rgb(255, 154, 46))
        val f = File(context.cacheDir, "fixture-$tag.jpg")
        f.outputStream().use { bmp.compress(Bitmap.CompressFormat.JPEG, 80, it) }
        return Uri.fromFile(f)
    }

    private fun addPost(description: String) {
        rule.onNodeWithTag("add-button").performClick()
        rule.waitUntilExactlyOneExists(hasTestTag("food-editor"), timeout)
        // A fresh editor: no description from the previous post, the default expiry, an empty photo slot.
        rule.onNode(hasTestTag("food-description") and hasText("$tag", substring = true)).assertDoesNotExist()
        rule.onNodeWithTag("expiry-tomorrow").assertExists()
        rule.onNode(hasText("Choose a photo") and hasAnyAncestor(hasTestTag("food-editor"))).assertExists()
        DebugPhotoPicks.next = fixture()
        rule.onNodeWithTag("photo-field").performClick()
        // With a camera the menu opens ("Take photo" / "Choose from gallery"); without one the gallery is used at once.
        if (rule.onAllNodes(hasTestTag("photo-source-gallery")).fetchSemanticsNodes().isNotEmpty()) {
            rule.onNodeWithTag("photo-source-gallery").performClick()
        }
        rule.onNodeWithTag("food-description").performTextInput(description)
        rule.onNodeWithTag("food-save").performScrollTo().performClick()
        rule.waitUntilDoesNotExist(hasTestTag("food-editor"), timeout)
        rule.waitUntilAtLeastOneExists(hasText(description), timeout)
    }

    private suspend fun bob(): BoolaaApi {
        val client = Backend.createClient(ephemeral = true)
        client.auth.signInWith(Email) { email = "bob@boolaa.test"; password = "password123" }
        return BoolaaApi(client)
    }

    @Test fun two_posts_then_request_pick_and_hand_over() {
        rule.onNodeWithTag("email").performTextInput("alice@boolaa.test")
        rule.onNodeWithTag("password").performTextInput("password123")
        rule.onNodeWithTag("auth-submit").performClick()
        rule.waitUntilExactlyOneExists(hasTestTag("chat-fab"), timeout)
        rule.onNodeWithTag("bubble-chip-Flatmates").performClick()
        rule.onNodeWithTag("tab-food").performClick()
        rule.waitUntilExactlyOneExists(hasTestTag("food-screen"), timeout)

        val first = "Android soup $tag"
        val second = "Android pie $tag"
        addPost(first)
        addPost(second)

        val bubbleId = container.session.state.value.currentBubble!!.id
        val post = runBlocking { container.api.foodPosts(bubbleId) }.first { it.description == second }
        // Sent with Tomorrow: 23:59 local tomorrow.
        val tomorrow = java.time.LocalDate.now().plusDays(1).atTime(23, 59).atZone(java.time.ZoneId.systemDefault()).toInstant()
        assertEquals(tomorrow, post.expiresAt)

        runBlocking { bob().requestItem(ItemKind.FOOD, post.id, "Can I come at 7?") }
        // Live: the count pill and the owner's button.
        rule.waitUntilAtLeastOneExists(hasTestTag("owner-requests") and hasText("Requests · 1"), timeout)
        rule.onNode(hasTestTag("owner-requests") and hasText("Requests · 1")).performScrollTo().performClick()
        rule.waitUntilExactlyOneExists(hasTestTag("requests-sheet"), timeout)
        rule.waitUntilExactlyOneExists(hasText("Can I come at 7?"), timeout)
        rule.onNode(hasContentDescription("Pick: Bob", substring = true)).performClick()
        rule.waitUntilExactlyOneExists(hasTestTag("your-pick"), timeout)
        rule.onNodeWithTag("hand-over").performClick()
        rule.waitUntilExactlyOneExists(hasTestTag("hand-over-confirm"), timeout)
        rule.onNodeWithTag("hand-over-confirm").performClick()
        // Handed-over food leaves the list (the owner's too).
        rule.waitUntilDoesNotExist(hasText(second), timeout)
        rule.onNode(hasText(first)).assertExists()
    }
}
