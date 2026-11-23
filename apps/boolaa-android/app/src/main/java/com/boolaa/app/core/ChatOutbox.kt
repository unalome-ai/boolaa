package com.boolaa.app.core

import android.util.Log
import com.boolaa.app.model.ChatMessage
import com.boolaa.app.model.Timestamp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.Transient
import kotlinx.serialization.builtins.ListSerializer
import java.io.File
import java.time.Instant
import java.util.UUID

@Serializable
enum class OutboxState {
    /** "Sending…": being sent, or waiting for the connection to come back. */
    @SerialName("sending") SENDING,
    /** "Not sent — tap to retry". */
    @SerialName("failed") FAILED,
}

/**
 * A chat message written but not yet confirmed by the server. [clientId] becomes the row's `id`, so a retry of a
 * message whose first insert did arrive is refused as a duplicate (23505) and counted as sent: no doubles. A photo
 * ([photo], the processed JPEG) lives in memory only; text messages are persisted.
 */
@Serializable
data class PendingMessage(
    val clientId: String,
    val bubbleId: String,
    val senderId: String,
    val content: String,
    val createdAt: Timestamp,
    val state: OutboxState = OutboxState.SENDING,
    @Transient val photo: ByteArray? = null,
) {
    val hasPhoto: Boolean get() = photo != null
    /** The photo's object path: `<uid>/<clientId>.jpg`, the same on every retry. */
    val photoPath: String? get() = if (photo != null) BoolaaApi.imagePath(senderId, UUID.fromString(clientId)) else null

    companion object {
        fun create(bubbleId: String, senderId: String, content: String, photo: ByteArray?, now: Instant = Instant.now()) =
            PendingMessage(UUID.randomUUID().toString(), bubbleId, senderId, content, now, OutboxState.SENDING, photo)
    }
}

/** Pure rules of the outbox (unit-tested). */
object OutboxRules {
    /** Postgres unique_violation: the row with this client id (or this photo path) already exists, i.e. it was sent. */
    fun isUniqueViolation(code: String?) = code == "23505"

    /** Storage answers a second upload of the same path with 409 / "Duplicate" / "already exists": it is uploaded. */
    fun isDuplicateObject(statusCode: Int?, error: String?, message: String?): Boolean {
        val text = listOfNotNull(error, message).joinToString(" ").lowercase()
        return statusCode == 409 || "duplicate" in text || "already exists" in text
    }

    /** Messages restored after a restart wait for a tap: no surprise sends of stale text. */
    fun restored(items: List<PendingMessage>): List<PendingMessage> =
        items.filter { it.photo == null }.map { it.copy(state = OutboxState.FAILED) }

    /** The pending messages of one bubble, in the order they were written (shown after the server messages). */
    fun forBubble(items: List<PendingMessage>, bubbleId: String): List<PendingMessage> =
        items.filter { it.bubbleId == bubbleId }.sortedBy { it.createdAt }

    /** A pending message the server list already holds (delivered, echo arrived first) is not shown twice. */
    fun visible(pending: List<PendingMessage>, serverIds: Set<String>): List<PendingMessage> =
        pending.filter { it.clientId !in serverIds }
}

/**
 * Chat messages typed offline or on a bad network (docs/boolaa-spec.md "Offline and poor network"): queued, shown as
 * "Sending…", sent one at a time in order, flushed when the connection comes back, "Not sent — tap to retry" after a
 * failure. Text messages are persisted per user in `filesDir/outbox/<userId>.json` and cleared on sign-out.
 */
class ChatOutbox(
    private val dir: File,
    private val scope: CoroutineScope,
    private val isOnline: () -> Boolean,
    /** Sends one message (upload + insert, with the client id) and returns the server row. */
    private val attempt: suspend (PendingMessage) -> ChatMessage,
    private val ioDispatcher: kotlinx.coroutines.CoroutineDispatcher = Dispatchers.IO,
) {
    private val _items = MutableStateFlow<List<PendingMessage>>(emptyList())
    val items: StateFlow<List<PendingMessage>> = _items.asStateFlow()
    private val _delivered = MutableSharedFlow<ChatMessage>(extraBufferCapacity = 32)
    /** Server rows of delivered messages (the chat merges them by id). */
    val delivered: SharedFlow<ChatMessage> = _delivered
    private val sendLock = Mutex()
    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    private val writer = ioDispatcher.limitedParallelism(1)
    @Volatile private var userId: String? = null

    /** Signed in as [user]: load what was left unsent (as failed). */
    fun restore(user: String) {
        if (userId == user) return
        userId = user
        val file = fileFor(user)
        val restored = runCatching {
            if (file.isFile) OutboxRules.restored(BoolaaJson.json.decodeFromString(ListSerializer(PendingMessage.serializer()), file.readText()))
            else emptyList()
        }.getOrElse { file.delete(); emptyList() }
        _items.value = restored
    }

    /** Sign-out / account deletion: nothing is kept, for anyone. */
    fun clear() {
        userId = null
        _items.value = emptyList()
        dir.deleteRecursively()
    }

    /** Queues [message] and sends it now if online (else it waits for [flush]). */
    fun send(message: PendingMessage) {
        _items.update { it + message }
        persist()
        if (isOnline()) scope.launch { deliver(message.clientId) }
    }

    /** "Tap to retry". */
    fun retry(clientId: String) {
        update(clientId) { it.copy(state = OutboxState.SENDING) }
        if (isOnline()) scope.launch { deliver(clientId) }
    }

    /** "Don't send": removes the message (the caller removes an uploaded photo). */
    fun discard(clientId: String): PendingMessage? {
        val removed = _items.value.firstOrNull { it.clientId == clientId } ?: return null
        _items.update { list -> list.filterNot { it.clientId == clientId } }
        persist()
        return removed
    }

    /** Back online: sends every waiting message in order. */
    fun flush() {
        if (!isOnline()) return
        scope.launch {
            _items.value.filter { it.state == OutboxState.SENDING }.forEach { deliver(it.clientId) }
        }
    }

    /** Sends one message; true when the server has it. Serialised so messages arrive in the order they were written. */
    suspend fun deliver(clientId: String): Boolean = sendLock.withLock {
        val message = _items.value.firstOrNull { it.clientId == clientId && it.state == OutboxState.SENDING } ?: return@withLock false
        if (!isOnline()) return@withLock false
        try {
            val row = attempt(message)
            _items.update { list -> list.filterNot { it.clientId == clientId } }
            persist()
            _delivered.tryEmit(row)
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            update(clientId) { it.copy(state = OutboxState.FAILED) }
            runCatching { Log.w("Boolaa", "chat send failed", e) }
            false
        }
    }

    private fun update(clientId: String, change: (PendingMessage) -> PendingMessage) {
        _items.update { list -> list.map { if (it.clientId == clientId) change(it) else it } }
        persist()
    }

    private fun persist() {
        val user = userId ?: return
        val text = _items.value.filter { !it.hasPhoto }
        scope.launch(writer) {
            if (userId != user) return@launch
            runCatching {
                val file = fileFor(user)
                if (text.isEmpty()) { file.delete(); return@runCatching }
                dir.mkdirs()
                val tmp = File(dir, file.name + ".tmp")
                tmp.writeText(BoolaaJson.json.encodeToString(ListSerializer(PendingMessage.serializer()), text))
                if (!tmp.renameTo(file)) { file.delete(); tmp.renameTo(file) }
            }.onFailure { runCatching { Log.w("Boolaa", "outbox: persist failed", it) } }
        }
    }

    private fun fileFor(user: String) = File(dir, user.replace(Regex("[^A-Za-z0-9._-]"), "_") + ".json")
}
