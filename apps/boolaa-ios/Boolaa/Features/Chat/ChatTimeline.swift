import Foundation
import Observation

/// Pure list rules for the chat (docs/boolaa-spec.md, "Chat"): pages, live INSERT/UPDATE merge by id,
/// and where the "New messages" divider goes. Unit-tested.
enum ChatTimeline {
    /// An INSERT (or the echo of our own insert): adds the message in chronological order, or replaces
    /// the one with the same id. A missing sender (realtime payloads have none) is kept from the list.
    /// Messages with equal timestamps keep the order they arrived in.
    static func upsert(_ messages: [ChatMessage], _ message: ChatMessage) -> [ChatMessage] {
        if let idx = messages.firstIndex(where: { $0.id == message.id }) {
            return replace(messages, at: idx, with: message)
        }
        var next = messages
        let insertAt = (messages.lastIndex { $0.createdAt <= message.createdAt }).map { $0 + 1 } ?? 0
        next.insert(message, at: insertAt)
        return next
    }

    /// An UPDATE (how deletions arrive): replaces a message we hold, in place. Ids we don't hold
    /// (older than the loaded pages) change nothing, so paging stays gap-free.
    static func applyUpdate(_ messages: [ChatMessage], _ message: ChatMessage) -> [ChatMessage] {
        guard let idx = messages.firstIndex(where: { $0.id == message.id }) else { return messages }
        return replace(messages, at: idx, with: message)
    }

    /// Puts an older page (chronological) in front of the list, skipping ids already held.
    static func prepend(_ messages: [ChatMessage], olderPage: [ChatMessage]) -> [ChatMessage] {
        let held = Set(messages.map(\.id))
        return olderPage.filter { !held.contains($0.id) } + messages
    }

    /// A page shorter than the requested size means the start of the chat is reached.
    static func reachedStart(pageCount: Int, limit: Int = BoolaaAPI.chatPageSize) -> Bool { pageCount < limit }

    /// The message the "New messages" divider goes above: the first one from someone else newer than
    /// the marker captured when the chat opened. Deleted messages don't count (nor do they in the badge).
    static func dividerID(_ messages: [ChatMessage], lastReadAt: Date?, me: UUID?) -> UUID? {
        guard let lastReadAt else { return nil }
        return messages.first { $0.senderId != me && !$0.isDeleted && $0.createdAt > lastReadAt }?.id
    }

    /// Photo paths of live messages, for signing.
    static func imagePaths(_ messages: [ChatMessage]) -> [String] {
        messages.compactMap { $0.isDeleted ? nil : $0.imagePath }
    }

    private static func replace(_ messages: [ChatMessage], at idx: Int, with message: ChatMessage) -> [ChatMessage] {
        var message = message
        if message.sender == nil { message.sender = messages[idx].sender }
        if messages[idx] == message { return messages }
        var next = messages
        next[idx] = message
        return next
    }
}

/// Signed URLs for chat photos in the private `chat.images` bucket: one hour, cached per path and
/// re-signed when less than five minutes remain. Signs a whole page in one request.
@MainActor
@Observable
final class ChatImageURLs {
    static let lifetime = 3600
    private(set) var entries: [String: (url: URL, expires: Date)] = [:]
    private var inFlight: Set<String> = []

    func url(for path: String?) -> URL? {
        guard let path, let entry = entries[path], entry.expires > .now else { return nil }
        return entry.url
    }

    /// Paths that need a (new) signature at `now`.
    func missing(_ paths: [String], now: Date = .now) -> [String] {
        Array(Set(paths.filter { path in
            guard !inFlight.contains(path) else { return false }
            guard let entry = entries[path] else { return true }
            return entry.expires.timeIntervalSince(now) < 300
        })).sorted()
    }

    func sign(_ paths: [String], api: BoolaaAPI) async {
        let todo = missing(paths)
        guard !todo.isEmpty else { return }
        inFlight.formUnion(todo)
        defer { inFlight.subtract(todo) }
        let requestedAt = Date.now
        guard let urls = try? await api.signedChatImageURLs(paths: todo, expiresIn: Self.lifetime) else { return }
        for (path, url) in urls {
            entries[path] = (url, requestedAt.addingTimeInterval(TimeInterval(Self.lifetime)))
        }
    }

    func reset() { entries = [:]; inFlight = [] }
}
