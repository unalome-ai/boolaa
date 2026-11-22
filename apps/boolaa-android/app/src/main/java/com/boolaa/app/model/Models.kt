package com.boolaa.app.model

import com.boolaa.app.core.InstantSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.time.Instant

// Row models mirror supabase/migrations/20261122000000_boolaa_schema.sql.
// Author embeds come from select("*, author:users!<fk>(id, name, avatar)").

typealias Timestamp = @Serializable(with = InstantSerializer::class) Instant

/** `public.users` (also the `author:users!fk(...)` embeds). */
@Serializable
data class UserProfile(
    val id: String,
    val name: String = "",
    val avatar: String? = null,
    @SerialName("created_at") val createdAt: Timestamp? = null,
)

/** `public.bubbles` */
@Serializable
data class Bubble(
    val id: String,
    val name: String,
    val description: String? = null,
    val logo: String? = null,
    @SerialName("max_size") val maxSize: Int = 12,
    @SerialName("invite_code") val inviteCode: String = "",
    @SerialName("created_by") val createdBy: String? = null,
    @SerialName("created_at") val createdAt: Timestamp? = null,
)

@Serializable
enum class MemberRole(val wire: String) {
    @SerialName("owner") OWNER("owner"),
    @SerialName("admin") ADMIN("admin"),
    @SerialName("member") MEMBER("member"),
}

/**
 * What a role may do in a bubble (20261123190000_bubble_roles.sql); the server enforces the same rules.
 * The owner and admins manage the bubble (details, photo, invite code) and remove plain members; only the owner
 * removes admins, changes roles and transfers ownership.
 */
object MemberPermissions {
    fun canManage(role: MemberRole?): Boolean = role == MemberRole.OWNER || role == MemberRole.ADMIN

    /** Whether [myRole] may remove someone with [targetRole] (never yourself: that is leaving). */
    fun canRemove(myRole: MemberRole?, targetRole: MemberRole, isSelf: Boolean = false): Boolean = !isSelf && when (myRole) {
        MemberRole.OWNER -> targetRole != MemberRole.OWNER
        MemberRole.ADMIN -> targetRole == MemberRole.MEMBER
        else -> false
    }

    /** Make admin / remove admin / transfer ownership: owner only, on someone else. */
    fun canChangeRoles(myRole: MemberRole?, isSelf: Boolean = false): Boolean = !isSelf && myRole == MemberRole.OWNER

    /** My role from the live members list, falling back to the cached membership role. */
    fun roleOf(userId: String, members: List<BubbleMember>, fallback: MemberRole? = null): MemberRole? =
        members.firstOrNull { it.userId == userId }?.role ?: fallback
}

/** `public.bubble_members`, optionally embedding the bubble or the user. */
@Serializable
data class BubbleMember(
    @SerialName("user_id") val userId: String,
    @SerialName("bubble_id") val bubbleId: String,
    val approved: Boolean = false,
    val role: MemberRole = MemberRole.MEMBER,
    @SerialName("created_at") val createdAt: Timestamp? = null,
    val bubble: Bubble? = null,
    val user: UserProfile? = null,
) {
    val key: String get() = "$userId-$bubbleId"
}

/** Minimal bubble embed (`bubble:bubbles(id, name, logo)`). */
@Serializable
data class BubbleRef(val id: String, val name: String, val logo: String? = null)

/** `public.join_requests` */
@Serializable
data class JoinRequest(
    val id: String,
    @SerialName("user_id") val userId: String,
    @SerialName("bubble_id") val bubbleId: String,
    @SerialName("approver_ids") val approverIds: List<String> = emptyList(),
    @SerialName("created_at") val createdAt: Timestamp? = null,
    val user: UserProfile? = null,
    val bubble: BubbleRef? = null,
) {
    companion object {
        /** Approvals needed for admission: a strict majority of approved members (see approve_join_request). */
        fun approvalsNeeded(memberCount: Int): Int = memberCount / 2 + 1

        /** Approvals that count: votes from people who are still approved members. */
        fun currentApprovals(request: JoinRequest, memberIds: Collection<String>): Int = request.approverIds.count { it in memberIds }
    }
}

/**
 * `public.chat_messages` (20261123120000_chat_improvements.sql). [imagePath] is an object path in the private
 * `chat.images` bucket (shown through signed URLs); a deleted message keeps its row with [deletedAt] set and its
 * text and photo wiped.
 */
