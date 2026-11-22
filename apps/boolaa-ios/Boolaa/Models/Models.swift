import Foundation

// Row models mirror supabase/migrations/20261122000000_boolaa_schema.sql.
// Author embeds come from `select('*, author:users!<fk>(id, name, avatar)')`.

/// `public.users` (also used for the `author:users!fk(...)` embeds).
struct UserProfile: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    var name: String
    var avatar: String?
    var createdAt: Date?

    enum CodingKeys: String, CodingKey {
        case id, name, avatar
        case createdAt = "created_at"
    }

    var avatarURL: URL? { avatar.flatMap(URL.init(string:)) }
    var displayName: String { name.isEmpty ? String(localized: "Someone", comment: "Placeholder for a user without a name") : name }
}

/// `public.bubbles`
struct Bubble: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    var name: String
    var description: String?
    var logo: String?
    var maxSize: Int
    var inviteCode: String
    var createdBy: UUID?
    var createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id, name, description, logo
        case maxSize = "max_size"
        case inviteCode = "invite_code"
        case createdBy = "created_by"
        case createdAt = "created_at"
    }
}

/// Bubble roles (docs/boolaa-spec.md, "Roles"; 20261123190000_bubble_roles.sql). The UI uses the
/// permission helpers only to hide what a role can't do; the RPCs enforce the same rules.
enum MemberRole: String, Codable, Sendable {
    case owner, admin, member

    /// An unknown future role decodes as a plain member instead of failing the whole list.
    init(from decoder: any Decoder) throws {
        self = MemberRole(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .member
    }

    /// Edit name, description and photo, and rotate the invite code (`can_manage_bubble`).
    var canManage: Bool { self == .owner || self == .admin }

    /// Make/remove admin and transfer ownership.
    var canChangeRoles: Bool { self == .owner }

    /// `remove_member`: the owner removes anyone else, an admin removes plain members only.
    func canRemove(_ target: MemberRole) -> Bool {
        switch self {
        case .owner: target != .owner
        case .admin: target == .member
        case .member: false
        }
    }
}

/// `public.bubble_members`, optionally embedding the bubble or the user.
struct BubbleMember: Codable, Hashable, Sendable, Identifiable {
    let userId: UUID
    let bubbleId: UUID
    var approved: Bool
    var role: MemberRole
    var createdAt: Date
    var bubble: Bubble?
    var user: UserProfile?

    var id: String { "\(userId)-\(bubbleId)" }

    enum CodingKeys: String, CodingKey {
        case approved, role, bubble, user
        case userId = "user_id"
        case bubbleId = "bubble_id"
        case createdAt = "created_at"
    }
}

/// Minimal bubble embed (`bubble:bubbles(id, name)`).
struct BubbleRef: Codable, Hashable, Sendable {
    let id: UUID
    var name: String
    var logo: String?
}

/// `public.join_requests`
struct JoinRequest: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let userId: UUID
    let bubbleId: UUID
    var approverIds: [UUID]
    var createdAt: Date
    var user: UserProfile?
    var bubble: BubbleRef?

    enum CodingKeys: String, CodingKey {
        case id, user, bubble
        case userId = "user_id"
        case bubbleId = "bubble_id"
        case approverIds = "approver_ids"
        case createdAt = "created_at"
    }

    /// Approvals needed for admission: a strict majority of approved members (see approve_join_request).
    static func approvalsNeeded(memberCount: Int) -> Int { memberCount / 2 + 1 }

    /// Only votes from people who are still approved members count (try_admit_join_request).
    func countedApprovals(memberIDs: Set<UUID>) -> Int {
        Set(approverIds).intersection(memberIDs).count
    }

    /// Has a majority but the bubble is full: the backend admits the requester when a seat frees.
    static func isWaitingForSeat(approvals: Int, memberCount: Int, maxSize: Int) -> Bool {
        approvals * 2 > memberCount && memberCount >= maxSize
    }
}

/// `public.chat_messages` (photos and soft delete: 20261123120000_chat_improvements.sql)
struct ChatMessage: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let bubbleId: UUID
    let senderId: UUID
    /// The text, or the photo's caption (may be empty with a photo; always empty once deleted).
    var content: String
    var createdAt: Date
    /// Object path in the private `chat.images` bucket (`<sender uid>/<file>.jpg`), shown through a signed URL.
    var imagePath: String? = nil
    /// Set when the author deleted the message: text and photo are wiped, a placeholder is shown.
    var deletedAt: Date? = nil
    var sender: UserProfile?

    enum CodingKeys: String, CodingKey {
        case id, content, sender
        case bubbleId = "bubble_id"
        case senderId = "sender_id"
        case createdAt = "created_at"
        case imagePath = "image_path"
        case deletedAt = "deleted_at"
    }

    var isDeleted: Bool { deletedAt != nil }

    /// The placeholder of this message once its author deleted it (what the server's UPDATE carries).
    func asDeleted(at date: Date = .now) -> ChatMessage {
        var copy = self
        copy.content = ""
        copy.imagePath = nil
        copy.deletedAt = date
        return copy
    }
}

