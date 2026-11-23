package com.boolaa.app.core

import android.util.Log
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.io.File
import java.time.Duration
import java.time.Instant

/**
 * The last successfully loaded data of each main screen, per user, as small JSON files
 * (`cacheDir/offline/<userId>/<key>.json`, envelope `{"v":1,"savedAt":…,"data":…}`), so screens show something at
 * once on launch and offline (docs/boolaa-spec.md "Offline and poor network"). Rows keep only our storage
 * identifiers; signed photo URLs are never written here. Blocking I/O: call it off the main thread.
 */
class OfflineCache(private val root: File, private val clock: () -> Instant = Instant::now) {
    /** Saves [value] under [key] for [userId] (write to a temp file, then rename: never a half-written file). */
    fun <T> save(userId: String, key: String, serializer: KSerializer<T>, value: T) {
        runCatching {
            val dir = dirFor(userId).apply { mkdirs() }
            val envelope = buildJsonObject {
                put("v", VERSION)
                put("savedAt", clock().toString())
                put("data", BoolaaJson.json.encodeToJsonElement(serializer, value))
            }
            val target = File(dir, fileName(key))
            val tmp = File(dir, fileName(key) + ".tmp")
            tmp.writeText(envelope.toString())
            if (!tmp.renameTo(target)) { target.delete(); tmp.renameTo(target) }
        }.onFailure { Log.w("Boolaa", "offline cache: save $key failed", it) }
    }

    /** The cached value, or null (missing, other version, undecodable or older than [MAX_AGE]: then deleted). */
    fun <T> load(userId: String, key: String, serializer: KSerializer<T>): T? {
        val file = File(dirFor(userId), fileName(key))
        if (!file.isFile) return null
        return runCatching {
            val envelope = BoolaaJson.json.parseToJsonElement(file.readText()).jsonObject
            val version = envelope["v"]?.jsonPrimitive?.intOrNull
            val savedAt = envelope["savedAt"]?.jsonPrimitive?.content?.let(Instant::parse)
            require(version == VERSION && savedAt != null && Duration.between(savedAt, clock()) <= MAX_AGE) { "stale" }
            BoolaaJson.json.decodeFromJsonElement(serializer, envelope["data"] ?: JsonObject(emptyMap()))
        }.getOrElse {
            file.delete()
            null
        }
    }

    /** Sign-out and account deletion: every user's cache goes. */
    fun clearAll() {
        root.deleteRecursively()
    }

    /** Signed in as [userId]: anything left from another account (a session that ended without a sign-out) goes. */
    fun keepOnly(userId: String) {
        val keep = safe(userId)
        root.listFiles()?.filter { it.name != keep }?.forEach { it.deleteRecursively() }
    }

    private fun dirFor(userId: String) = File(root, safe(userId))
    private fun fileName(key: String) = safe(key) + ".json"

    companion object {
        const val VERSION = 1
        val MAX_AGE: Duration = Duration.ofDays(30)
        private fun safe(s: String) = s.replace(Regex("[^A-Za-z0-9._-]"), "_")
    }
}

/** Cache keys (the same names on every client). */
object CacheKeys {
    const val BUBBLES = "bubbles"
    fun home(bubbleId: String) = "home.$bubbleId"
    fun chat(bubbleId: String) = "chat.$bubbleId"
    fun events(bubbleId: String) = "events.$bubbleId"
    fun food(bubbleId: String) = "food.$bubbleId"
    fun market(bubbleId: String) = "market.$bubbleId"
    fun links(bubbleId: String) = "links.$bubbleId"
    fun members(bubbleId: String) = "members.$bubbleId"
    /** The chat's mention candidates, cached beside the members (docs/boolaa-spec.md "Mentions"). */
    fun mentionCandidates(bubbleId: String) = "members.$bubbleId.mentions"
    /** The chat cache holds the newest page only. */
    const val CHAT_LIMIT = 50
}