@Serializable
data class ChatMessage(
    val id: String,
    @SerialName("bubble_id") val bubbleId: String,
    @SerialName("sender_id") val senderId: String,
    val content: String = "",
    @SerialName("created_at") val createdAt: Timestamp,
    val sender: UserProfile? = null,
    @SerialName("image_path") val imagePath: String? = null,
    @SerialName("deleted_at") val deletedAt: Timestamp? = null,
) {
    val isDeleted: Boolean get() = deletedAt != null
    /** A photo without a caption (Home shows the "Photo" label). */
    val isPhotoOnly: Boolean get() = !isDeleted && imagePath != null && content.isBlank()
}

/** One row of `chat_unread_counts()`: unread messages from others (capped at 100) and the read marker. */
@Serializable
data class ChatUnread(
    @SerialName("bubble_id") val bubbleId: String,
    @SerialName("unread_count") val unreadCount: Int = 0,
    @SerialName("last_read_at") val lastReadAt: Timestamp? = null,
) {
    companion object {
        /** Badge text: nothing for 0, the number up to 99, "99+" above (the server caps the count at 100). */
        fun badgeText(count: Int): String? = when {
            count <= 0 -> null
            count > 99 -> "99+"
            else -> count.toString()
        }
    }
}

/** `public.events` */
@Serializable
data class BubbleEvent(
    val id: String,
    @SerialName("bubble_id") val bubbleId: String,
    @SerialName("creator_id") val creatorId: String,
    val title: String,
    val description: String? = null,
    val datetime: Timestamp,
    val location: String? = null,
    @SerialName("rsvp_list") val rsvpList: List<String> = emptyList(),
    @SerialName("created_at") val createdAt: Timestamp,
    val creator: UserProfile? = null,
)

/** `public.food_posts` */
@Serializable
data class FoodPost(
    val id: String,
    @SerialName("bubble_id") val bubbleId: String,
    @SerialName("user_id") val userId: String,
    val image: String,
    val description: String? = null,
    @SerialName("created_at") val createdAt: Timestamp,
    val user: UserProfile? = null,
)

@Serializable
enum class MarketStatus { @SerialName("free") FREE, @SerialName("trade") TRADE;
    val wire: String get() = name.lowercase()
}

/**
 * `market_items.availability` (20261123170000_market_status_calendar.sql): owner-only, independent of Free/Trade.
 * Who it is reserved for is deliberately not stored. Missing or unknown values decode as [AVAILABLE]
 * (`coerceInputValues`).
 */
@Serializable
enum class MarketAvailability { @SerialName("available") AVAILABLE, @SerialName("reserved") RESERVED, @SerialName("taken") TAKEN;
    val wire: String get() = name.lowercase()
}

/** `public.market_items` */
@Serializable
data class MarketItem(
    val id: String,
    @SerialName("bubble_id") val bubbleId: String,
    @SerialName("owner_id") val ownerId: String,
    val image: String,
    val title: String,
    val description: String? = null,
    val status: MarketStatus = MarketStatus.FREE,
    val availability: MarketAvailability = MarketAvailability.AVAILABLE,
    @SerialName("created_at") val createdAt: Timestamp,
    val owner: UserProfile? = null,
)

/** `public.shared_links` */
@Serializable
data class SharedLink(
    val id: String,
    @SerialName("bubble_id") val bubbleId: String,
    @SerialName("user_id") val userId: String,
    val url: String,
    val title: String? = null,
    val tags: List<String> = emptyList(),
    @SerialName("created_at") val createdAt: Timestamp,
    val user: UserProfile? = null,
    /** Server-written Open Graph preview (docs/boolaa-spec.md "Link previews"): none, pending, fetching, ready, failed. */
    @SerialName("preview_status") val previewStatus: String = "none",
    @SerialName("preview_title") val previewTitle: String? = null,
    @SerialName("preview_description") val previewDescription: String? = null,
    @SerialName("preview_site_name") val previewSiteName: String? = null,
    /** Object path in the public bucket `link.previews` (a server-made copy: clients never load third-party images). */
    @SerialName("preview_image_path") val previewImagePath: String? = null,
) {
    val previewReady: Boolean get() = previewStatus == "ready"
    val previewLoading: Boolean get() = previewStatus == "pending" || previewStatus == "fetching"
    /** Host without `www.` for the card, or null for an unparsable URL. */
    val domain: String? get() = domainOf(url)

    companion object {
        fun domainOf(url: String): String? =
            runCatching { java.net.URI(url.trim()).host }.getOrNull()?.lowercase()?.removePrefix("www.")?.takeIf { it.isNotEmpty() }

        /** Parses "food, cheap ,  ,Recipes" into ["food", "cheap", "recipes"]. */
        fun parseTags(raw: String): List<String> =
            raw.split(',').map { it.trim().lowercase() }.filter { it.isNotEmpty() }.distinct()

        /** Adds https:// when the scheme is missing; the table requires http(s). */
        fun normalizeUrl(raw: String): String {
            val t = raw.trim()
            return if (t.startsWith("http://", true) || t.startsWith("https://", true)) t else "https://$t"
        }
    }
}

