import Foundation
import Observation
import Supabase

/// A chat message written on this device that the server hasn't confirmed yet.
struct PendingMessage: Codable, Identifiable, Hashable, Sendable {
    enum State: String, Codable, Sendable { case sending, failed }

    /// Client-generated; becomes `chat_messages.id`, so a retry can never create a second row.
    let id: UUID
    let bubbleId: UUID
    let senderId: UUID
    var content: String
    var createdAt: Date
    var state: State
    /// The prepared JPEG of a photo message. Kept in memory only (not persisted).
    var photo: Data?
    /// Code-point spans against `content` exactly as it is sent (persisted and retried unchanged).
    var mentions: [MentionSpan]? = nil

    enum CodingKeys: String, CodingKey { case id, bubbleId, senderId, content, createdAt, state, mentions }

    /// List identity of the pending row, distinct from the server row's `id` it turns into.
    var pendingRowID: String { "pending-" + id.uuidString }

    /// `chat.images/<uid>/<client id>.jpg`: a retried upload targets the same object.
    var photoPath: String? { photo == nil ? nil : BoolaaAPI.chatImagePath(userID: senderId, fileID: id) }
}

/// What a delivery attempt did.
enum DeliveryOutcome: Sendable, Equatable {
    /// The server holds the message (the row, when it could be read back).
    case sent(ChatMessage?)
    case failed
}

/// The chat outbox (docs/boolaa-spec.md, "Offline and poor network"): messages typed offline or while a send
/// is in flight. `sending` → sent (removed, the server row merges by id) or `failed` ("Not sent — tap to
/// retry"). Offline, messages stay `sending` and are flushed in order when the app is back online. Text
/// messages are persisted per user (Application Support/outbox/<uid>.json) and come back as `failed` after
/// a restart; photo messages live in memory only. Cleared on sign-out and account deletion.
@MainActor
@Observable
final class ChatOutbox {
    static let shared = ChatOutbox(directory: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appending(path: "outbox", directoryHint: .isDirectory))

    private(set) var items: [PendingMessage] = []
    private let directory: URL
    private var user: UUID?
    private var inFlight: Set<UUID> = []
    private var flushing = false
    /// Delivers one message (upload + insert); set by `configure(api:)`, replaced in tests.
    var deliver: (@MainActor (PendingMessage) async -> DeliveryOutcome)?
    /// Called with every confirmed message (the open chat merges it).
    var onSent: (@MainActor (ChatMessage) -> Void)?

    init(directory: URL) { self.directory = directory }

    // MARK: Lifecycle

