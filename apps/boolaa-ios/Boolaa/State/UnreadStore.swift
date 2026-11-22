import Foundation
import Observation

/// Unread chat counts per bubble (`chat_unread_counts()`) for the badges on the bubble chips and the
/// chat button (docs/boolaa-spec.md, "Chat" → Unread counts). Refreshed on start and foreground, when
/// the bubble list changes, after marking a chat read, and (debounced) on any chat INSERT the user can
/// see, through an unfiltered channel `unread:<user id>` (RLS limits it to their bubbles).
@MainActor
@Observable
final class UnreadStore {
    private(set) var counts: [UUID: Int] = [:]
    private(set) var lastReadAt: [UUID: Date] = [:]

    private let session: SessionStore
    private let reloads = ReloadCoalescer()
    /// Only the newest refresh may write, so a slow response can't bring back an old count.
    private var generation = 0

    init(session: SessionStore) { self.session = session }

    func count(for bubbleID: UUID?) -> Int { bubbleID.flatMap { counts[$0] } ?? 0 }

    func refresh() async {
        guard session.userID != nil else { return }
        generation += 1
        let mine = generation
        guard let rows = try? await session.api.chatUnreadCounts(), mine == generation else { return }
        apply(rows)
    }

    func apply(_ rows: [ChatUnread]) {
        counts = Dictionary(rows.map { ($0.bubbleId, $0.unreadCount) }, uniquingKeysWith: { a, _ in a })
        lastReadAt = Dictionary(rows.map { ($0.bubbleId, $0.lastReadAt) }, uniquingKeysWith: { a, _ in a })
    }

    func scheduleRefresh() {
        reloads.schedule(after: .milliseconds(600)) { [weak self] in await self?.refresh() }
    }

    /// Marks the chat read up to `messageID` (the newest message shown), then refreshes the badges.
    func markRead(bubbleID: UUID, messageID: UUID) async {
        do { try await session.api.markChatRead(bubbleID: bubbleID, messageID: messageID) } catch { return }
        counts[bubbleID] = 0
        await refresh()
    }

    /// Streams chat INSERTs (and UPDATEs, so a deleted unread message drops out) until the task is cancelled.
    func watch(userID: UUID) async {
        await LiveChanges.observe(
            session.api.client,
            topic: "unread:\(userID.uuidString.lowercased())",
            watches: [.init(table: "chat_messages", column: nil, equals: nil, deleteMatches: { _ in false })],
            onSubscribed: { [weak self] in self?.scheduleRefresh() },
            onChange: { [weak self] in self?.scheduleRefresh() }
        )
    }

    func reset() {
        reloads.cancel()
        generation += 1
        counts = [:]
        lastReadAt = [:]
    }
}
