package com.boolaa.app.core

import android.util.Log
import com.boolaa.app.model.BubbleEvent
import com.boolaa.app.model.FoodPost
import com.boolaa.app.model.MarketItem
import com.boolaa.app.model.SharedLink
import com.boolaa.app.model.UserProfile
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.filter.FilterOperator
import io.github.jan.supabase.realtime.PostgresAction
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.postgresChangeFlow
import io.github.jan.supabase.realtime.realtime
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.util.UUID

/**
 * How one bubble feed (supabase/migrations/20261123110000_realtime_feeds.sql) is read and merged.
 * [author]/[withAuthor] cover the joined author a realtime payload never carries.
 */
class FeedSpec<T>(
    val table: String,
    val select: String,
    val serializer: KSerializer<T>,
    val id: (T) -> String,
    val author: (T) -> UserProfile?,
    val withAuthor: (T, UserProfile?) -> T,
    val order: Comparator<T>,
)

object FeedSpecs {
    private fun author(alias: String, fk: String) = "*, $alias:users!$fk(${BoolaaApi.AUTHOR_COLUMNS})"
    private fun <T> newestFirst(createdAt: (T) -> java.time.Instant, id: (T) -> String): Comparator<T> =
        compareByDescending<T>(createdAt).thenBy(id)

    val events = FeedSpec(
        "events", author("creator", "creator_id"), BubbleEvent.serializer(), { it.id }, { it.creator }, { e, a -> e.copy(creator = a) },
        compareBy<BubbleEvent> { it.datetime }.thenBy { it.id },
    )
    val food = FeedSpec(
        "food_posts", author("user", "user_id"), FoodPost.serializer(), { it.id }, { it.user }, { p, a -> p.copy(user = a) },
        newestFirst({ it.createdAt }, { it.id }),
    )
    val market = FeedSpec(
        "market_items", author("owner", "owner_id"), MarketItem.serializer(), { it.id }, { it.owner }, { i, a -> i.copy(owner = a) },
        newestFirst({ it.createdAt }, { it.id }),
    )
    val links = FeedSpec(
        "shared_links", author("user", "user_id"), SharedLink.serializer(), { it.id }, { it.user }, { l, a -> l.copy(user = a) },
        newestFirst({ it.createdAt }, { it.id }),
    )
}

/** Pure merge rules for live feed changes (unit-tested; same cases as web and iOS). */
object FeedMerge {
    /**
     * Inserts or replaces [row] by id, keeping [FeedSpec.order]. A missing author is kept from the row already in
     * the list. Returns [rows] itself when nothing differs (the echo of our own write), so Compose has nothing to
     * redraw. A null list (first load still running) stays null: the load brings the row.
     */
    fun <T> upsert(rows: List<T>?, row: T, spec: FeedSpec<T>): List<T>? {
        if (rows == null) return null
        val idx = rows.indexOfFirst { spec.id(it) == spec.id(row) }
        if (idx < 0) return (rows + row).sortedWith(spec.order)
        val merged = if (spec.author(row) == null) spec.withAuthor(row, spec.author(rows[idx])) else row
        if (merged == rows[idx]) return rows
        return rows.toMutableList().also { it[idx] = merged }.sortedWith(spec.order)
    }

    /** Removes the row with [id]; ids we don't hold (another bubble's delete) change nothing. */
    fun <T> remove(rows: List<T>?, id: String, spec: FeedSpec<T>): List<T>? =
        if (rows == null || rows.none { spec.id(it) == id }) rows else rows.filterNot { spec.id(it) == id }
}

/** One feed row with its author, or null when RLS hides it or it is gone. */
suspend fun <T> BoolaaApi.feedRow(spec: FeedSpec<T>, id: String): T? {
    val result = client.from(spec.table).select(Columns.raw(spec.select)) {
        filter { eq("id", id) }
        limit(1)
    }
    return BoolaaJson.json.decodeFromString(ListSerializer(spec.serializer), result.data).firstOrNull()
}

/**
 * Keeps [rows] live for [bubbleId] until the calling coroutine is cancelled (the screen leaves composition, the
 * bubble changes, sign-out). INSERT/UPDATE are filtered by `bubble_id` and RLS-checked by Realtime, so blocked
 * authors and unverified sessions get nothing. DELETE only carries the id and can't be filtered: it removes by id.
 * New rows are fetched once with their author (RLS decides again). [reload] runs once subscribed, to catch changes
 * made while connecting.
 */
suspend fun <T> BoolaaApi.keepFeedLive(spec: FeedSpec<T>, bubbleId: String, rows: MutableStateFlow<List<T>?>, reload: suspend () -> Unit) {
    val ch = client.channel("${spec.table}:$bubbleId:${UUID.randomUUID()}")
    val inserts = ch.postgresChangeFlow<PostgresAction.Insert>(schema = "public") {
        table = spec.table
        filter("bubble_id", FilterOperator.EQ, bubbleId)
    }
    val updates = ch.postgresChangeFlow<PostgresAction.Update>(schema = "public") {
        table = spec.table
        filter("bubble_id", FilterOperator.EQ, bubbleId)
    }
    val deletes = ch.postgresChangeFlow<PostgresAction.Delete>(schema = "public") { table = spec.table }

    suspend fun fetchAndMerge(id: String) {
        runCatching { feedRow(spec, id) }
            .onSuccess { row -> if (row != null) rows.update { FeedMerge.upsert(it, row, spec) } }
            .onFailure { Log.w("Boolaa", "live ${spec.table}: fetch $id", it) }
    }
    fun idOf(record: JsonObject) = record["id"]?.jsonPrimitive?.content

    try {
        coroutineScope {
            launch(start = CoroutineStart.UNDISPATCHED) {
                inserts.collect { action -> idOf(action.record)?.let { fetchAndMerge(it) } }
            }
            launch(start = CoroutineStart.UNDISPATCHED) {
                updates.collect { action ->
                    val id = idOf(action.record) ?: return@collect
                    val known = rows.value?.any { spec.id(it) == id } == true
                    val row = if (known) runCatching { BoolaaJson.json.decodeFromJsonElement(spec.serializer, action.record) }.getOrNull() else null
                    if (row != null) rows.update { FeedMerge.upsert(it, row, spec) } else fetchAndMerge(id)
                }
            }
            launch(start = CoroutineStart.UNDISPATCHED) {
                deletes.collect { action -> idOf(action.oldRecord)?.let { id -> rows.update { FeedMerge.remove(it, id, spec) } } }
            }
            runCatching { ch.subscribe(blockUntilSubscribed = true) }
                .onSuccess { reload() }
                .onFailure { Log.w("Boolaa", "realtime subscribe ${spec.table} failed", it) } // pull-to-refresh still works
            awaitCancellation()
        }
    } finally {
        withContext(NonCancellable) { runCatching { client.realtime.removeChannel(ch) } }
    }
}