    /// Signed in as `user`: loads that user's persisted messages as `failed` (no surprise sends of stale
    /// text after a restart) and deletes every other user's file.
    func activate(user: UUID) {
        guard self.user != user else { return }
        self.user = user
        let keep = file(for: user).lastPathComponent
        for url in (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        where url.lastPathComponent != keep {
            try? FileManager.default.removeItem(at: url)
        }
        let saved = (try? Data(contentsOf: file(for: user))).flatMap { try? JSONDecoder.outbox.decode([PendingMessage].self, from: $0) } ?? []
        items = saved.filter { $0.senderId == user }.map { var m = $0; m.state = .failed; return m }
    }

    /// Sign-out, account deletion.
    func clearAll() {
        user = nil
        items = []
        inFlight = []
        try? FileManager.default.removeItem(at: directory)
    }

    // MARK: Queries

    /// The bubble's pending messages, in the order they were written, minus any the server list already
    /// holds (the realtime echo may arrive before the insert answers).
    func pending(in bubble: UUID, excluding serverIDs: Set<UUID> = []) -> [PendingMessage] {
        Self.visible(items, bubble: bubble, excluding: serverIDs)
    }

    nonisolated static func visible(_ items: [PendingMessage], bubble: UUID, excluding serverIDs: Set<UUID>) -> [PendingMessage] {
        items.filter { $0.bubbleId == bubble && !serverIDs.contains($0.id) }.sorted { $0.createdAt < $1.createdAt }
    }

    // MARK: Actions

    /// Adds a message as `sending`. Online it is delivered at once; offline it waits for `flush()`.
    @discardableResult
    func enqueue(bubbleID: UUID, senderID: UUID, text: String, photo: Data?, mentions: [MentionSpan] = [], online: Bool,
                 id: UUID = UUID(), now: Date = .now) async -> PendingMessage {
        let message = PendingMessage(id: id, bubbleId: bubbleID, senderId: senderID, content: text,
                                     createdAt: now, state: .sending, photo: photo, mentions: mentions.isEmpty ? nil : mentions)
        items.append(message)
        persist()
        if online { await attempt(message.id) }
        return message
    }

    /// "Not sent — tap to retry".
    func retry(_ id: UUID) async {
        guard let idx = items.firstIndex(where: { $0.id == id }) else { return }
        items[idx].state = .sending
        persist()
        await attempt(id)
    }

    /// "Don't send": drops the message (its uploaded photo, if any, is removed by the caller).
    func discard(_ id: UUID) -> PendingMessage? {
        guard let idx = items.firstIndex(where: { $0.id == id }) else { return nil }
        let removed = items.remove(at: idx)
        persist()
        return removed
    }

    /// Back online: sends every `sending` message, oldest first, one at a time.
    func flush() async {
        guard !flushing else { return }
        flushing = true
        defer { flushing = false }
        for id in items.filter({ $0.state == .sending }).sorted(by: { $0.createdAt < $1.createdAt }).map(\.id) {
            await attempt(id)
        }
    }

    private func attempt(_ id: UUID) async {
        guard let message = items.first(where: { $0.id == id }), let deliver, !inFlight.contains(id) else { return }
        inFlight.insert(id)
        defer { inFlight.remove(id) }
        switch await deliver(message) {
        case .sent(let row):
            items.removeAll { $0.id == id }
            persist()
            if let row { onSent?(row) }
        case .failed:
            if let idx = items.firstIndex(where: { $0.id == id }) { items[idx].state = .failed }
            persist()
        }
    }

    // MARK: Persistence (text only)

    private func file(for user: UUID) -> URL {
        directory.appending(path: user.uuidString.lowercased() + ".json")
    }

    private func persist() {
        guard let user else { return }
        let text = items.filter { $0.photo == nil && $0.senderId == user }
        let url = file(for: user)
        if text.isEmpty { try? FileManager.default.removeItem(at: url); return }
        guard let data = try? JSONEncoder.outbox.encode(text) else { return }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    // MARK: Delivery through Supabase

    /// Wires the real delivery: upload the photo to `<uid>/<client id>.jpg` (an object that already exists
    /// counts as uploaded), insert the row with the client id (Postgres 23505 = already sent), read it back.
    func configure(api: BoolaaAPI) {
        deliver = { message in
            do {
                if let photo = message.photo, let path = message.photoPath {
                    do {
                        try await api.uploadChatImage(photo, path: path)
                    } catch where Self.isAlreadyUploaded(error) {}
                }
                do {
                    let row = try await api.sendMessage(id: message.id, bubbleID: message.bubbleId, senderID: message.senderId,
                                                        content: message.content, imagePath: message.photoPath,
                                                        mentions: message.mentions ?? [])
                    Connectivity.shared.reportSuccess()
                    return .sent(row)
                } catch where Self.isDuplicate(error) {
                    Connectivity.shared.reportSuccess()
                    return .sent(try? await api.chatMessage(id: message.id))
                }
            } catch {
                Connectivity.shared.report(error)
                _ = UserFacingError.classify(error) // "session not verified" / "account suspended" re-run the gate
                return .failed
            }
        }
    }

    /// Postgres unique_violation: the first attempt reached the server, the message exists.
    nonisolated static func isDuplicate(_ error: any Error) -> Bool {
        (error as? PostgrestError)?.code == "23505"
    }

    /// Storage answers 409 / "Duplicate" / "already exists" when a retried upload's object is there.
    nonisolated static func isAlreadyUploaded(_ error: any Error) -> Bool {
        guard let storage = error as? StorageError else { return false }
        return storage.statusCode == "409" || storage.error == "Duplicate"
            || storage.message.lowercased().contains("already exists")
    }
}

private extension JSONEncoder {
    static var outbox: JSONEncoder {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .millisecondsSince1970
        return e
    }
}

private extension JSONDecoder {
    static var outbox: JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .millisecondsSince1970
        return d
    }
}