/** `public.blocks` row (own list only), with the blocked user embedded. */
@Serializable
data class Block(
    @SerialName("blocker_id") val blockerId: String,
    @SerialName("blocked_id") val blockedId: String,
    @SerialName("created_at") val createdAt: Timestamp? = null,
    val blocked: UserProfile? = null,
)

/** report_content target types. */
enum class ReportTargetType(val wire: String) {
    USER("user"), CHAT_MESSAGE("chat_message"), EVENT("event"), FOOD_POST("food_post"), MARKET_ITEM("market_item"), SHARED_LINK("shared_link")
}

/** report_content reasons, in display order. */
enum class ReportReason(val wire: String) {
    SPAM("spam"), HARASSMENT("harassment"), HATE("hate"), SEXUAL("sexual"), VIOLENCE("violence"), SELF_HARM("self_harm"), OTHER("other")
}

/** The fixed reaction set, in display order (docs/boolaa-spec.md "Reactions"); stored as keys, never as emoji. */
enum class ReactionKind(val wire: String, val emoji: String) {
    LIKE("like", "👍"), LOVE("love", "❤️"), LAUGH("laugh", "😂"), WOW("wow", "😮"), SAD("sad", "😢"), THANKS("thanks", "🙏");

    companion object {
        fun of(wire: String): ReactionKind? = entries.firstOrNull { it.wire == wire }
    }
}

/** What a reaction is on: the same names as report targets. */
enum class ReactionTarget(val wire: String) {
    CHAT_MESSAGE("chat_message"), EVENT("event"), FOOD_POST("food_post"), MARKET_ITEM("market_item"), SHARED_LINK("shared_link")
}

/** `public.reactions` row (select id, target_type, target_id, reaction, user_id; realtime INSERT records carry more). */
@Serializable
data class Reaction(
    val id: String,
    @SerialName("target_type") val targetType: String,
    @SerialName("target_id") val targetId: String,
    val reaction: String,
    @SerialName("user_id") val userId: String,
)

/** `toggle_reaction` result: [reacted] is the new state, [id] the row added or removed. */
@Serializable
data class ReactionToggle(
    val id: String,
    val reacted: Boolean,
    val reaction: String,
    @SerialName("target_type") val targetType: String,
    @SerialName("target_id") val targetId: String,
)

/** What the report sheet is about: the content (or user) and its author. */
data class ReportTarget(val type: ReportTargetType, val id: String, val authorId: String, val authorName: String)

/**
 * Live bubble edits (realtime UPDATE on `public.bubbles`, 20261123130000_bubble_cover.sql): name, description and
 * logo are merged into the caller's memberships and pending requests by id; other bubbles are ignored.
 */
data class BubblePatch(val id: String, val name: String, val description: String?, val logo: String?) {
    fun applyTo(b: Bubble): Bubble = if (b.id == id) b.copy(name = name, description = description, logo = logo) else b

    companion object {
        /** Reads the patch from a realtime record (plain JSON; timestamps are not decoded). */
        fun fromRecord(record: kotlinx.serialization.json.JsonObject): BubblePatch? {
            fun str(k: String) = (record[k] as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { it.isString }?.content
            val id = str("id") ?: return null
            val name = str("name") ?: return null
            return BubblePatch(id, name, str("description"), str("logo"))
        }

        /** Null when nothing the caller holds changed (so the state isn't touched). */
        fun merge(memberships: List<BubbleMember>?, requests: List<JoinRequest>, patch: BubblePatch): Pair<List<BubbleMember>?, List<JoinRequest>>? {
            val inMembers = memberships.orEmpty().any { it.bubbleId == patch.id && it.bubble != null }
            val inRequests = requests.any { it.bubbleId == patch.id && it.bubble != null }
            if (!inMembers && !inRequests) return null
            val m = memberships?.map { if (it.bubbleId == patch.id && it.bubble != null) it.copy(bubble = patch.applyTo(it.bubble)) else it }
            val r = requests.map {
                if (it.bubbleId == patch.id && it.bubble != null) it.copy(bubble = it.bubble.copy(name = patch.name, logo = patch.logo)) else it
            }
            return m to r
        }
    }
}
