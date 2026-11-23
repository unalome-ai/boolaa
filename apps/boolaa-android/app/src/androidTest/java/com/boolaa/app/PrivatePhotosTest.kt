package com.boolaa.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.boolaa.app.core.Backend
import com.boolaa.app.core.BoolaaApi
import com.boolaa.app.core.ImageBucket
import com.boolaa.app.core.PhotoUrls
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.builtin.Email
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Private photos (supabase/migrations/20261123210000_private_photos.sql) against the local backend: Alice's avatar is
 * not served at its public URL; Bob (shares Flatmates) gets a signed URL through PhotoUrls; Carol (only a pending
 * request) gets none.
 */
@RunWith(AndroidJUnit4::class)
class PrivatePhotosTest {
    private val http = OkHttpClient()

    private suspend fun signedIn(email: String): Pair<BoolaaApi, String> {
        val client = Backend.createClient(ephemeral = true)
        client.auth.signInWith(Email) { this.email = email; password = "password123" }
        return BoolaaApi(client) to client.auth.currentUserOrNull()!!.id
    }

    private suspend fun status(url: String): Int = withContext(Dispatchers.IO) {
        http.newCall(Request.Builder().url(url).header("Cache-Control", "no-cache").build()).execute().use { it.code }
    }

    private fun photoUrls(api: BoolaaApi) = PhotoUrls(sign = { bucket, paths -> api.signedImageUrls(bucket, paths) })

    @Test fun avatar_only_through_signed_urls_for_bubble_mates() = runBlocking {
        val (alice, aliceId) = signedIn("alice@boolaa.test")
        val (bob, _) = signedIn("bob@boolaa.test")
        val (carol, _) = signedIn("carol@boolaa.test")
        val jpeg = byteArrayOf(0xff.toByte(), 0xd8.toByte(), 0xff.toByte(), 0xe0.toByte(), 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff.toByte(), 0xd9.toByte())
        val stored = alice.uploadImage(jpeg, ImageBucket.AVATARS, aliceId)
        try {
            assertNotEquals("public URL serves nothing", 200, status(stored))
            val ref = PhotoUrls.ref(stored)!!
            val bobs = photoUrls(bob)
            val signed = bobs.signed(ref)
            assertNotNull("bob shares Flatmates with Alice", signed)
            assertTrue(signed!!.contains("/storage/v1/object/sign/avatars/"))
            assertEquals(200, status(signed))
            assertEquals("cached per path", signed, bobs.signed(ref))
            assertNull("carol can't read it", photoUrls(carol).signed(ref))
        } finally {
            alice.deleteImage(stored, ImageBucket.AVATARS, aliceId)
        }
    }
}
