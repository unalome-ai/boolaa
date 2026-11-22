package com.boolaa.app.core

import com.boolaa.app.model.Block
import com.boolaa.app.model.Bubble
import com.boolaa.app.model.ReportReason
import com.boolaa.app.model.ReportTargetType
import com.boolaa.app.model.BubbleEvent
import com.boolaa.app.model.BubbleMember
import com.boolaa.app.model.ChatMessage
import com.boolaa.app.model.FoodPost
import com.boolaa.app.model.JoinRequest
import com.boolaa.app.model.MarketItem
import com.boolaa.app.model.MarketStatus
import com.boolaa.app.model.SharedLink
import com.boolaa.app.model.UserProfile
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Order
import io.github.jan.supabase.postgrest.result.PostgrestResult
import io.github.jan.supabase.storage.storage
import io.ktor.http.ContentType
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import java.time.Instant
import java.util.UUID

/** Inputs for the editable bubble content. */
data class EventInput(val title: String, val description: String?, val datetime: Instant, val location: String?)
data class FoodInput(val image: String, val description: String?)
data class MarketInput(val image: String, val title: String, val description: String?, val status: MarketStatus)

enum class ImageBucket(val id: String) { AVATARS("avatars"), FOOD("food.images"), MARKET("market.images") }

/** Every backend call the app makes (mirrors apps/boolaa-ios BoolaaAPI.swift). All access is subject to RLS. */
class BoolaaApi(val client: SupabaseClient) {
    private val json = BoolaaJson.json

    private inline fun <reified T> PostgrestResult.list(): List<T> = json.decodeFromString(data)

    /** Decodes a single row; PostgREST returns an object for scalar-composite RPCs and an array for selects. */
    private inline fun <reified T> PostgrestResult.one(): T {
        val element = json.parseToJsonElement(data)
        val obj = if (element is JsonArray) element.first() else element
        return json.decodeFromJsonElement<T>(obj)
    }

    private fun author(alias: String, fk: String) = "$alias:users!$fk($AUTHOR_COLUMNS)"

    // Profile

    suspend fun profile(userId: String): UserProfile =
        client.from("users").select { filter { eq("id", userId) } }.one()

    suspend fun updateProfile(userId: String, name: String? = null, avatar: String? = null): UserProfile {
        val patch = buildJsonObject {
            name?.let { put("name", it) }
            avatar?.let { put("avatar", it) }
        }
        return client.from("users").update(patch) {
            select()
            filter { eq("id", userId) }
        }.one()
    }

    // Bubbles & membership

    /** The caller's membership rows (approved or not) with the bubble embedded. */
    suspend fun memberships(userId: String): List<BubbleMember> =
        client.from("bubble_members").select(Columns.raw("*, bubble:bubbles(*)")) {
            filter { eq("user_id", userId) }
            order("created_at", Order.ASCENDING)
        }.list()

    suspend fun members(bubbleId: String): List<BubbleMember> =
        client.from("bubble_members").select(Columns.raw("*, ${author("user", "user_id")}")) {
            filter { eq("bubble_id", bubbleId); eq("approved", true) }
            order("created_at", Order.ASCENDING)
        }.list()

    suspend fun createBubble(name: String, description: String?, maxSize: Int): Bubble =
        client.postgrest.rpc("create_bubble", buildJsonObject {
            put("p_name", name)
            put("p_description", description?.let(::JsonPrimitive) ?: JsonNull)
            put("p_max_size", maxSize)
        }).one()

    suspend fun updateBubble(id: String, name: String, description: String?) {
        client.from("bubbles").update(buildJsonObject {
            put("name", name)
            put("description", description?.let(::JsonPrimitive) ?: JsonNull)
        }) { filter { eq("id", id) } }
    }

    suspend fun leaveBubble(bubbleId: String, userId: String) {
        client.from("bubble_members").delete { filter { eq("bubble_id", bubbleId); eq("user_id", userId) } }
    }

    /** Owner-only. Raises 'only the owner can remove members', 'use leave to remove yourself', 'member not found'. */
    suspend fun removeMember(bubbleId: String, userId: String) {
        client.postgrest.rpc("remove_member", buildJsonObject { put("p_bubble_id", bubbleId); put("p_user_id", userId) })
    }

    // Join requests

    suspend fun requestToJoin(inviteCode: String): JoinRequest =
        client.postgrest.rpc("request_to_join", buildJsonObject { put("p_invite_code", inviteCode.trim()) }).one()

    /** The caller's own pending requests, with the bubble name. */
    suspend fun myJoinRequests(userId: String): List<JoinRequest> =
        client.from("join_requests").select(Columns.raw("*, bubble:bubbles(id, name)")) {
            filter { eq("user_id", userId) }
            order("created_at", Order.ASCENDING)
        }.list()

    /** Pending requests to join a bubble the caller belongs to. */
    suspend fun joinRequests(bubbleId: String): List<JoinRequest> =
        client.from("join_requests").select(Columns.raw("*, ${author("user", "user_id")}")) {
            filter { eq("bubble_id", bubbleId) }
            order("created_at", Order.ASCENDING)
        }.list()

