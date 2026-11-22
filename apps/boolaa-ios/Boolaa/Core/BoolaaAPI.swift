import Foundation
import Supabase

/// Every backend call the app makes. Stateless and `Sendable`; all access is subject to RLS.
struct BoolaaAPI: Sendable {
    let client: SupabaseClient

    static let authorColumns = "id, name, avatar"

    // MARK: Profile

    func profile(userID: UUID) async throws -> UserProfile {
        try await client.from("users").select().eq("id", value: userID).single().execute().value
    }

    func updateProfile(userID: UUID, name: String? = nil, avatar: String? = nil) async throws -> UserProfile {
        struct Patch: Encodable { var name: String?; var avatar: String? }
        return try await client.from("users")
            .update(Patch(name: name, avatar: avatar))
            .eq("id", value: userID).select().single().execute().value
    }

    // MARK: Bubbles & membership

    /// The caller's membership rows (approved or not) with the bubble embedded.
    func memberships(userID: UUID) async throws -> [BubbleMember] {
        try await client.from("bubble_members")
            .select("*, bubble:bubbles(*)")
            .eq("user_id", value: userID)
            .order("created_at")
            .execute().value
    }

    func members(bubbleID: UUID) async throws -> [BubbleMember] {
        try await client.from("bubble_members")
            .select("*, user:users!user_id(\(Self.authorColumns))")
            .eq("bubble_id", value: bubbleID)
            .eq("approved", value: true)
            .order("created_at")
            .execute().value
    }

    func createBubble(name: String, description: String?, maxSize: Int) async throws -> Bubble {
        struct Params: Encodable { let p_name: String; let p_description: String?; let p_max_size: Int }
        return try await client.rpc("create_bubble", params: Params(p_name: name, p_description: description, p_max_size: maxSize))
            .single().execute().value
    }

    func updateBubble(id: UUID, name: String, description: String?) async throws {
        struct Patch: Encodable { let name: String; let description: String? }
        try await client.from("bubbles").update(Patch(name: name, description: description)).eq("id", value: id).execute()
    }

    /// The owner removes anyone else; an admin removes plain members only. Raises "only the owner can remove
    /// members" (caller is a plain member), "only the owner can remove admins", "use leave to remove yourself",
    /// "member not found".
    func removeMember(bubbleID: UUID, userID: UUID) async throws {
        struct Params: Encodable { let p_bubble_id: UUID; let p_user_id: UUID }
        try await client.rpc("remove_member", params: Params(p_bubble_id: bubbleID, p_user_id: userID)).execute()
    }

    /// Owner only: make a member an admin (`.admin`) or an admin a plain member (`.member`).
    /// Raises "only the owner can change roles", "member not found".
    func setMemberRole(bubbleID: UUID, userID: UUID, role: MemberRole) async throws {
        struct Params: Encodable { let p_bubble_id: UUID; let p_user_id: UUID; let p_role: String }
        try await client.rpc("set_member_role", params: Params(p_bubble_id: bubbleID, p_user_id: userID, p_role: role.rawValue)).execute()
    }

    /// Owner only: hands the bubble to another approved member; the caller becomes an admin.
    /// Raises "only the owner can transfer ownership", "member not found".
    func transferOwnership(bubbleID: UUID, newOwnerID: UUID) async throws {
        struct Params: Encodable { let p_bubble_id: UUID; let p_new_owner: UUID }
        try await client.rpc("transfer_ownership", params: Params(p_bubble_id: bubbleID, p_new_owner: newOwnerID)).execute()
    }

    func leaveBubble(bubbleID: UUID, userID: UUID) async throws {
        try await client.from("bubble_members").delete()
            .eq("bubble_id", value: bubbleID).eq("user_id", value: userID).execute()
    }

    // MARK: Join requests

    func requestToJoin(inviteCode: String) async throws -> JoinRequest {
        struct Params: Encodable { let p_invite_code: String }
        return try await client.rpc("request_to_join", params: Params(p_invite_code: inviteCode))
            .single().execute().value
    }

