package com.boolaa.app.core

import android.util.Log
import com.boolaa.app.model.ChatMessage
import com.boolaa.app.model.Timestamp
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import java.text.Normalizer
import java.util.Locale

/**
 * Search inside a bubble (docs/boolaa-spec.md "Search", supabase/migrations/20261123180000_bubble_search.sql).
 * Pure helpers: query rules, RPC row decoding, client-side highlight ranges and the chat jump window.
 */

/** What a hit points at; [wire] is the RPC's `kind`. Unknown kinds are dropped (forward compatibility). */
enum class SearchKind(val wire: String) {
    CHAT_MESSAGE("chat_message"), EVENT("event"), FOOD_POST("food_post"), MARKET_ITEM("market_item"), SHARED_LINK("shared_link");

    companion object {
        fun fromWire(value: String): SearchKind? = entries.firstOrNull { it.wire == value }
    }
}

/** One row of `search_bubble` as it comes over the wire. */
@Serializable
data class SearchHitRow(
    val kind: String,
    val id: String,
    val title: String? = null,
    val snippet: String? = null,
    @SerialName("author_id") val authorId: String? = null,
    @SerialName("author_name") val authorName: String? = null,
    @SerialName("created_at") val createdAt: Timestamp,
    @SerialName("event_at") val eventAt: Timestamp? = null,
    val rank: Float = 0f,
    @SerialName("matched_words") val matchedWords: List<String> = emptyList(),
)

/** A decoded hit of a kind this client knows. */
data class SearchHit(
    val kind: SearchKind,
    val id: String,
    val title: String?,
    val snippet: String?,
    val authorId: String?,
    val authorName: String?,
    val createdAt: java.time.Instant,
    val eventAt: java.time.Instant?,
    val matchedWords: List<String>,
)

object SearchRules {
    /** Shorter queries (after trim) return nothing on the server; the client doesn't call it. */
    const val MIN_QUERY_LENGTH = 2
    const val LIMIT = 30
    const val DEBOUNCE_MS = 300L

    fun canSearch(query: String): Boolean = query.trim().length >= MIN_QUERY_LENGTH

    /** Decodes the RPC's JSON array, best first; rows of unknown kinds (or that don't decode) are skipped. */
    fun decode(json: String): List<SearchHit> {
        val array = BoolaaJson.json.parseToJsonElement(json) as? JsonArray ?: return emptyList()
        return array.mapNotNull { element ->
            val row = runCatching { BoolaaJson.json.decodeFromJsonElement(SearchHitRow.serializer(), element) }
                .onFailure { runCatching { Log.w("Boolaa", "bad search row", it) } }.getOrNull() ?: return@mapNotNull null
            val kind = SearchKind.fromWire(row.kind) ?: return@mapNotNull null
            SearchHit(kind, row.id, row.title, row.snippet, row.authorId, row.authorName, row.createdAt, row.eventAt, row.matchedWords)
        }
    }
}

/** Letters that don't decompose under NFD but should match their plain spelling. */
private val Expansions = mapOf(
    'œ' to "oe", 'Œ' to "oe", 'æ' to "ae", 'Æ' to "ae", 'ß' to "ss", 'ẞ' to "ss",
    'ø' to "o", 'Ø' to "o", 'ł' to "l", 'Ł' to "l", 'đ' to "d", 'Đ' to "d", 'ı' to "i",
)
private val CombiningMark = Regex("\\p{M}")

/**
 * [text] folded for matching (NFD, combining marks dropped, lower case in [Locale.ROOT], œ→oe and friends) and, for
 * each folded character, the index of the original character it came from.
 */
fun foldForSearch(text: String): Pair<String, IntArray> {
    val out = StringBuilder(text.length)
    val map = ArrayList<Int>(text.length)
    var i = 0
    while (i < text.length) {
        val cp = text.codePointAt(i)
        val len = Character.charCount(cp)
        val stripped = Normalizer.normalize(text.substring(i, i + len), Normalizer.Form.NFD)
            .replace(CombiningMark, "").lowercase(Locale.ROOT)
        val folded = buildString { stripped.forEach { ch -> append(Expansions[ch] ?: ch.toString()) } }
        folded.forEach { ch -> out.append(ch); map.add(i) }
        i += len
    }
    return out.toString() to map.toIntArray()
}

/** Folds a single word the same way as the text (the server already sends folded words; this is for safety). */
fun foldWord(word: String): String = foldForSearch(word).first

/**
 * Ranges (inclusive, in [text]'s indices) of every occurrence of each of [words], matched diacritic- and
 * case-insensitively anywhere in a word; overlapping or touching ranges are merged. Sorted.
 */
fun highlightRanges(text: String, words: List<String>): List<IntRange> {
    if (text.isEmpty()) return emptyList()
    val needles = words.map(::foldWord).filter { it.isNotEmpty() }.distinct()
    if (needles.isEmpty()) return emptyList()
    val (folded, map) = foldForSearch(text)
    val found = mutableListOf<IntRange>()
    for (needle in needles) {
        var from = 0
        while (true) {
            val at = folded.indexOf(needle, from)
            if (at < 0) break
            val start = map[at]
            val lastOriginal = map[at + needle.length - 1]
            // Cover the whole original character (surrogate pairs).
            val end = lastOriginal + Character.charCount(text.codePointAt(lastOriginal)) - 1
            found += start..end
            from = at + 1
        }
    }
    if (found.isEmpty()) return emptyList()
    found.sortBy { it.first }
    val merged = mutableListOf(found.first())
    for (r in found.drop(1)) {
        val last = merged.last()
        if (r.first <= last.last + 1) merged[merged.size - 1] = last.first..maxOf(last.last, r.last) else merged += r
    }
    return merged
}

/** The result of `chat_messages_around` for one target. */
data class ChatJumpWindow(
    /** The rows to merge into the chat (newest first, as returned). */
    val rows: List<ChatMessage>,
    /** False when fewer than [ChatJump.BEFORE] rows are older than the target: the start of the chat is loaded. */
    val hasMoreOlder: Boolean,
)

object ChatJump {
    /** Rows older than the target that `chat_messages_around` returns (its default `p_before`). */
    const val BEFORE = 25

    private val order: Comparator<ChatMessage> = compareBy<ChatMessage> { it.createdAt }.thenBy { it.id }

    /** Null when [targetId] isn't among [rows] (no access, deleted, unknown, or too far back for the cap). */
    fun window(rows: List<ChatMessage>, targetId: String): ChatJumpWindow? {
        val target = rows.firstOrNull { it.id == targetId } ?: return null
        val older = rows.count { order.compare(it, target) < 0 }
        return ChatJumpWindow(rows, hasMoreOlder = older >= BEFORE)
    }

    /**
     * "More older pages" after merging [window] into a chat that held [current] with [currentHasMore]: if what was
     * already held reaches further back than the window, the old flag still describes the oldest row.
     */
    fun hasMoreAfterMerge(current: List<ChatMessage>, currentHasMore: Boolean, window: ChatJumpWindow): Boolean {
        val oldestHeld = current.minWithOrNull(order) ?: return window.hasMoreOlder
        val oldestWindow = window.rows.minWithOrNull(order) ?: return currentHasMore
        return if (order.compare(oldestHeld, oldestWindow) < 0) currentHasMore else window.hasMoreOlder
    }
}
