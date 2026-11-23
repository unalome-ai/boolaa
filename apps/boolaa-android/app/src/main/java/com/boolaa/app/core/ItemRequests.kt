package com.boolaa.app.core

import android.util.Log
import com.boolaa.app.model.ItemKind
import com.boolaa.app.model.ItemRequest
import com.boolaa.app.model.MarketAvailability
import com.boolaa.app.model.RequestStatus
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
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.time.Instant

/** What a member who isn't the owner sees in an item's action row (docs/boolaa-spec.md "Requests and picking", UI rules). */
enum class RequesterView {
    /** No request of mine, item available: "I want it". */
    I_WANT_IT,
    /** No request of mine and the item is reserved or taken: no button. */
    NONE,
    /** Pending: chip "Requested" + "Withdraw request". */
    REQUESTED,
    /** Pending while the item is reserved for someone else: "Reserved · you're on the list". */
    ON_LIST,
    /** Picked: "Reserved for you" + "Withdraw request" (asks first). */
    RESERVED_FOR_YOU,
    /** Received: "It's yours". */
    YOURS,
    /** Missed: "Someone else got it". */
    MISSED,
}

/** Pure request rules (unit-tested; same cases as web and iOS). */
object RequestRules {
    const val NOTE_MAX = 200

    /** The note as the server stores it: trimmed, whitespace collapsed, null when empty. */
    fun normalizeNote(note: String?): String? = note?.trim()?.replace(Regex("\\s+"), " ")?.takeIf { it.isNotEmpty() }

    fun isOpen(r: ItemRequest) = r.status == RequestStatus.PENDING || r.status == RequestStatus.PICKED

    fun mine(requests: List<ItemRequest>, itemId: String, me: String?): ItemRequest? =
        if (me == null) null else requests.firstOrNull { it.itemId == itemId && it.requesterId == me }

    /** The owner's current pick on [itemId] (only the owner and the picked person can see one). */
    fun pick(requests: List<ItemRequest>, itemId: String): ItemRequest? =
        requests.firstOrNull { it.itemId == itemId && it.status == RequestStatus.PICKED }

    fun viewerState(availability: MarketAvailability, mine: ItemRequest?): RequesterView = when (mine?.status) {
        null -> if (availability == MarketAvailability.AVAILABLE) RequesterView.I_WANT_IT else RequesterView.NONE
        RequestStatus.PENDING -> if (availability == MarketAvailability.RESERVED) RequesterView.ON_LIST else RequesterView.REQUESTED
        RequestStatus.PICKED -> RequesterView.RESERVED_FOR_YOU
        RequestStatus.RECEIVED -> RequesterView.YOURS
        RequestStatus.MISSED -> RequesterView.MISSED
    }

    /** The owner's Requests sheet: open requests, the pick pinned on top, then oldest first (first come, first served). */
    fun sheetRows(requests: List<ItemRequest>, itemId: String): List<ItemRequest> =
        requests.filter { it.itemId == itemId && isOpen(it) }
            .sortedWith(compareBy<ItemRequest> { it.status != RequestStatus.PICKED }.thenBy { it.createdAt }.thenBy { it.id })

    /** Replaces by id (keeping a known requester when the live row has none) or adds; same list back when nothing changed. */
    fun upsert(rows: List<ItemRequest>, row: ItemRequest): List<ItemRequest> {
        val idx = rows.indexOfFirst { it.id == row.id }
        if (idx < 0) return rows + row
        val merged = if (row.requester == null) row.copy(requester = rows[idx].requester) else row
        if (merged == rows[idx]) return rows
        return rows.toMutableList().also { it[idx] = merged }
    }

    fun remove(rows: List<ItemRequest>, id: String): List<ItemRequest> =
        if (rows.none { it.id == id }) rows else rows.filterNot { it.id == id }

    /**
     * What the owner's RPC (or a market "Mark as") does to the request rows, applied locally until the live UPDATEs
     * arrive (the database applies the same mapping; merges by id make the echoes no-ops).
     */
    fun applyAvailability(rows: List<ItemRequest>, itemId: String, availability: MarketAvailability): List<ItemRequest> = rows.map { r ->
        if (r.itemId != itemId) return@map r
        val next = when (availability) {
            MarketAvailability.AVAILABLE -> RequestStatus.PENDING
            MarketAvailability.RESERVED -> when (r.status) {
                RequestStatus.RECEIVED -> RequestStatus.PICKED
                RequestStatus.MISSED -> RequestStatus.PENDING
                else -> r.status
            }
            MarketAvailability.TAKEN -> when (r.status) {
                RequestStatus.PICKED -> RequestStatus.RECEIVED
                RequestStatus.PENDING -> RequestStatus.MISSED
                else -> r.status
            }
        }
        if (next == r.status) r else r.copy(status = next)
    }

    /** Local pick: [picked] becomes picked, a previous pick on the same item goes back to pending. */
    fun applyPick(rows: List<ItemRequest>, picked: ItemRequest): List<ItemRequest> = rows.map { r ->
        when {
            r.id == picked.id -> r.copy(status = RequestStatus.PICKED)
            r.itemId == picked.itemId && r.status == RequestStatus.PICKED -> r.copy(status = RequestStatus.PENDING)
            else -> r
        }
    }
}

// API (every write is an RPC; reads are RLS-scoped: own requests + requests on own items)

private const val REQUEST_SELECT = "*, requester:users!requester_id(${BoolaaApi.AUTHOR_COLUMNS})"