    /// Invite link preview (name, cover, size, the caller's status); nil when the code matches no bubble.
    /// Raises "too many attempts" after too many unknown codes in an hour.
    func invitePreview(code: String) async throws -> InvitePreview? {
        struct Params: Encodable { let p_code: String }
        let rows: [InvitePreview] = try await client.rpc("get_invite_preview", params: Params(p_code: code)).execute().value
        return rows.first
    }

    /// Owner only: replaces the invite code (old code, links and QR codes stop working). Returns the new code.
    func rotateInviteCode(bubbleID: UUID) async throws -> String {
        struct Params: Encodable { let p_bubble_id: UUID }
        return try await client.rpc("rotate_invite_code", params: Params(p_bubble_id: bubbleID)).execute().value
    }

    /// The caller's own pending requests, with the bubble name.
    func myJoinRequests(userID: UUID) async throws -> [JoinRequest] {
        try await client.from("join_requests")
            .select("*, bubble:bubbles(id, name, logo)")
            .eq("user_id", value: userID)
            .order("created_at")
            .execute().value
    }

    /// Pending requests to join a bubble the caller belongs to.
    func joinRequests(bubbleID: UUID) async throws -> [JoinRequest] {
        try await client.from("join_requests")
            .select("*, user:users!user_id(\(Self.authorColumns))")
            .eq("bubble_id", value: bubbleID)
            .order("created_at")
            .execute().value
    }

    /// Returns true when the requester was admitted.
    func approveJoinRequest(id: UUID) async throws -> Bool {
        struct Params: Encodable { let p_request_id: UUID }
        return try await client.rpc("approve_join_request", params: Params(p_request_id: id)).execute().value
    }

    func rejectJoinRequest(id: UUID) async throws {
        struct Params: Encodable { let p_request_id: UUID }
        try await client.rpc("reject_join_request", params: Params(p_request_id: id)).execute()
    }

    func cancelJoinRequest(id: UUID) async throws {
        try await client.from("join_requests").delete().eq("id", value: id).execute()
    }

    // MARK: Chat (docs/boolaa-spec.md, "Chat"; 20261123120000_chat_improvements.sql)

    static let chatColumns = "*, sender:users!sender_id(\(authorColumns))"
    static let chatPageSize = 50

    /// The newest `limit` messages, in chronological order (Home, debug hooks). `includeDeleted: false`
    /// skips author-deleted placeholders.
    func chatMessages(bubbleID: UUID, limit: Int = 200, includeDeleted: Bool = true) async throws -> [ChatMessage] {
        var q = client.from("chat_messages")
            .select(Self.chatColumns)
            .eq("bubble_id", value: bubbleID)
        if !includeDeleted { q = q.is("deleted_at", value: nil) }
        let rows: [ChatMessage] = try await q
            .order("created_at", ascending: false)
            .order("id", ascending: false)
            .limit(limit)
            .execute().value
        return rows.reversed()
    }

    /// One page of the chat (`chat_messages_page`), returned in chronological order: the newest
    /// `limit` messages, or the ones just before `beforeID` (the oldest message loaded). The server
    /// keys pages on (created_at, id), so no timestamp is ever sent. Fewer than `limit` rows means
    /// the start of the chat.
    func chatPage(bubbleID: UUID, beforeID: UUID?, limit: Int = chatPageSize) async throws -> [ChatMessage] {
        struct Params: Encodable { let p_bubble_id: UUID; let p_before_id: UUID?; let p_limit: Int }
        let rows: [ChatMessage] = try await client
            .rpc("chat_messages_page", params: Params(p_bubble_id: bubbleID, p_before_id: beforeID, p_limit: limit))
            .select(Self.chatColumns)
            .execute().value
        return rows.reversed()
    }

