package com.boolaa.app.core

import coil3.intercept.Interceptor
import coil3.request.ErrorResult
import coil3.request.ImageResult
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Private photos (docs/boolaa-spec.md "Images", migration 20261123210000_private_photos.sql).
 *
 * Every photo bucket is private. Rows keep the `/storage/v1/object/public/<bucket>/<path>` form of a photo
 * (users.avatar, food_posts.image, market_items.image, bubbles.logo) only as its identifier: the app never loads
 * that URL. [PhotoUrlInterceptor] (registered on the app's Coil ImageLoader) turns it into a signed URL:
 *  - batched: every photo asked for within [batchWindowMs] (a list appearing) is signed with ONE
 *    `createSignedUrls` call per bucket;
 *  - cached per storage path: the signed URL is reused until 5 minutes before its hour ends, and Coil's memory
 *    and disk caches are keyed by `<bucket>/<path>`, so a new signature never re-downloads the bytes;
 *  - refreshed before expiry (an entry near its end is re-signed on the next load) and after a load failure
 *    (the interceptor drops the URL and signs once more).
 * URLs that aren't ours (seed Unsplash photos, already-signed chat URLs) pass through unchanged.
 */
class PhotoUrls(
    private val sign: suspend (bucket: String, paths: List<String>) -> Map<String, String>,
    private val clock: () -> Long = System::currentTimeMillis,
    private val batchWindowMs: Long = 30,
) {
    data class Ref(val bucket: String, val path: String) {
        /** Coil memory / disk cache key: stable across signatures and hosts. */
        val cacheKey: String get() = "$bucket/$path"
    }

    private val caches = HashMap<String, SignedUrlCache>()
    private val pending = HashMap<Ref, MutableList<CompletableDeferred<String?>>>()
    private val mutex = Mutex()
    private var flushJob: Job? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private fun cache(bucket: String) = caches.getOrPut(bucket) { SignedUrlCache(TTL_SECONDS * 1000) }

    /** A signed URL for [ref], batched with every other request in the same window; null when unreadable. */
    suspend fun signed(ref: Ref): String? {
        val waiter = mutex.withLock {
            cache(ref.bucket).get(ref.path, clock())?.let { return it }
            CompletableDeferred<String?>().also { d ->
                pending.getOrPut(ref) { mutableListOf() }.add(d)
                if (flushJob == null) flushJob = scope.launch { delay(batchWindowMs); flush() }
            }
        }
        return waiter.await()
    }

    /** Forget a path's signed URL (its image failed to load: expired, or access changed). */
    suspend fun forget(ref: Ref) = mutex.withLock { cache(ref.bucket).forget(ref.path) }

    /** Signed out: nothing signed for the previous account is reused. */
    suspend fun reset() = mutex.withLock { caches.clear() }

    private suspend fun flush() {
        val batch = mutex.withLock {
            flushJob = null
            HashMap(pending).also { pending.clear() }
        }
        for ((bucket, refs) in batch.keys.groupBy { it.bucket }) {
            val now = clock()
            val got = HashMap<String, String>()
            for (chunk in refs.map { it.path }.distinct().sorted().chunked(100)) {
                runCatching { sign(bucket, chunk) }.onSuccess { got.putAll(it) }
            }
            mutex.withLock { cache(bucket).put(got, now) }
            for (r in refs) batch[r]?.forEach { it.complete(got[r.path]) }
        }
    }

    companion object {
        const val TTL_SECONDS = 3600L
        val BUCKETS = setOf("avatars", "food.images", "market.images", "bubble.images", "link.previews", "chat.images")
        private const val MARKER = "/storage/v1/object/public/"

        /** The bucket and path behind a stored photo URL, or null for anything else (external or signed URLs). */
        fun ref(stored: String?): Ref? {
            val i = stored?.indexOf(MARKER) ?: return null
            if (i < 0) return null
            val rest = stored.substring(i + MARKER.length).substringBefore('?').substringBefore('#')
            val bucket = rest.substringBefore('/', "")
            val path = runCatching { java.net.URLDecoder.decode(rest.substringAfter('/', "").replace("+", "%2B"), "UTF-8") }.getOrNull()
            if (bucket !in BUCKETS || path.isNullOrEmpty() || ".." in path) return null
            return Ref(bucket, path)
        }
    }
}

/** Coil interceptor: loads our stored photo URLs through [PhotoUrls] (see there). */
class PhotoUrlInterceptor(private val photos: PhotoUrls) : Interceptor {
    /** Memory or disk cache only, keyed by `<bucket>/<path>` (never the network); an error when nothing is cached. */
    private suspend fun cachedOnly(chain: Interceptor.Chain, ref: PhotoUrls.Ref): ImageResult {
        val request = chain.request
        val offline = request.newBuilder()
            .data("https://offline.invalid/" + ref.cacheKey)
            .memoryCacheKey(request.memoryCacheKey ?: ref.cacheKey)
            .diskCacheKey(request.diskCacheKey ?: ref.cacheKey)
            .networkCachePolicy(coil3.request.CachePolicy.DISABLED)
            .build()
        return runCatching { chain.withRequest(offline).proceed() }
            .getOrElse { ErrorResult(null, request, IllegalStateException("photo not readable")) }
    }

    override suspend fun intercept(chain: Interceptor.Chain): ImageResult {
        val request = chain.request
        val ref = PhotoUrls.ref(request.data as? String) ?: return chain.proceed()
        suspend fun attempt(): ImageResult {
            // No signature (offline, or not readable): the pixels Coil already cached under the storage path, if any.
            val signed = photos.signed(ref) ?: return cachedOnly(chain, ref)
            val next = request.newBuilder()
                .data(signed)
                .memoryCacheKey(request.memoryCacheKey ?: ref.cacheKey)
                .diskCacheKey(request.diskCacheKey ?: ref.cacheKey)
                .build()
            return chain.withRequest(next).proceed()
        }
        val first = attempt()
        if (first !is ErrorResult) return first
        // Expired or stale signature: one retry with a fresh one.
        photos.forget(ref)
        return attempt()
    }
}
