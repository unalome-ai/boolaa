package com.boolaa.app.core

import com.boolaa.app.model.Block
import com.boolaa.app.model.Bubble
import com.boolaa.app.model.ReportReason
import com.boolaa.app.model.ReportTargetType
import com.boolaa.app.model.BubbleEvent
import com.boolaa.app.model.BubbleMember
import com.boolaa.app.model.ChatMessage
import io.github.jan.supabase.storage.StorageRestException
import io.ktor.client.plugins.timeout
import com.boolaa.app.model.ChatUnread
import com.boolaa.app.model.FoodPost
import com.boolaa.app.model.JoinRequest
import com.boolaa.app.model.MemberRole
import com.boolaa.app.model.MarketAvailability
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
import kotlin.time.Duration.Companion.seconds

/** Inputs for the editable bubble content. */
data class EventInput(val title: String, val description: String?, val datetime: Instant, val location: String?)
data class FoodInput(val image: String, val description: String?)
data class MarketInput(
    val image: String, val title: String, val description: String?, val status: MarketStatus,
    val availability: MarketAvailability = MarketAvailability.AVAILABLE,
)

/** Every bucket is private (20261123210000_private_photos.sql): images load through signed URLs (PhotoUrls). */
enum class ImageBucket(val id: String) {
    AVATARS("avatars"), FOOD("food.images"), MARKET("market.images"),
    /** Bubble logos: `<bubble id>/<uuid>.jpg`, written by whoever may manage the bubble (20261123130000_bubble_cover.sql). */
    BUBBLE("bubble.images"),
    /** Chat photos: `<uid>/<uuid>.jpg`, rows store the path (20261123120000_chat_improvements.sql). */
    CHAT("chat.images");