    /// Text, photo (`imagePath` already uploaded to `chat.images`) or both: `content` may be empty with a photo.
    func sendMessage(bubbleID: UUID, senderID: UUID, content: String, imagePath: String? = nil) async throws -> ChatMessage {
        try await client.from("chat_messages")
            .insert(NewChatMessage(bubbleId: bubbleID, senderId: senderID, content: content, imagePath: imagePath))
            .select(Self.chatColumns)
            .single().execute().value
    }

    /// Soft-deletes one of the caller's own messages. Returns the photo path the caller must now
    /// remove from `chat.images` (nil without a photo, or when it is kept as report evidence).
    /// Raises "message not found" (not yours, or gone).
    func deleteChatMessage(id: UUID) async throws -> String? {
        struct Params: Encodable { let p_message_id: UUID }
        struct Result: Decodable { let id: UUID; let image_path: String? }
        let result: Result = try await client.rpc("delete_chat_message", params: Params(p_message_id: id)).execute().value
        return result.image_path
    }

    /// One row per approved bubble: unread count (capped at 100) and the last-read marker.
    func chatUnreadCounts() async throws -> [ChatUnread] {
        try await client.rpc("chat_unread_counts").execute().value
    }

    /// Moves the caller's marker up to `messageID` (never back). Returns the marker.
    @discardableResult
    func markChatRead(bubbleID: UUID, messageID: UUID) async throws -> Date? {
        struct Params: Encodable { let p_bubble_id: UUID; let p_message_id: UUID }
        let raw: String = try await client.rpc("mark_chat_read", params: Params(p_bubble_id: bubbleID, p_message_id: messageID))
            .execute().value
        return BoolaaJSON.parseTimestamp(raw)
    }

    // MARK: Chat photos (private bucket `chat.images`)

    /// `<uid>/<uuid>.jpg`, the path shape the insert and storage policies require.
    static func chatImagePath(userID: UUID, fileID: UUID = UUID()) -> String {
        "\(userID.uuidString.lowercased())/\(fileID.uuidString.lowercased()).jpg"
    }

    /// Uploads a prepared JPEG (ImageCompression for `.chat`) and returns its object path.
    func uploadChatImage(_ jpeg: Data, userID: UUID) async throws -> String {
        let path = Self.chatImagePath(userID: userID)
        try await client.storage.from(ImageBucket.chat.rawValue)
            .upload(path, data: jpeg, options: FileOptions(contentType: "image/jpeg"))
        return path
    }

    /// Best-effort removal of one of the caller's chat photos (only their own `<uid>/` folder).
    func removeChatImage(path: String?, userID: UUID) async {
        guard let path, path.hasPrefix(userID.uuidString.lowercased() + "/") else { return }
        _ = try? await client.storage.from(ImageBucket.chat.rawValue).remove(paths: [path])
    }

    /// Signed URLs (1 hour) for chat photos, in one request. Paths the caller may not read are left out.
    func signedChatImageURLs(paths: [String], expiresIn: Int = 3600) async throws -> [String: URL] {
        guard !paths.isEmpty else { return [:] }
        let results = try await client.storage.from(ImageBucket.chat.rawValue).createSignedURLs(paths: paths, expiresIn: expiresIn)
        var out: [String: URL] = [:]
        for result in results { if let url = result.signedURL { out[result.path] = url } }
        return out
    }

    // MARK: Events

    func events(bubbleID: UUID) async throws -> [BubbleEvent] {
        try await client.from("events")
            .select("*, creator:users!creator_id(\(Self.authorColumns))")
            .eq("bubble_id", value: bubbleID)
            .order("datetime")
            .execute().value
    }

    func upcomingEvents(bubbleID: UUID, limit: Int) async throws -> [BubbleEvent] {
        try await client.from("events")
            .select("*, creator:users!creator_id(\(Self.authorColumns))")
            .eq("bubble_id", value: bubbleID)
            .gte("datetime", value: Date.now)
            .order("datetime")
            .limit(limit)
            .execute().value
    }

