package com.boolaa.app.core

import android.util.Log
import com.boolaa.app.model.Reaction
import com.boolaa.app.model.ReactionKind
import com.boolaa.app.model.ReactionTarget
import com.boolaa.app.model.ReactionToggle
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.filter.FilterOperator
import io.github.jan.supabase.realtime.PostgresAction
import io.github.jan.supabase.realtime.RealtimeChannel
import io.github.jan.supabase.realtime.postgresChangeFlow
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/** One chip: a reaction with its count on a target, and whether it is the reader's own. */
data class ReactionSummary(val kind: ReactionKind, val count: Int, val mine: Boolean)

/**
 * Pure merge rules for reactions (docs/boolaa-spec.md "Reactions"), unit-tested. Rows are keyed by their random id:
 * a realtime DELETE carries only that id, so it is all we ever need to remove one. Every function returns the same
 * map instance when nothing changes (the echo of our own toggle), so Compose has nothing to redraw.
 */
object ReactionMerge {
    const val CHUNK = 100

    fun add(rows: Map<String, Reaction>, r: Reaction): Map<String, Reaction> =
        if (rows[r.id] == r || ReactionKind.of(r.reaction) == null) rows else rows + (r.id to r)

    fun remove(rows: Map<String, Reaction>, id: String): Map<String, Reaction> = if (id in rows) rows - id else rows

    /** Applies a `toggle_reaction` result for [me]: add the row when reacted, else remove it by id. */
    fun applyToggle(rows: Map<String, Reaction>, t: ReactionToggle, me: String): Map<String, Reaction> =
        if (t.reacted) add(rows, Reaction(t.id, t.targetType, t.targetId, t.reaction, me)) else remove(rows, t.id)

    /** Drops every reaction on [targetId] (a chat message that was soft-deleted, a deleted post). */
    fun dropTarget(rows: Map<String, Reaction>, targetId: String): Map<String, Reaction> =
        if (rows.values.none { it.targetId == targetId }) rows else rows.filterValues { it.targetId != targetId }

    /** Replaces what we hold for [targetIds] with [fetched] (the server's answer for exactly those targets). */
    fun replaceFor(rows: Map<String, Reaction>, targetIds: Set<String>, fetched: List<Reaction>): Map<String, Reaction> {
        val next = rows.filterValues { it.targetId !in targetIds }.toMutableMap()
        fetched.filter { it.targetId in targetIds && ReactionKind.of(it.reaction) != null }.forEach { next[it.id] = it }
        return if (next == rows) rows else next
    }

    /** Chips per target, in the fixed order, only reactions with a count. */
    fun summaries(rows: Map<String, Reaction>, me: String?): Map<String, List<ReactionSummary>> =
        rows.values.groupBy { it.targetId }.mapValues { (_, list) ->
            ReactionKind.entries.mapNotNull { kind ->
                val of = list.filter { it.reaction == kind.wire }
                if (of.isEmpty()) null else ReactionSummary(kind, of.size, of.any { it.userId == me })
            }
        }

    fun chunks(ids: Collection<String>): List<List<String>> = ids.distinct().chunked(CHUNK)
}

suspend fun BoolaaApi.reactions(bubbleId: String, target: ReactionTarget, targetIds: Collection<String>): List<Reaction> =
    ReactionMerge.chunks(targetIds).flatMap { chunk ->
        val result = client.from("reactions").select(Columns.raw("id, target_type, target_id, reaction, user_id")) {
            filter {
                eq("bubble_id", bubbleId)
                eq("target_type", target.wire)
                isIn("target_id", chunk)
            }
        }
        BoolaaJson.json.decodeFromString(ListSerializer(Reaction.serializer()), result.data)
    }

suspend fun BoolaaApi.toggleReaction(target: ReactionTarget, targetId: String, kind: ReactionKind): ReactionToggle {
    val data = client.postgrest.rpc("toggle_reaction", buildJsonObject {
        put("p_target_type", target.wire); put("p_target_id", targetId); put("p_reaction", kind.wire)
    }).data
    return ReactionCodec.toggle(data)
}