/// One row of `chat_unread_counts()`.
struct ChatUnread: Codable, Hashable, Sendable {
    let bubbleId: UUID
    /// Messages from others after the marker, capped at 100 by the server.
    let unreadCount: Int
    let lastReadAt: Date

    enum CodingKeys: String, CodingKey {
        case bubbleId = "bubble_id"
        case unreadCount = "unread_count"
        case lastReadAt = "last_read_at"
    }

    /// Badge text: nothing for 0, the number up to 99, "99+" above (docs/i18n-glossary.md, "Chat").
    static func badgeText(_ count: Int) -> String? {
        count <= 0 ? nil : count > 99 ? "99+" : String(count)
    }
}

/// `public.events`
struct BubbleEvent: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let bubbleId: UUID
    let creatorId: UUID
    var title: String
    var description: String?
    var datetime: Date
    var location: String?
    var rsvpList: [UUID]
    var createdAt: Date
    var creator: UserProfile?

    enum CodingKeys: String, CodingKey {
        case id, title, description, datetime, location, creator
        case bubbleId = "bubble_id"
        case creatorId = "creator_id"
        case rsvpList = "rsvp_list"
        case createdAt = "created_at"
    }
}

/// `public.food_posts`
struct FoodPost: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let bubbleId: UUID
    let userId: UUID
    var image: String
    var description: String?
    var createdAt: Date
    var user: UserProfile?

    enum CodingKeys: String, CodingKey {
        case id, image, description, user
        case bubbleId = "bubble_id"
        case userId = "user_id"
        case createdAt = "created_at"
    }
}

enum MarketStatus: String, Codable, CaseIterable, Sendable {
    case free, trade
    var label: LocalizedStringResource {
        switch self {
        case .free: LocalizedStringResource("Free", comment: "Marketplace item status")
        case .trade: LocalizedStringResource("Trade", comment: "Marketplace item status")
        }
    }
}

/// Whether a market item can still be had (`market_items.availability`, migration
/// 20261123170000). Who it is reserved for is deliberately not stored (docs/boolaa-spec.md).
enum MarketAvailability: String, Codable, CaseIterable, Sendable {
    case available, reserved, taken
    var label: LocalizedStringResource {
        switch self {
        case .available: LocalizedStringResource("Available", comment: "Marketplace item availability")
        case .reserved: LocalizedStringResource("Reserved", comment: "Marketplace item availability")
        case .taken: LocalizedStringResource("Taken", comment: "Marketplace item availability")
        }
    }
    /// Unknown future values read as available rather than failing the whole list.
    init(from decoder: any Decoder) throws {
        self = MarketAvailability(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .available
    }
}

/// `public.market_items`
struct MarketItem: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let bubbleId: UUID
    let ownerId: UUID
    var image: String
    var title: String
    var description: String?
    var status: MarketStatus
    var availability: MarketAvailability = .available
    var createdAt: Date
    var owner: UserProfile?

    enum CodingKeys: String, CodingKey {
        case id, image, title, description, status, availability, owner
        case bubbleId = "bubble_id"
        case ownerId = "owner_id"
        case createdAt = "created_at"
    }
}

extension MarketItem {
    /// `availability` defaults to available when a payload predates the column.
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        bubbleId = try c.decode(UUID.self, forKey: .bubbleId)
        ownerId = try c.decode(UUID.self, forKey: .ownerId)
        image = try c.decode(String.self, forKey: .image)
        title = try c.decode(String.self, forKey: .title)
        description = try c.decodeIfPresent(String.self, forKey: .description)
        status = try c.decode(MarketStatus.self, forKey: .status)
        availability = try c.decodeIfPresent(MarketAvailability.self, forKey: .availability) ?? .available
        createdAt = try c.decode(Date.self, forKey: .createdAt)
        owner = try c.decodeIfPresent(UserProfile.self, forKey: .owner)
    }

    /// The "Ask in chat" draft for someone else's item that isn't taken; nil for your own or taken items.
    func chatDraft(me: UUID?, bundle: Bundle = .main, locale: Locale = .current) -> String? {
        guard ownerId != me, availability != .taken else { return nil }
        let name = owner?.displayName ?? String(localized: "Someone", bundle: bundle, locale: locale,
                                                comment: "Placeholder for a user without a name")
        return String(localized: "@\(name), is “\(title)” still available?", bundle: bundle, locale: locale,
                      comment: "Prefilled chat message asking about a marketplace item; arguments are the owner's name and the item title")
    }
}