    func createEvent(_ input: EventInput) async throws {
        try await client.from("events").insert(input).execute()
    }

    func updateEvent(id: UUID, _ input: EventInput) async throws {
        try await client.from("events").update(input).eq("id", value: id).execute()
    }

    func deleteEvent(id: UUID) async throws {
        try await client.from("events").delete().eq("id", value: id).execute()
    }

    func toggleRSVP(eventID: UUID) async throws -> [UUID] {
        struct Params: Encodable { let p_event_id: UUID }
        return try await client.rpc("toggle_rsvp", params: Params(p_event_id: eventID)).execute().value
    }

    // MARK: Food

    func foodPosts(bubbleID: UUID, limit: Int? = nil) async throws -> [FoodPost] {
        var q = client.from("food_posts")
            .select("*, user:users!user_id(\(Self.authorColumns))")
            .eq("bubble_id", value: bubbleID)
            .order("created_at", ascending: false)
        if let limit { q = q.limit(limit) }
        return try await q.execute().value
    }

    func createFoodPost(_ input: FoodInput) async throws {
        try await client.from("food_posts").insert(input).execute()
    }

    func updateFoodPost(id: UUID, _ input: FoodInput) async throws {
        try await client.from("food_posts").update(input).eq("id", value: id).execute()
    }

    func deleteFoodPost(id: UUID) async throws {
        try await client.from("food_posts").delete().eq("id", value: id).execute()
    }

    // MARK: Marketplace

    func marketItems(bubbleID: UUID, limit: Int? = nil) async throws -> [MarketItem] {
        var q = client.from("market_items")
            .select("*, owner:users!owner_id(\(Self.authorColumns))")
            .eq("bubble_id", value: bubbleID)
            .order("created_at", ascending: false)
        if let limit { q = q.limit(limit) }
        return try await q.execute().value
    }

    func createMarketItem(_ input: MarketInput) async throws {
        try await client.from("market_items").insert(input).execute()
    }

    func updateMarketItem(id: UUID, _ input: MarketInput) async throws {
        try await client.from("market_items").update(input).eq("id", value: id).execute()
    }

    /// Owner only (RLS `market_update_own`); a non-owner's update matches no row.
    func setMarketAvailability(id: UUID, _ availability: MarketAvailability) async throws {
        struct Patch: Encodable, Sendable { let availability: MarketAvailability }
        try await client.from("market_items").update(Patch(availability: availability)).eq("id", value: id).execute()
    }

    func deleteMarketItem(id: UUID) async throws {
        try await client.from("market_items").delete().eq("id", value: id).execute()
    }

    // MARK: Links

    func links(bubbleID: UUID, limit: Int? = nil) async throws -> [SharedLink] {
        var q = client.from("shared_links")
            .select("*, user:users!user_id(\(Self.authorColumns))")
            .eq("bubble_id", value: bubbleID)
            .order("created_at", ascending: false)
        if let limit { q = q.limit(limit) }
        return try await q.execute().value
    }

    func createLink(_ input: LinkInput) async throws {
        try await client.from("shared_links").insert(input).execute()
    }

    func deleteLink(id: UUID) async throws {
        try await client.from("shared_links").delete().eq("id", value: id).execute()
    }

    // MARK: Storage

    enum ImageBucket: String {
        case avatars, food = "food.images", market = "market.images", bubbles = "bubble.images"
        /// Private: shown through signed URLs, never public URLs.
        case chat = "chat.images"
        /// Round images (avatars, bubble photos): 512 px and 2 MB.
        var isSmall: Bool { self == .avatars || self == .bubbles }
    }

    /// Uploads JPEG data to `<uid>/<uuid>.jpg` (the path shape the storage policy enforces) and returns the public URL.
    func uploadImage(_ jpeg: Data, bucket: ImageBucket, userID: UUID) async throws -> String {
        let path = "\(userID.uuidString.lowercased())/\(UUID().uuidString.lowercased()).jpg"
        let storage = client.storage.from(bucket.rawValue)
        try await storage.upload(path, data: jpeg, options: FileOptions(contentType: "image/jpeg"))
        return try storage.getPublicURL(path: path).absoluteString
    }

