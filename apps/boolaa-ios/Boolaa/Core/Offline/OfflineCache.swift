import Foundation

/// The last successfully loaded view of each screen, per user (docs/boolaa-spec.md, "Offline and poor
/// network"). Small JSON files in `Caches/offline/<user id>/<key>.json`, each wrapped in an envelope
/// `{"v": 1, "savedAt": …, "data": …}`. Rows keep only our storage identifiers (public-form URL or object
/// path), never a signed URL. Cleared on sign-out and account deletion; on sign-in every other user's
/// folder is deleted, so nothing of one account is ever shown to another.
final class OfflineCache: @unchecked Sendable {
    static let shared = OfflineCache(root: FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        .appending(path: "offline", directoryHint: .isDirectory))

    static let version = 1
    static let maxAge: TimeInterval = 30 * 24 * 3600

    /// Cache keys (same names on web and Android).
    enum Key {
        static let bubbles = "bubbles"
        static func home(_ bubble: UUID) -> String { "home.\(bubble.uuidString.lowercased())" }
        static func chat(_ bubble: UUID) -> String { "chat.\(bubble.uuidString.lowercased())" }
        static func events(_ bubble: UUID) -> String { "events.\(bubble.uuidString.lowercased())" }
        static func food(_ bubble: UUID) -> String { "food.\(bubble.uuidString.lowercased())" }
        static func market(_ bubble: UUID) -> String { "market.\(bubble.uuidString.lowercased())" }
        static func links(_ bubble: UUID) -> String { "links.\(bubble.uuidString.lowercased())" }
        static func members(_ bubble: UUID) -> String { "members.\(bubble.uuidString.lowercased())" }
        /// `mention_candidates`, cached beside the members.
        static func mentionCandidates(_ bubble: UUID) -> String { "members.\(bubble.uuidString.lowercased()).mentions" }
    }

    let root: URL
    private let lock = NSLock()
    private var user: UUID?
    private let now: @Sendable () -> Date

    init(root: URL, now: @escaping @Sendable () -> Date = { .now }) {
        self.root = root
        self.now = now
    }

    /// The signed-in user whose folder reads and writes use (nil: nothing is read or written).
    var currentUser: UUID? {
        get { lock.withLock { user } }
        set { lock.withLock { user = newValue } }
    }

    private struct Envelope<T: Codable>: Codable {
        var v: Int
        var savedAt: Date
        var data: T
    }

    private struct Header: Decodable {
        var v: Int
        var savedAt: Date
    }

    /// Plain JSON coding with lossless dates (independent of the PostgREST date format).
    private static func encoder() -> JSONEncoder {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .millisecondsSince1970
        return e
    }

    private static func decoder() -> JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .millisecondsSince1970
        return d
    }

    private func file(_ key: String, user: UUID) -> URL {
        let safe = key.map { $0.isLetter || $0.isNumber || $0 == "." || $0 == "-" ? $0 : "_" }
        return root.appending(path: user.uuidString.lowercased(), directoryHint: .isDirectory)
            .appending(path: String(safe) + ".json")
    }

    /// The cached value for the current user, or nil (missing, other version, unreadable, older than 30 days:
    /// the bad file is deleted).
    func read<T: Codable>(_ type: T.Type, key: String) -> T? {
        guard let user = currentUser else { return nil }
        let url = file(key, user: user)
        guard let data = try? Data(contentsOf: url) else { return nil }
        let decoder = Self.decoder()
        guard let header = try? decoder.decode(Header.self, from: data), header.v == Self.version,
              now().timeIntervalSince(header.savedAt) < Self.maxAge,
              let envelope = try? decoder.decode(Envelope<T>.self, from: data) else {
            try? FileManager.default.removeItem(at: url)
            return nil
        }
        return envelope.data
    }

    /// Writes synchronously (tests, small payloads). The app calls `save`, which writes off the main thread.
    func write<T: Codable>(_ value: T, key: String) {
        guard let user = currentUser else { return }
        let url = file(key, user: user)
        guard let data = try? Self.encoder().encode(Envelope(v: Self.version, savedAt: now(), data: value)) else { return }
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        // A sign-out may have cleared the folder while this was being written.
        if currentUser != user { try? FileManager.default.removeItem(at: url) }
    }

    func save<T: Codable & Sendable>(_ value: T, key: String) {
        Task.detached(priority: .utility) { [self] in write(value, key: key) }
    }

    /// Sign-out, account deletion: every user's cache goes.
    func clearAll() {
        currentUser = nil
        try? FileManager.default.removeItem(at: root)
    }

    /// Sign-in / session restore: only this user's folder may stay (a session that ended without a
    /// sign-out must not leave its data behind for the next account).
    func keepOnly(_ user: UUID) {
        currentUser = user
        let keep = user.uuidString.lowercased()
        let folders = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? []
        for folder in folders where folder.lastPathComponent != keep {
            try? FileManager.default.removeItem(at: folder)
        }
    }

    /// Whether the user has any cached view (used to let a session start offline).
    func hasData(for user: UUID) -> Bool {
        let folder = root.appending(path: user.uuidString.lowercased(), directoryHint: .isDirectory)
        return ((try? FileManager.default.contentsOfDirectory(atPath: folder.path(percentEncoded: false))) ?? []).isEmpty == false
    }
}