    companion object {
        /** Buckets whose objects live under `<auth uid>/` (cleaned on account deletion). */
        val userOwned = listOf(AVATARS, FOOD, MARKET, CHAT)
    }
}

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

    /** Sets or clears the bubble's logo (owner or admin; the DB accepts only our own `bubble.images/<bubble id>/` URLs). */
    suspend fun updateBubbleLogo(id: String, logo: String?) {
        client.from("bubbles").update(buildJsonObject {
            put("logo", logo?.let(::JsonPrimitive) ?: JsonNull)
        }) { filter { eq("id", id) } }
    }

    /** Uploads the logo JPEG to `<bubble id>/<uuid>.jpg` in `bubble.images` and returns the public URL. */
    suspend fun uploadBubbleLogo(jpeg: ByteArray, bubbleId: String): String {
        val path = bubbleLogoPath(bubbleId)
        val api = client.storage.from(ImageBucket.BUBBLE.id)
        api.upload(path, jpeg) {
            contentType = ContentType.Image.JPEG; upsert = false
            httpOverride { timeout { requestTimeoutMillis = Backend.UPLOAD_TIMEOUT_MS } }
        }
        return api.publicUrl(path)
    }

    /** Best-effort removal of one of this bubble's logo objects (other URLs are ignored). */
    suspend fun deleteBubbleLogo(publicUrl: String?, bubbleId: String) {
        val path = bubbleLogoObject(publicUrl, bubbleId) ?: return
        runCatching { client.storage.from(ImageBucket.BUBBLE.id).delete(path) }
    }

    suspend fun leaveBubble(bubbleId: String, userId: String) {
        client.from("bubble_members").delete { filter { eq("bubble_id", bubbleId); eq("user_id", userId) } }
    }

    /**
     * Owner or admin; admins may remove plain members only. Raises 'only the owner can remove members',
     * 'only the owner can remove admins', 'use leave to remove yourself', 'member not found'.
     */
    suspend fun removeMember(bubbleId: String, userId: String) {
        client.postgrest.rpc("remove_member", buildJsonObject { put("p_bubble_id", bubbleId); put("p_user_id", userId) })
    }

    /**
     * Owner only: hands ownership to an approved member; the caller becomes an admin. Raises
     * 'only the owner can transfer ownership', 'already the owner', 'member not found'.
     */
    suspend fun transferOwnership(bubbleId: String, newOwnerId: String) {
        client.postgrest.rpc("transfer_ownership", buildJsonObject { put("p_bubble_id", bubbleId); put("p_new_owner", newOwnerId) })
    }

    /**
     * Owner only: [role] is ADMIN or MEMBER, never on the owner. Raises 'only the owner can change roles',
     * 'invalid role', 'use transfer_ownership', 'member not found'.
     */
    suspend fun setMemberRole(bubbleId: String, userId: String, role: MemberRole) {
        require(role != MemberRole.OWNER) { "use transferOwnership" }
        client.postgrest.rpc("set_member_role", buildJsonObject {
            put("p_bubble_id", bubbleId); put("p_user_id", userId); put("p_role", role.wire)
        })
    }

    // Join requests

    suspend fun requestToJoin(inviteCode: String): JoinRequest =
        client.postgrest.rpc("request_to_join", buildJsonObject { put("p_invite_code", inviteCode.trim()) }).one()

    /** What an invite link shows before joining (name, logo, member count, own status); null for an unknown code. */
    suspend fun invitePreview(code: String): InvitePreview? =
        client.postgrest.rpc("get_invite_preview", buildJsonObject { put("p_code", code) }).list<InvitePreview>().firstOrNull()

    /** Owner or admin: replaces the invite code, so every old link and QR code stops working. Returns the new code. */
    suspend fun rotateInviteCode(bubbleId: String): String =
        json.decodeFromString<String>(client.postgrest.rpc("rotate_invite_code", buildJsonObject { put("p_bubble_id", bubbleId) }).data)

    /** The caller's own pending requests, with the bubble name. */
    suspend fun myJoinRequests(userId: String): List<JoinRequest> =
        client.from("join_requests").select(Columns.raw("*, bubble:bubbles(id, name, logo)")) {
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

    // Chat (docs/boolaa-spec.md, "Chat")

    /**
     * One page of [bubbleId]'s chat, **newest first**: the newest [limit] messages, or those just before [beforeId]
     * (keyset on the server, so no timestamps are sent). A page shorter than [limit] means the start of the chat.
     */
    suspend fun chatPage(bubbleId: String, beforeId: String?, limit: Int = CHAT_PAGE_SIZE): List<ChatMessage> =
        client.postgrest.rpc("chat_messages_page", buildJsonObject {
            put("p_bubble_id", bubbleId)
            put("p_before_id", beforeId?.let(::JsonPrimitive) ?: JsonNull)
            put("p_limit", limit)
        }) { select(Columns.raw("*, ${author("sender", "sender_id")}")) }.list()

    /**
     * The chat around [messageId], newest first (a search hit opened in context): up to [ChatJump.BEFORE] older
     * messages, the target and everything after it up to the newest. Empty when the caller can't see it.
     */
    suspend fun chatMessagesAround(bubbleId: String, messageId: String): List<ChatMessage> =
        client.postgrest.rpc("chat_messages_around", buildJsonObject {
            put("p_bubble_id", bubbleId)
            put("p_message_id", messageId)
        }) { select(Columns.raw("*, ${author("sender", "sender_id")}")) }.list()

    // Search (docs/boolaa-spec.md "Search")

    /** `search_bubble`: hits of every kind, best first (RLS decides what's visible). Callers check [SearchRules.canSearch]. */
    suspend fun searchBubble(bubbleId: String, query: String, limit: Int = SearchRules.LIMIT): List<SearchHit> =
        SearchRules.decode(client.postgrest.rpc("search_bubble", buildJsonObject {
            put("p_bubble_id", bubbleId)
            put("p_query", query)
            put("p_limit", limit)
        }).data)

    /** Newest [limit] messages that aren't deleted, newest first (Home). */
    suspend fun latestChatMessages(bubbleId: String, limit: Long): List<ChatMessage> =
        client.from("chat_messages").select(Columns.raw("*, ${author("sender", "sender_id")}")) {
            filter { eq("bubble_id", bubbleId); exact("deleted_at", null) }
            order("created_at", Order.DESCENDING)
            limit(limit)
        }.list()

    /** Inserts a message; [content] may be empty when [imagePath] (an uploaded `chat.images` object) is set. */
    suspend fun sendMessage(bubbleId: String, senderId: String, content: String, imagePath: String? = null, id: String? = null): ChatMessage =
        client.from("chat_messages").insert(buildJsonObject {
            // The outbox's client id: a retry of a message that already arrived fails with 23505 instead of doubling it.
            id?.let { put("id", it) }
            put("bubble_id", bubbleId)
            put("sender_id", senderId)
            put("content", content)
            imagePath?.let { put("image_path", it) }
        }) { select(Columns.raw("*, ${author("sender", "sender_id")}")) }.one()

    /**
     * Soft-deletes the caller's own message and returns the photo path the client must now remove from `chat.images`
     * (null when there is none or it is kept as report evidence). Raises 'message not found'.
     */
    suspend fun deleteChatMessage(id: String): String? {
        val body = json.parseToJsonElement(client.postgrest.rpc("delete_chat_message", buildJsonObject { put("p_message_id", id) }).data)
        val obj = (if (body is JsonArray) body.firstOrNull() else body) as? JsonObject ?: return null
        return (obj["image_path"] as? JsonPrimitive)?.takeIf { it.isString }?.content
    }

    /** Uploads a chat photo JPEG to `<uid>/<uuid>.jpg` in the private `chat.images` bucket and returns the object path. */
    suspend fun uploadChatImage(jpeg: ByteArray, userId: String): String {
        val path = imagePath(userId)
        client.storage.from(ImageBucket.CHAT.id).upload(path, jpeg) {
            contentType = ContentType.Image.JPEG; upsert = false
            httpOverride { timeout { requestTimeoutMillis = Backend.UPLOAD_TIMEOUT_MS } }
        }
        return path
    }

    /** One message with its sender, or null (RLS hides it or it is gone). */
    suspend fun chatMessage(id: String): ChatMessage? =
        client.from("chat_messages").select(Columns.raw("*, ${author("sender", "sender_id")}")) {
            filter { eq("id", id) }
            limit(1)
        }.list<ChatMessage>().firstOrNull()

    /**
     * Uploads a chat photo to a fixed [path] (`<uid>/<client id>.jpg`, the outbox's retries reuse it). An object
     * already there (an earlier attempt got through) counts as uploaded. Uploads get 60 s instead of 15.
     */
    suspend fun uploadChatImageAt(jpeg: ByteArray, path: String) {
        try {
            client.storage.from(ImageBucket.CHAT.id).upload(path, jpeg) {
                contentType = ContentType.Image.JPEG; upsert = false
                httpOverride { timeout { requestTimeoutMillis = Backend.UPLOAD_TIMEOUT_MS } }
            }
        } catch (e: StorageRestException) {
            if (!OutboxRules.isDuplicateObject(e.statusCode, e.error, e.description)) throw e
        }
    }

    /** Best-effort removal of one of the caller's own `chat.images` objects. */
    suspend fun removeChatImage(path: String?, userId: String) {
        if (path == null || !path.startsWith(userId.lowercase() + "/") || ".." in path) return
        runCatching { client.storage.from(ImageBucket.CHAT.id).delete(path) }
    }

    /** Signed URLs (1 hour) for `chat.images` paths, in one call; paths the caller may not read are left out. */
    suspend fun signedChatImageUrls(paths: Collection<String>): Map<String, String> =
        signedImageUrls(ImageBucket.CHAT.id, paths)

    /**
     * Signed URLs (1 hour) for objects of one private photo bucket, in one call (PhotoUrls batches through this);
     * paths the caller may not read are left out.
     */
    suspend fun signedImageUrls(bucket: String, paths: Collection<String>): Map<String, String> {
        if (paths.isEmpty()) return emptyMap()
        return client.storage.from(bucket).createSignedUrls(CHAT_URL_TTL_SECONDS.seconds, paths)
            .filter { it.error == null && it.signedURL.isNotEmpty() }
            .associate { it.path to it.signedURL }
    }

    /** One row per approved bubble: unread count (capped at 100) and the last-read marker. */
    suspend fun chatUnreadCounts(): List<ChatUnread> = client.postgrest.rpc("chat_unread_counts").list()

    /** Moves the caller's read marker up to [messageId] (never back). Raises 'message not found'. */
    suspend fun markChatRead(bubbleId: String, messageId: String) {
        client.postgrest.rpc("mark_chat_read", buildJsonObject { put("p_bubble_id", bubbleId); put("p_message_id", messageId) })
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
        put("availability", availability.wire)
    }

    suspend fun createMarketItem(bubbleId: String, ownerId: String, input: MarketInput) {
        val body = JsonObject(input.toJson() + mapOf("bubble_id" to JsonPrimitive(bubbleId), "owner_id" to JsonPrimitive(ownerId)))
        client.from("market_items").insert(body)
    }

    suspend fun updateMarketItem(id: String, input: MarketInput) {
        client.from("market_items").update(input.toJson()) { filter { eq("id", id) } }
    }

    /** Owner-only (RLS `market_update_own`); a non-owner's update matches no row. */
    suspend fun setMarketAvailability(id: String, availability: MarketAvailability) {
        client.from("market_items").update(buildJsonObject { put("availability", availability.wire) }) { filter { eq("id", id) } }
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

    /** Public-form URL naming a server-made preview image (private bucket `link.previews`); Coil signs it (PhotoUrls). */
    fun linkPreviewImageUrl(path: String?): String? =
        path?.takeIf { it.isNotBlank() && ".." !in it }?.let { client.storage.from(LINK_PREVIEWS_BUCKET).publicUrl(it) }

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
     * Removes every object under `<uid>/` in the user-owned buckets (avatars, food, market, chat) (failures ignored: SQL cannot delete storage objects),
     * then deletes the auth user, which cascades to the profile, memberships and authored content.
     */
    suspend fun deleteMyAccount(userId: String) {
        val prefix = userId.lowercase()
        for (bucket in ImageBucket.userOwned) {
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

    /**
     * Uploads JPEG bytes to `<uid>/<uuid>.jpg` (the path shape the storage policy enforces) and returns the public-form
     * URL rows store as the photo's identifier. Every bucket is private: images load through PhotoUrls (signed URLs).
     */
    suspend fun uploadImage(jpeg: ByteArray, bucket: ImageBucket, userId: String): String {
        val path = imagePath(userId)
        val api = client.storage.from(bucket.id)
        api.upload(path, jpeg) {
            contentType = ContentType.Image.JPEG; upsert = false
            httpOverride { timeout { requestTimeoutMillis = Backend.UPLOAD_TIMEOUT_MS } }
        }
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
        /** Server-written link preview images; not user-owned, so not in [ImageBucket]. */
        const val LINK_PREVIEWS_BUCKET = "link.previews"
        const val CHAT_PAGE_SIZE = 50
        /** Signed chat photo URLs live an hour. */
        const val CHAT_URL_TTL_SECONDS = 3600L
        /** `http://host/storage/v1/object/public/food.images/<uid>/<uuid>.jpg` -> `<uid>/<uuid>.jpg`; null for foreign URLs. */
        fun storagePath(publicUrl: String?, bucket: ImageBucket): String? {
            val marker = "/storage/v1/object/public/${bucket.id}/"
            val i = publicUrl?.indexOf(marker) ?: return null
            if (i < 0) return null
            return publicUrl.substring(i + marker.length).substringBefore('?').takeIf { it.isNotEmpty() }
        }

        fun imagePath(userId: String, id: UUID = UUID.randomUUID()) = "${userId.lowercase()}/${id.toString().lowercase()}.jpg"

        /** `<bubble id>/<uuid>.jpg`: bubble logos belong to the bubble, not to the uploader. */
        fun bubbleLogoPath(bubbleId: String, id: UUID = UUID.randomUUID()) = "${bubbleId.lowercase()}/${id.toString().lowercase()}.jpg"

        /** The `bubble.images` object behind [publicUrl] when it sits in [bubbleId]'s folder, else null. */
        fun bubbleLogoObject(publicUrl: String?, bubbleId: String): String? =
            storagePath(publicUrl, ImageBucket.BUBBLE)?.takeIf { it.startsWith(bubbleId.lowercase() + "/") && ".." !in it }
    }
}

