package com.boolaa.app

import com.boolaa.app.core.PhotoUrls
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Private photos (PhotoUrls, supabase/migrations/20261123210000_private_photos.sql): parsing, batching, caching. */
class PhotoUrlsTest {
    private val base = "http://127.0.0.1:55321/storage/v1/object/public/"

    @Test fun ref_only_for_our_public_form_urls() {
        assertEquals(PhotoUrls.Ref("food.images", "u1/a.jpg"), PhotoUrls.ref(base + "food.images/u1/a.jpg"))
        assertEquals(PhotoUrls.Ref("bubble.images", "b1/c.jpg"), PhotoUrls.ref(base + "bubble.images/b1/c.jpg?x=1"))
        assertEquals(PhotoUrls.Ref("avatars", "u1/a b.jpg"), PhotoUrls.ref(base + "avatars/u1/a%20b.jpg"))
        assertEquals("avatars/u1/a.jpg", PhotoUrls.ref(base + "avatars/u1/a.jpg")!!.cacheKey)
        assertNull("unknown bucket", PhotoUrls.ref(base + "other/u1/a.jpg"))
        assertNull("no traversal", PhotoUrls.ref(base + "avatars/u1/../u2/a.jpg"))
        assertNull("external", PhotoUrls.ref("https://images.unsplash.com/photo-1?w=800"))
        assertNull("already signed", PhotoUrls.ref("http://h/storage/v1/object/sign/chat.images/u/a.jpg?token=t"))
        assertNull(PhotoUrls.ref(null))
    }

    @Test fun one_call_per_bucket_per_batch_then_cached_per_path() = runBlocking {
        val calls = mutableListOf<Pair<String, List<String>>>()
        var now = 1_000_000L
        val photos = PhotoUrls(sign = { bucket, paths ->
            synchronized(calls) { calls += bucket to paths }
            paths.filter { !it.startsWith("hidden/") }.associateWith { "https://signed/$bucket/$it?t=${calls.size}" }
        }, clock = { now })
        val refs = listOf(
            PhotoUrls.Ref("avatars", "u1/a.jpg"), PhotoUrls.Ref("avatars", "u2/b.jpg"), PhotoUrls.Ref("avatars", "u1/a.jpg"),
            PhotoUrls.Ref("food.images", "u1/f.jpg"), PhotoUrls.Ref("avatars", "hidden/x.jpg"),
        )
        val urls = refs.map { async { photos.signed(it) } }.awaitAll()
        assertEquals(2, calls.size)
        assertEquals(listOf("hidden/x.jpg", "u1/a.jpg", "u2/b.jpg"), calls.first { it.first == "avatars" }.second)
        assertEquals(urls[0], urls[2])
        assertNull("unreadable paths stay null", urls[4])

        // Cached: no new call until 5 minutes before the hour ends.
        assertEquals(urls[0], photos.signed(refs[0]))
        assertEquals(2, calls.size)
        now += (PhotoUrls.TTL_SECONDS - 4 * 60) * 1000
        photos.signed(refs[0])
        assertEquals("re-signed near expiry", 3, calls.size)
        photos.forget(refs[1])
        photos.signed(refs[1])
        assertEquals("re-signed after a load failure", 4, calls.size)
        photos.reset()
        photos.signed(refs[3])
        assertEquals("nothing reused after sign-out", 5, calls.size)
    }
}
