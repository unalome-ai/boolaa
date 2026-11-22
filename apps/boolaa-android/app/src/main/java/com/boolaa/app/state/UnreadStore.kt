package com.boolaa.app.state

import android.util.Log
import com.boolaa.app.core.BoolaaApi
import com.boolaa.app.model.ChatUnread
import io.github.jan.supabase.realtime.PostgresAction
import io.github.jan.supabase.realtime.RealtimeChannel
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.postgresChangeFlow
import io.github.jan.supabase.realtime.realtime
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import java.util.UUID

/**
 * Unread chat counts per bubble (`chat_unread_counts()`, docs/boolaa-spec.md "Unread counts") for the badges on the
 * bubble chips and the chat button. Refreshed on start / foreground ([refresh] from MainActivity.onStart), when the
 * bubble list changes, after marking read, and (debounced) on any `chat_messages` INSERT from the unfiltered channel
 * `unread:<user id>` (RLS limits it to the user's bubbles). Runs only while the main app is shown.
 */
class UnreadStore(private val api: BoolaaApi, private val session: SessionStore, private val scope: CoroutineScope) {
    private val _counts = MutableStateFlow<Map<String, ChatUnread>>(emptyMap())
    val counts: StateFlow<Map<String, ChatUnread>> = _counts.asStateFlow()

    private var userId: String? = null
    private var channel: RealtimeChannel? = null
    private var listenJob: Job? = null
    private var refreshJob: Job? = null
    private var debounceJob: Job? = null
    private var started = false

    fun start() {
        if (started) return
        started = true
        scope.launch {
            session.state
                .map { s -> s.userId?.takeIf { s.route == AppRoute.MAIN }?.let { it to s.bubbles.map { b -> b.id }.toSet() } }
                .distinctUntilChanged()
                .collect { key ->
                    if (key == null) stop() else {
                        if (key.first != userId) listen(key.first)
                        refresh()
                    }
                }
        }
    }

    /** Fetches the counts now (cancels a running fetch, so the newest answer wins). */
    fun refresh() {
        if (userId == null) return
        debounceJob?.cancel()
        refreshJob?.cancel()
        refreshJob = scope.launch {
            runCatching { api.chatUnreadCounts() }
                .onSuccess { rows -> if (userId != null) _counts.value = rows.associateBy { it.bubbleId } }
                .onFailure { Log.w("Boolaa", "chat_unread_counts failed", it) }
        }
    }

    /** Coalesces a burst of new messages into one fetch. */
    fun refreshSoon() {
        if (debounceJob?.isActive == true) return
        debounceJob = scope.launch {
            delay(DEBOUNCE_MS)
            refresh()
        }
    }

    /** The marker the "New messages" divider uses for [bubbleId], when known. */
    fun lastReadAt(bubbleId: String) = _counts.value[bubbleId]?.lastReadAt

    private fun listen(uid: String) {
        closeChannel()
        userId = uid
        val ch = api.client.channel("unread:$uid:${UUID.randomUUID()}")
        channel = ch
        val inserts = ch.postgresChangeFlow<PostgresAction.Insert>(schema = "public") { table = "chat_messages" }
        listenJob = scope.launch {
            launch {
                inserts.collect { action ->
                    // Our own messages never count as unread.
                    val sender = (action.record["sender_id"] as? JsonPrimitive)?.content
                    if (sender != uid) refreshSoon()
                }
            }
            runCatching { ch.subscribe() }.onFailure { Log.w("Boolaa", "realtime subscribe unread failed", it) }
        }
    }

    private fun closeChannel() {
        listenJob?.cancel(); listenJob = null
        val ch = channel ?: return
        channel = null
        scope.launch { runCatching { api.client.realtime.removeChannel(ch) } }
    }

    private fun stop() {
        closeChannel()
        refreshJob?.cancel(); debounceJob?.cancel()
        userId = null
        _counts.value = emptyMap()
    }

    companion object {
        const val DEBOUNCE_MS = 1_500L
    }
}