suspend fun BoolaaApi.itemRequests(bubbleId: String, kind: ItemKind): List<ItemRequest> {
    val result = client.from("item_requests").select(Columns.raw(REQUEST_SELECT)) {
        filter { eq("bubble_id", bubbleId); eq("item_kind", kind.wire) }
    }
    return BoolaaJson.json.decodeFromString(ListSerializer(ItemRequest.serializer()), result.data)
}

suspend fun BoolaaApi.itemRequest(id: String): ItemRequest? {
    val result = client.from("item_requests").select(Columns.raw(REQUEST_SELECT)) { filter { eq("id", id) }; limit(1) }
    return BoolaaJson.json.decodeFromString(ListSerializer(ItemRequest.serializer()), result.data).firstOrNull()
}

private fun decodeRequest(data: String): ItemRequest = BoolaaJson.json.decodeFromString(ItemRequest.serializer(), data)

suspend fun BoolaaApi.requestItem(kind: ItemKind, itemId: String, note: String?): ItemRequest =
    decodeRequest(client.postgrest.rpc("request_item", buildJsonObject {
        put("p_kind", kind.wire); put("p_item_id", itemId)
        RequestRules.normalizeNote(note)?.let { put("p_note", it) }
    }).data)

/** False when the request was already gone (treated as success). */
suspend fun BoolaaApi.withdrawItemRequest(requestId: String): Boolean =
    BoolaaJson.json.parseToJsonElement(client.postgrest.rpc("withdraw_item_request", buildJsonObject { put("p_request_id", requestId) }).data)
        .let { (it as? JsonPrimitive)?.boolean ?: true }

suspend fun BoolaaApi.pickItemRequest(requestId: String): ItemRequest =
    decodeRequest(client.postgrest.rpc("pick_item_request", buildJsonObject { put("p_request_id", requestId) }).data)

suspend fun BoolaaApi.unpickItem(kind: ItemKind, itemId: String) {
    client.postgrest.rpc("unpick_item", buildJsonObject { put("p_kind", kind.wire); put("p_item_id", itemId) })
}

suspend fun BoolaaApi.handOverItem(kind: ItemKind, itemId: String): ItemRequest =
    decodeRequest(client.postgrest.rpc("hand_over_item", buildJsonObject { put("p_kind", kind.wire); put("p_item_id", itemId) }).data)

/**
 * The "I want it" requests of one Food or Marketplace screen: loaded after the list, kept live on the screen's channel
 * (INSERT/UPDATE filtered by bubble, DELETE unfiltered by id), and changed optimistically by the actions.
 */
class RequestStore(private val api: BoolaaApi, private val bubbleId: String, val kind: ItemKind) {
    private val _rows = MutableStateFlow<List<ItemRequest>>(emptyList())
    val rows: StateFlow<List<ItemRequest>> = _rows.asStateFlow()

    suspend fun load() { _rows.value = api.itemRequests(bubbleId, kind) }

    fun update(transform: (List<ItemRequest>) -> List<ItemRequest>) = _rows.update(transform)

    private suspend fun fetchAndMerge(id: String) {
        runCatching { api.itemRequest(id) }
            .onSuccess { row -> if (row != null && row.itemKind == kind) _rows.update { RequestRules.upsert(it, row) } }
            .onFailure { Log.w("Boolaa", "live item_requests: fetch $id", it) }
    }

    /** Adds the listeners to a screen's channel (call before it subscribes). */
    fun listenOn(ch: RealtimeChannel): CoroutineScope.() -> Unit {
        val inserts = ch.postgresChangeFlow<PostgresAction.Insert>(schema = "public") {
            table = "item_requests"; filter("bubble_id", FilterOperator.EQ, bubbleId)
        }
        val updates = ch.postgresChangeFlow<PostgresAction.Update>(schema = "public") {
            table = "item_requests"; filter("bubble_id", FilterOperator.EQ, bubbleId)
        }
        val deletes = ch.postgresChangeFlow<PostgresAction.Delete>(schema = "public") { table = "item_requests" }
        fun idOf(record: JsonObject) = record["id"]?.jsonPrimitive?.content
        return {
            launch(start = CoroutineStart.UNDISPATCHED) {
                inserts.collect { a -> idOf(a.record)?.let { if (_rows.value.none { r -> r.id == it }) fetchAndMerge(it) } }
            }
            launch(start = CoroutineStart.UNDISPATCHED) {
                updates.collect { a ->
                    val id = idOf(a.record) ?: return@collect
                    val known = _rows.value.any { it.id == id }
                    val row = if (known) runCatching { BoolaaJson.json.decodeFromJsonElement(ItemRequest.serializer(), a.record) }.getOrNull() else null
                    if (row != null) { if (row.itemKind == kind) _rows.update { RequestRules.upsert(it, row) } } else fetchAndMerge(id)
                }
            }
            launch(start = CoroutineStart.UNDISPATCHED) {
                deletes.collect { a -> idOf(a.oldRecord)?.let { id -> _rows.update { RequestRules.remove(it, id) } } }
            }
        }
    }

    companion object {
        /** A placeholder row shown at once after "Send request" until the RPC answers. */
        fun optimistic(kind: ItemKind, bubbleId: String, ownerId: String, itemId: String, me: String, note: String?) = ItemRequest(
            id = "local-$itemId", bubbleId = bubbleId, ownerId = ownerId, requesterId = me, itemKind = kind, itemId = itemId,
            note = RequestRules.normalizeNote(note), createdAt = Instant.now(),
        )
    }
}