/// `public.shared_links`
struct SharedLink: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let bubbleId: UUID
    let userId: UUID
    var url: String
    var title: String?
    var tags: [String]
    var createdAt: Date
    var user: UserProfile?
    // Link preview, written by the server only (docs/boolaa-spec.md, "Link previews").
    var previewStatus: String? = nil
    var previewTitle: String? = nil
    var previewDescription: String? = nil
    var previewSiteName: String? = nil
    var previewImagePath: String? = nil

    enum CodingKeys: String, CodingKey {
        case id, url, title, tags, user
        case bubbleId = "bubble_id"
        case userId = "user_id"
        case createdAt = "created_at"
        case previewStatus = "preview_status"
        case previewTitle = "preview_title"
        case previewDescription = "preview_description"
        case previewSiteName = "preview_site_name"
        case previewImagePath = "preview_image_path"
    }

    enum PreviewState: Equatable { case none, loading, ready }

    /// `ready` shows the card; `pending` / `fetching` the plain link with "Loading preview…";
    /// anything else (`none`, `failed`, missing) the plain link.
    var previewState: PreviewState {
        switch previewStatus {
        case "ready": (previewTitle?.nilIfEmpty != nil || previewDescription?.nilIfEmpty != nil || previewImagePath != nil) ? .ready : .none
        case "pending", "fetching": .loading
        default: .none
        }
    }

    /// The host without "www.", lowercased (e.g. "https://WWW.Example.com/a" → "example.com").
    static func displayDomain(_ url: String) -> String? {
        guard let host = URL(string: url.trimmingCharacters(in: .whitespaces))?.host()?.lowercased(), !host.isEmpty else { return nil }
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }

    /// Parses "food, cheap ,  ,Recipes" into ["food", "cheap", "recipes"].
    static func parseTags(_ raw: String) -> [String] {
        var seen = Set<String>()
        return raw.split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            .filter { !$0.isEmpty && seen.insert($0).inserted }
    }
}

// MARK: - Write payloads

struct NewChatMessage: Encodable, Sendable {
    let bubbleId: UUID
    let senderId: UUID
    let content: String
    var imagePath: String? = nil
    enum CodingKeys: String, CodingKey {
        case content
        case bubbleId = "bubble_id"
        case senderId = "sender_id"
        case imagePath = "image_path"
    }
}

struct EventInput: Encodable, Sendable {
    var bubbleId: UUID?
    var creatorId: UUID?
    var title: String
    var description: String?
    var datetime: Date
    var location: String?
    enum CodingKeys: String, CodingKey {
        case title, description, datetime, location
        case bubbleId = "bubble_id"
        case creatorId = "creator_id"
    }
    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(bubbleId, forKey: .bubbleId)
        try c.encodeIfPresent(creatorId, forKey: .creatorId)
        try c.encode(title, forKey: .title)
        try c.encode(description, forKey: .description)
        try c.encode(datetime, forKey: .datetime)
        try c.encode(location, forKey: .location)
    }
}

struct FoodInput: Encodable, Sendable {
    var bubbleId: UUID?
    var userId: UUID?
    var image: String
    var description: String?
    enum CodingKeys: String, CodingKey { case image, description; case bubbleId = "bubble_id"; case userId = "user_id" }
    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(bubbleId, forKey: .bubbleId)
        try c.encodeIfPresent(userId, forKey: .userId)
        try c.encode(image, forKey: .image)
        try c.encode(description, forKey: .description)
    }
}

struct MarketInput: Encodable, Sendable {
    var bubbleId: UUID?
    var ownerId: UUID?
    var image: String
    var title: String
    var description: String?
    var status: MarketStatus
    var availability: MarketAvailability = .available
    enum CodingKeys: String, CodingKey { case image, title, description, status, availability; case bubbleId = "bubble_id"; case ownerId = "owner_id" }
    func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(bubbleId, forKey: .bubbleId)
        try c.encodeIfPresent(ownerId, forKey: .ownerId)
        try c.encode(image, forKey: .image)
        try c.encode(title, forKey: .title)
        try c.encode(description, forKey: .description)
        try c.encode(status, forKey: .status)
        try c.encode(availability, forKey: .availability)
    }
}

struct LinkInput: Encodable, Sendable {
    let bubbleId: UUID
    let userId: UUID
    let url: String
    let title: String?
    let tags: [String]
    enum CodingKeys: String, CodingKey { case url, title, tags; case bubbleId = "bubble_id"; case userId = "user_id" }
}