    /** Returns true when the requester was admitted. */
    suspend fun approveJoinRequest(id: String): Boolean =
        json.parseToJsonElement(
            client.postgrest.rpc("approve_join_request", buildJsonObject { put("p_request_id", id) }).data
        ).jsonPrimitive.boolean

    suspend fun rejectJoinRequest(id: String) {
        client.postgrest.rpc("reject_join_request", buildJsonObject { put("p_request_id", id) })
    }

    suspend fun cancelJoinRequest(id: String) {
        client.from("join_requests").delete { filter { eq("id", id) } }
    }

    // Chat

    /** Newest [limit] messages in chronological order. */
    suspend fun chatMessages(bubbleId: String, limit: Long = 200): List<ChatMessage> =
        client.from("chat_messages").select(Columns.raw("*, ${author("sender", "sender_id")}")) {
            filter { eq("bubble_id", bubbleId) }
            order("created_at", Order.DESCENDING)
            limit(limit)
        }.list<ChatMessage>().reversed()

    suspend fun sendMessage(bubbleId: String, senderId: String, content: String): ChatMessage =
        client.from("chat_messages").insert(buildJsonObject {
            put("bubble_id", bubbleId)
            put("sender_id", senderId)
            put("content", content)
        }) { select(Columns.raw("*, ${author("sender", "sender_id")}")) }.one()

    suspend fun deleteMessage(id: String) {
        client.from("chat_messages").delete { filter { eq("id", id) } }
    }

    // Events

    suspend fun events(bubbleId: String): List<BubbleEvent> =
        client.from("events").select(Columns.raw("*, ${author("creator", "creator_id")}")) {
            filter { eq("bubble_id", bubbleId) }
            order("datetime", Order.ASCENDING)
        }.list()

    suspend fun upcomingEvents(bubbleId: String, limit: Long): List<BubbleEvent> =
        client.from("events").select(Columns.raw("*, ${author("creator", "creator_id")}")) {
            filter { eq("bubble_id", bubbleId); gte("datetime", BoolaaJson.formatTimestamp(Instant.now())) }
            order("datetime", Order.ASCENDING)
            limit(limit)
        }.list()

    private fun EventInput.toJson(bubbleId: String?, creatorId: String?) = buildJsonObject {
        bubbleId?.let { put("bubble_id", it) }
        creatorId?.let { put("creator_id", it) }
        put("title", title)
        put("description", description?.let(::JsonPrimitive) ?: JsonNull)
        put("datetime", BoolaaJson.formatTimestamp(datetime))
        put("location", location?.let(::JsonPrimitive) ?: JsonNull)
    }

    suspend fun createEvent(bubbleId: String, creatorId: String, input: EventInput) {
        client.from("events").insert(input.toJson(bubbleId, creatorId))
    }

    suspend fun updateEvent(id: String, input: EventInput) {
        client.from("events").update(input.toJson(null, null)) { filter { eq("id", id) } }
    }

    suspend fun deleteEvent(id: String) {
        client.from("events").delete { filter { eq("id", id) } }
    }

    /** Returns the new rsvp_list. */
    suspend fun toggleRsvp(eventId: String): List<String> =
        json.parseToJsonElement(
            client.postgrest.rpc("toggle_rsvp", buildJsonObject { put("p_event_id", eventId) }).data
        ).let { el -> if (el is JsonArray) el.jsonArray.map { it.jsonPrimitive.content } else emptyList() }

    // Food

    suspend fun foodPosts(bubbleId: String, limit: Long? = null): List<FoodPost> =
        client.from("food_posts").select(Columns.raw("*, ${author("user", "user_id")}")) {
            filter { eq("bubble_id", bubbleId) }
            order("created_at", Order.DESCENDING)
            limit?.let { limit(it) }
        }.list()

    suspend fun createFoodPost(bubbleId: String, userId: String, input: FoodInput) {
        client.from("food_posts").insert(buildJsonObject {
            put("bubble_id", bubbleId); put("user_id", userId)
            put("image", input.image)
            put("description", input.description?.let(::JsonPrimitive) ?: JsonNull)
        })
    }

    suspend fun updateFoodPost(id: String, input: FoodInput) {
        client.from("food_posts").update(buildJsonObject {
            put("image", input.image)
            put("description", input.description?.let(::JsonPrimitive) ?: JsonNull)
        }) { filter { eq("id", id) } }
    }

    suspend fun deleteFoodPost(id: String) {
        client.from("food_posts").delete { filter { eq("id", id) } }
    }

    // Marketplace

    suspend fun marketItems(bubbleId: String, limit: Long? = null): List<MarketItem> =
        client.from("market_items").select(Columns.raw("*, ${author("owner", "owner_id")}")) {
            filter { eq("bubble_id", bubbleId) }
            order("created_at", Order.DESCENDING)
            limit?.let { limit(it) }
        }.list()

    private fun MarketInput.toJson(): JsonObject = buildJsonObject {
        put("image", image); put("title", title)
        put("description", description?.let(::JsonPrimitive) ?: JsonNull)
        put("status", status.wire)
    }

