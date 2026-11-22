import Foundation
import Observation
import Supabase

/// What can be reported (report_content's p_target_type).
enum ReportTargetType: String, Codable, Sendable {
    case user, chatMessage = "chat_message", event, foodPost = "food_post", marketItem = "market_item", sharedLink = "shared_link"

    var reportTitle: LocalizedStringResource {
        switch self {
        case .user: "Report member"
        case .chatMessage: "Report message"
        case .event: "Report event"
        case .foodPost: "Report food post"
        case .marketItem: "Report item"
        case .sharedLink: "Report link"
        }
    }
}

/// The 7 report reasons accepted by report_content.
enum ReportReason: String, CaseIterable, Codable, Sendable, Identifiable {
    case spam, harassment, hate, sexual, violence, selfHarm = "self_harm", other
    var id: String { rawValue }
    var label: LocalizedStringResource {
        switch self {
        case .spam: LocalizedStringResource("Spam or scam", comment: "Report reason")
        case .harassment: LocalizedStringResource("Harassment or bullying", comment: "Report reason")
        case .hate: LocalizedStringResource("Hate speech", comment: "Report reason")
        case .sexual: LocalizedStringResource("Sexual content", comment: "Report reason")
        case .violence: LocalizedStringResource("Violence or threats", comment: "Report reason")
        case .selfHarm: LocalizedStringResource("Self-harm or suicide", comment: "Report reason")
        case .other: LocalizedStringResource("Something else", comment: "Report reason")
        }
    }
}

/// A piece of content (or a member) someone wants to report or whose author they want to block.
struct ReportTarget: Identifiable, Hashable, Sendable {
    var type: ReportTargetType
    var targetID: UUID
    var author: UserProfile?
    var authorID: UUID
    var id: String { "\(type.rawValue)-\(targetID)" }

    var authorName: String { author?.displayName ?? String(localized: "Someone", comment: "Placeholder for a user without a name") }

    static func message(_ m: ChatMessage) -> ReportTarget { .init(type: .chatMessage, targetID: m.id, author: m.sender, authorID: m.senderId) }
    static func event(_ e: BubbleEvent) -> ReportTarget { .init(type: .event, targetID: e.id, author: e.creator, authorID: e.creatorId) }
    static func food(_ f: FoodPost) -> ReportTarget { .init(type: .foodPost, targetID: f.id, author: f.user, authorID: f.userId) }
    static func market(_ i: MarketItem) -> ReportTarget { .init(type: .marketItem, targetID: i.id, author: i.owner, authorID: i.ownerId) }
    static func link(_ l: SharedLink) -> ReportTarget { .init(type: .sharedLink, targetID: l.id, author: l.user, authorID: l.userId) }
    static func member(_ m: BubbleMember) -> ReportTarget { .init(type: .user, targetID: m.userId, author: m.user, authorID: m.userId) }
}

/// A row of the caller's own block list, with the blocked person's profile when it is still visible.
struct BlockedUser: Codable, Identifiable, Hashable, Sendable {
    let blockedId: UUID
    let createdAt: Date
    var user: UserProfile?
    var id: UUID { blockedId }
    enum CodingKeys: String, CodingKey { case blockedId = "blocked_id", createdAt = "created_at", user }
}

extension BoolaaAPI {
    static let userBuckets: [ImageBucket] = [.avatars, .food, .market]

    /// Raises "cannot report yourself" / "report target not found". Returns the report id.
    func report(_ target: ReportTarget, reason: ReportReason, details: String?) async throws -> UUID {
        struct Params: Encodable { let p_target_type: String; let p_target_id: UUID; let p_reason: String; let p_details: String? }
        return try await client.rpc("report_content", params: Params(
            p_target_type: target.type.rawValue, p_target_id: target.targetID,
            p_reason: reason.rawValue, p_details: details?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        )).execute().value
    }

    func blockedUsers() async throws -> [BlockedUser] {
        try await client.from("blocks")
            .select("blocked_id, created_at, user:users!blocked_id(\(Self.authorColumns))")
            .order("created_at", ascending: false)
            .execute().value
    }

    func block(userID: UUID, me: UUID) async throws {
        struct Row: Encodable { let blocker_id: UUID; let blocked_id: UUID }
        try await client.from("blocks").upsert(Row(blocker_id: me, blocked_id: userID), ignoreDuplicates: true).execute()
    }

    func unblock(userID: UUID, me: UUID) async throws {
        try await client.from("blocks").delete().eq("blocker_id", value: me).eq("blocked_id", value: userID).execute()
    }

    /// Removes every object under `<uid>/` in the user's buckets. Best effort: failures are ignored.
    func purgeMyFiles(userID: UUID) async {
        let folder = userID.uuidString.lowercased()
        for bucket in Self.userBuckets {
            let api = client.storage.from(bucket.rawValue)
            for _ in 0..<20 {  // 100 per page; stop when a page is empty or nothing could be removed
                guard let files = try? await api.list(path: folder, options: SearchOptions(limit: 100)), !files.isEmpty,
                      let removed = try? await api.remove(paths: files.map { "\(folder)/\($0.name)" }), !removed.isEmpty
                else { break }
            }
        }
    }

    /// Deletes the caller's files, then their account (delete_my_account cascades to everything else).
    func deleteMyAccount(userID: UUID) async throws {
        await purgeMyFiles(userID: userID)
        try await client.rpc("delete_my_account").execute()
    }
}

/// Block list and the report flow shared by every screen of the main shell.
@MainActor
@Observable
final class SafetyStore {
    private(set) var blocked: [BlockedUser] = []
    private(set) var loaded = false
    /// Bumped after a block or unblock so screens reload (RLS hides or shows the other person's content).
    private(set) var contentVersion = 0
    /// The report sheet is shown while this is set.
    var reportTarget: ReportTarget?
    var error: String?

    private let session: SessionStore
    init(session: SessionStore) { self.session = session }

    var blockedIDs: Set<UUID> { Set(blocked.map(\.blockedId)) }
    func isBlocked(_ id: UUID) -> Bool { blockedIDs.contains(id) }

    func load() async {
        do { blocked = try await session.api.blockedUsers(); loaded = true }
        catch { self.error = error.userMessage }
    }

    func block(_ userID: UUID) async {
        guard let me = session.userID, userID != me else { return }
        do {
            try await session.api.block(userID: userID, me: me)
            await load()
            contentVersion += 1
        } catch { self.error = error.userMessage }
    }

    func unblock(_ userID: UUID) async {
        guard let me = session.userID else { return }
        do {
            try await session.api.unblock(userID: userID, me: me)
            blocked.removeAll { $0.blockedId == userID }
            contentVersion += 1
        } catch { self.error = error.userMessage }
    }

    func reset() { blocked = []; loaded = false; reportTarget = nil }
}
