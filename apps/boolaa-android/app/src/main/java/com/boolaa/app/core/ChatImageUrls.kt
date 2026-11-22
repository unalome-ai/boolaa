package com.boolaa.app.core

import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Pure cache of signed URLs per object path. An entry is reused until shortly before its hour ends, so an image
 * never starts loading from a URL that is about to expire.
 */
class SignedUrlCache(private val ttlMillis: Long, private val marginMillis: Long = 5 * 60_000L) {
    private data class Entry(val url: String, val expiresAt: Long)
    private val entries = HashMap<String, Entry>()

    fun get(path: String, now: Long): String? = entries[path]?.takeIf { it.expiresAt - marginMillis > now }?.url

    /** The paths of [paths] that need a (new) signed URL. */
    fun missing(paths: Collection<String>, now: Long): List<String> = paths.distinct().filter { get(it, now) == null }

    fun put(urls: Map<String, String>, signedAt: Long) {
        urls.forEach { (path, url) -> entries[path] = Entry(url, signedAt + ttlMillis) }
    }

    fun forget(path: String) { entries.remove(path) }

    /** Every still-valid URL. */
    fun snapshot(now: Long): Map<String, String> = entries.mapNotNull { (p, e) -> if (e.expiresAt - marginMillis > now) p to e.url else null }.toMap()
}

/**
 * Signed URLs for photos in the private `chat.images` bucket (docs/boolaa-spec.md "Photos"): one batched
 * `createSignedUrls` call per page, 1 hour, cached per path. [urls] drives the chat screen.
 */
class ChatImageUrls(private val api: BoolaaApi, private val clock: () -> Long = System::currentTimeMillis) {
    private val cache = SignedUrlCache(BoolaaApi.CHAT_URL_TTL_SECONDS * 1000)
    private val mutex = Mutex()
    private val _urls = MutableStateFlow<Map<String, String>>(emptyMap())
    val urls: StateFlow<Map<String, String>> = _urls.asStateFlow()

    /** Signs the paths not yet cached (best effort: a failure leaves those photos as placeholders). */
    suspend fun ensure(paths: Collection<String>) = mutex.withLock {
        val now = clock()
        val missing = cache.missing(paths, now)
        if (missing.isNotEmpty()) {
            runCatching { api.signedChatImageUrls(missing) }
                .onSuccess { cache.put(it, now) }
                .onFailure { Log.w("Boolaa", "sign chat photos failed", it) }
        }
        _urls.value = cache.snapshot(now)
    }

    /** Drops a deleted photo's URL (access is revoked server-side anyway). */
    fun forget(path: String) {
        cache.forget(path)
        _urls.update { it - path }
    }
}