    /// The object path (`<uid>/<file>`) inside `bucket` for one of our public URLs, or nil for foreign URLs.
    static func storagePath(fromPublicURL url: String, bucket: ImageBucket) -> String? {
        let marker = "/storage/v1/object/public/\(bucket.rawValue)/"
        guard let range = url.range(of: marker) else { return nil }
        let rest = url[range.upperBound...].split(separator: "?", maxSplits: 1).first.map(String.init) ?? ""
        let path = rest.removingPercentEncoding ?? rest
        return path.split(separator: "/").count == 2 ? path : nil
    }

    /// Best-effort delete of an image we uploaded. Only touches the caller's own `<uid>/` folder;
    /// seeded or external URLs are ignored. Failures are swallowed: the row change already succeeded.
    func removeImage(publicURL: String?, bucket: ImageBucket, userID: UUID) async {
        guard let publicURL, let path = Self.storagePath(fromPublicURL: publicURL, bucket: bucket),
              path.hasPrefix(userID.uuidString.lowercased() + "/") else { return }
        _ = try? await client.storage.from(bucket.rawValue).remove(paths: [path])
    }

    // MARK: Bubble photo (bucket `bubble.images`, 20261123130000_bubble_cover.sql)

    /// `<bubble id>/<uuid>.jpg`: the photo belongs to the bubble, so whoever manages it later can replace it.
    static func bubbleLogoPath(bubbleID: UUID, fileID: UUID = UUID()) -> String {
        "\(bubbleID.uuidString.lowercased())/\(fileID.uuidString.lowercased()).jpg"
    }

    /// Uploads a prepared JPEG into the bubble's folder and returns its public URL. Storage lets only
    /// whoever can manage the bubble (today: its owner) write there.
    func uploadBubbleLogo(_ jpeg: Data, bubbleID: UUID) async throws -> String {
        let path = Self.bubbleLogoPath(bubbleID: bubbleID)
        let storage = client.storage.from(ImageBucket.bubbles.rawValue)
        try await storage.upload(path, data: jpeg, options: FileOptions(contentType: "image/jpeg"))
        return try storage.getPublicURL(path: path).absoluteString
    }

    /// Sets or clears `bubbles.logo`. The database only accepts a URL of an object in this bubble's folder
    /// ("invalid bubble logo" otherwise, shown as the generic error).
    func setBubbleLogo(bubbleID: UUID, logo: String?) async throws {
        struct Patch: Encodable {
            let logo: String?
            // Encode an explicit null so removing the photo clears the column.
            func encode(to encoder: Encoder) throws {
                var c = encoder.container(keyedBy: CodingKeys.self)
                try c.encode(logo, forKey: .logo)
            }
            enum CodingKeys: String, CodingKey { case logo }
        }
        try await client.from("bubbles").update(Patch(logo: logo)).eq("id", value: bubbleID).execute()
    }

    /// The object path of a bubble photo URL, only when it sits in that bubble's own folder.
    static func bubbleLogoPath(fromPublicURL url: String?, bubbleID: UUID) -> String? {
        guard let url, let path = storagePath(fromPublicURL: url, bucket: .bubbles),
              path.hasPrefix(bubbleID.uuidString.lowercased() + "/") else { return nil }
        return path
    }

    /// Best-effort delete of a bubble photo. Whatever is missed is swept server-side (sweep_bubble_images).
    func removeBubbleLogo(publicURL: String?, bubbleID: UUID) async {
        guard let path = Self.bubbleLogoPath(fromPublicURL: publicURL, bubbleID: bubbleID) else { return }
        _ = try? await client.storage.from(ImageBucket.bubbles.rawValue).remove(paths: [path])
    }
}