object ReactionCodec {
    /** `toggle_reaction` returns a jsonb object (PostgREST may wrap it in an array). */
    fun toggle(data: String): ReactionToggle {
        val element = BoolaaJson.json.parseToJsonElement(data)
        val obj = if (element is kotlinx.serialization.json.JsonArray) element.first() else element
        return BoolaaJson.json.decodeFromJsonElement(ReactionToggle.serializer(), obj)
    }

    fun record(record: JsonObject): Reaction? =
        runCatching { BoolaaJson.json.decodeFromJsonElement(Reaction.serializer(), record) }.getOrNull()
}

/**
 * The reactions one screen holds for its [target] type in one bubble. [holds] tells whether a target is in the
 * screen's list (live INSERTs for anything else are ignored). Call [refresh] after a full load and [sync] whenever the
 * list's ids change (live rows, older chat pages).
 */
class ReactionStore(
    private val api: BoolaaApi,
    private val bubbleId: String,
    val target: ReactionTarget,
    private val holds: (String) -> Boolean,
) {
    private val _rows = MutableStateFlow<Map<String, Reaction>>(emptyMap())
    val rows = _rows.asStateFlow()
    private val loaded = mutableSetOf<String>()

    /** Reloads everything for [ids]; a failure only leaves the chips as they were (the list itself still shows). */
    suspend fun refresh(ids: Collection<String>) {
        val set = ids.toSet()
        synchronized(loaded) { loaded.clear(); loaded += set }
        runCatching { if (set.isEmpty()) emptyList() else api.reactions(bubbleId, target, set) }
            .onSuccess { fetched -> _rows.update { current -> ReactionMerge.replaceFor(current.filterValues { it.targetId in set }, set, fetched) } }
            .onFailure { e ->
                if (e is kotlinx.coroutines.CancellationException) throw e
                synchronized(loaded) { loaded -= set }
                Log.w("Boolaa", "reactions ${target.wire}", e)
            }
    }

    suspend fun sync(ids: Collection<String>) {
        val fresh = synchronized(loaded) { ids.filter { it !in loaded }.toSet().also { loaded += it } }
        if (fresh.isEmpty()) return
        runCatching { api.reactions(bubbleId, target, fresh) }
            .onSuccess { fetched -> _rows.update { ReactionMerge.replaceFor(it, fresh, fetched) } }
            .onFailure { synchronized(loaded) { loaded -= fresh }; Log.w("Boolaa", "reactions ${target.wire}", it) }
    }

    suspend fun toggle(targetId: String, kind: ReactionKind, me: String) {
        val result = api.toggleReaction(target, targetId, kind)
        _rows.update { ReactionMerge.applyToggle(it, result, me) }
    }

    fun dropTarget(targetId: String) = _rows.update { ReactionMerge.dropTarget(it, targetId) }

    fun onInsert(record: JsonObject) {
        val r = ReactionCodec.record(record) ?: return
        if (r.targetType == target.wire && holds(r.targetId)) _rows.update { ReactionMerge.add(it, r) }
    }

    fun onDelete(id: String) = _rows.update { ReactionMerge.remove(it, id) }

    /**
     * Adds the reactions listeners to a screen's channel (call before it subscribes): INSERT filtered by bubble
     * (RLS-checked by Realtime), DELETE unfiltered (only the id arrives, ids we don't hold change nothing).
     */
    fun listenOn(ch: RealtimeChannel): CoroutineScope.() -> Unit {
        val inserts = ch.postgresChangeFlow<PostgresAction.Insert>(schema = "public") {
            table = "reactions"
            filter("bubble_id", FilterOperator.EQ, bubbleId)
        }
        val deletes = ch.postgresChangeFlow<PostgresAction.Delete>(schema = "public") { table = "reactions" }
        return {
            launch(start = CoroutineStart.UNDISPATCHED) { inserts.collect { onInsert(it.record) } }
            launch(start = CoroutineStart.UNDISPATCHED) {
                deletes.collect { a -> a.oldRecord["id"]?.jsonPrimitive?.content?.let { onDelete(it) } }
            }
        }
    }
}
