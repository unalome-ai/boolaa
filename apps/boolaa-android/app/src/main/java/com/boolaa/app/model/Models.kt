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
enum class MemberRole { @SerialName("owner") OWNER, @SerialName("member") MEMBER }

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

/** Minimal bubble embed (`bubble:bubbles(id, name)`). */
@Serializable
data class BubbleRef(val id: String, val name: String)

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

/** `public.chat_messages` */
@Serializable
data class ChatMessage(
    val id: String,
    @SerialName("bubble_id") val bubbleId: String,
    @SerialName("sender_id") val senderId: String,
    val content: String,
    @SerialName("created_at") val createdAt: Timestamp,
    val sender: UserProfile? = null,
)

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
) {
    companion object {
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

/** What the report sheet is about: the content (or user) and its author. */
data class ReportTarget(val type: ReportTargetType, val id: String, val authorId: String, val authorName: String)