    suspend fun createMarketItem(bubbleId: String, ownerId: String, input: MarketInput) {
        val body = JsonObject(input.toJson() + mapOf("bubble_id" to JsonPrimitive(bubbleId), "owner_id" to JsonPrimitive(ownerId)))
        client.from("market_items").insert(body)
    }

    suspend fun updateMarketItem(id: String, input: MarketInput) {
        client.from("market_items").update(input.toJson()) { filter { eq("id", id) } }
    }

    suspend fun deleteMarketItem(id: String) {
        client.from("market_items").delete { filter { eq("id", id) } }
    }

    // Links

    suspend fun links(bubbleId: String, limit: Long? = null): List<SharedLink> =
        client.from("shared_links").select(Columns.raw("*, ${author("user", "user_id")}")) {
            filter { eq("bubble_id", bubbleId) }
            order("created_at", Order.DESCENDING)
            limit?.let { limit(it) }
        }.list()

    suspend fun createLink(bubbleId: String, userId: String, url: String, title: String?, tags: List<String>) {
        client.from("shared_links").insert(buildJsonObject {
            put("bubble_id", bubbleId); put("user_id", userId); put("url", url)
            put("title", title?.let(::JsonPrimitive) ?: JsonNull)
            putJsonArray("tags") { tags.forEach { add(JsonPrimitive(it)) } }
        })
    }

    suspend fun deleteLink(id: String) {
        client.from("shared_links").delete { filter { eq("id", id) } }
    }

    // Safety: blocks, reports, account deletion (App Store 1.2 / 5.1.1(v))

    /** The caller's own block list (RLS returns only rows where blocker_id = me). */
    suspend fun blocks(): List<Block> =
        client.from("blocks").select(Columns.raw("*, blocked:users!blocked_id($AUTHOR_COLUMNS)")) {
            order("created_at", Order.DESCENDING)
        }.list()

    suspend fun block(me: String, userId: String) {
        client.from("blocks").upsert(buildJsonObject { put("blocker_id", me); put("blocked_id", userId) }) { ignoreDuplicates = true }
    }

    suspend fun unblock(me: String, userId: String) {
        client.from("blocks").delete { filter { eq("blocker_id", me); eq("blocked_id", userId) } }
    }

    /** Server resolves author and bubble. Raises 'cannot report yourself' / 'report target not found'. */
    suspend fun report(type: ReportTargetType, targetId: String, reason: ReportReason, details: String?): String =
        json.parseToJsonElement(
            client.postgrest.rpc("report_content", buildJsonObject {
                put("p_target_type", type.wire); put("p_target_id", targetId); put("p_reason", reason.wire)
                put("p_details", details?.takeIf { it.isNotBlank() }?.let(::JsonPrimitive) ?: JsonNull)
            }).data
        ).jsonPrimitive.content

    /**
     * Removes every object under `<uid>/` in the three buckets (failures ignored: SQL cannot delete storage objects),
     * then deletes the auth user, which cascades to the profile, memberships and authored content.
     */
    suspend fun deleteMyAccount(userId: String) {
        val prefix = userId.lowercase()
        for (bucket in ImageBucket.entries) {
            runCatching {
                val api = client.storage.from(bucket.id)
                repeat(50) {
                    val names = api.list(prefix).map { "$prefix/${it.name}" }
                    if (names.isEmpty()) return@runCatching
                    api.delete(names)
                }
            }
        }
        client.postgrest.rpc("delete_my_account")
    }

    // Storage

    /** Uploads JPEG bytes to `<uid>/<uuid>.jpg` (the path shape the storage policy enforces) and returns the public URL. */
    suspend fun uploadImage(jpeg: ByteArray, bucket: ImageBucket, userId: String): String {
        val path = imagePath(userId)
        val api = client.storage.from(bucket.id)
        api.upload(path, jpeg) { contentType = ContentType.Image.JPEG; upsert = false }
        return api.publicUrl(path)
    }

    /** Best-effort removal of a previously uploaded image (only our own `<uid>/...` objects; others are ignored). */
    suspend fun deleteImage(publicUrl: String?, bucket: ImageBucket, userId: String) {
        val path = storagePath(publicUrl, bucket) ?: return
        if (!path.startsWith(userId.lowercase() + "/")) return
        runCatching { client.storage.from(bucket.id).delete(path) }
    }

    companion object {
        const val AUTHOR_COLUMNS = "id, name, avatar"
        /** `http://host/storage/v1/object/public/food.images/<uid>/<uuid>.jpg` -> `<uid>/<uuid>.jpg`; null for foreign URLs. */
        fun storagePath(publicUrl: String?, bucket: ImageBucket): String? {
            val marker = "/storage/v1/object/public/${bucket.id}/"
            val i = publicUrl?.indexOf(marker) ?: return null
            if (i < 0) return null
            return publicUrl.substring(i + marker.length).substringBefore('?').takeIf { it.isNotEmpty() }
        }

        fun imagePath(userId: String, id: UUID = UUID.randomUUID()) = "${userId.lowercase()}/${id.toString().lowercase()}.jpg"
    }
}

