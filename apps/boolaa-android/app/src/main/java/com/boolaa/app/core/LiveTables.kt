package com.boolaa.app.core

import android.util.Log
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.query.filter.FilterOperator
import io.github.jan.supabase.realtime.PostgresAction
import io.github.jan.supabase.realtime.RealtimeChannel
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.postgresChangeFlow
import io.github.jan.supabase.realtime.realtime
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.util.UUID

/** A table to watch, optionally filtered with `column=eq.value`. */
data class TableWatch(val table: String, val column: String? = null, val value: String? = null)

/**
 * One realtime channel watching several tables. Realtime does not apply filters (or RLS) to DELETE events, and their
 * old record only carries the primary key, so DELETEs are always subscribed unfiltered: callers check [oldValue].
 */
class LiveTables private constructor(private val client: SupabaseClient, private val channel: RealtimeChannel, private val job: Job) {
    suspend fun close() {
        job.cancel()
        runCatching { client.realtime.removeChannel(channel) }
    }

    companion object {
        fun open(
            client: SupabaseClient,
            scope: CoroutineScope,
            name: String,
            watches: List<TableWatch>,
            onChange: suspend (table: String, action: PostgresAction) -> Unit,
        ): LiveTables {
            val channel = client.channel("$name:${UUID.randomUUID()}")
            val flows: List<Flow<Pair<String, PostgresAction>>> = watches.flatMap { w ->
                val changes = channel.postgresChangeFlow<PostgresAction>(schema = "public") {
                    table = w.table
                    if (w.column != null && w.value != null) filter(w.column, FilterOperator.EQ, w.value)
                }
                val deletes = if (w.column != null) channel.postgresChangeFlow<PostgresAction.Delete>(schema = "public") { table = w.table } else null
                listOfNotNull(
                    flow<Pair<String, PostgresAction>> { changes.collect { if (it !is PostgresAction.Delete || w.column == null) emit(w.table to it) } },
                    deletes?.let { d -> flow<Pair<String, PostgresAction>> { d.collect { emit(w.table to it) } } },
                )
            }
            val job = scope.launch(start = CoroutineStart.UNDISPATCHED) {
                launch(start = CoroutineStart.UNDISPATCHED) {
                    merge(*flows.toTypedArray()).collect { (table, action) ->
                        runCatching { onChange(table, action) }.onFailure { Log.w("Boolaa", "live $name", it) }
                    }
                }
                runCatching { channel.subscribe() }.onFailure { Log.w("Boolaa", "realtime subscribe $name failed", it) }
            }
            return LiveTables(client, channel, job)
        }

        /** A primary-key column from a DELETE's old record. */
        fun oldValue(action: PostgresAction, column: String): String? =
            (action as? PostgresAction.Delete)?.oldRecord?.let { (it as JsonObject)[column]?.jsonPrimitive?.content }
    }
}
