import Foundation

/// Search inside a bubble (docs/boolaa-spec.md, "Search"): the `search_bubble` row, diacritic-insensitive
/// highlighting and the chat jump window. Pure logic, unit-tested in SearchTests.
enum SearchKind: String, Sendable, CaseIterable {
    case chatMessage = "chat_message"
    case event
    case foodPost = "food_post"
    case marketItem = "market_item"
    case sharedLink = "shared_link"

    var feature: Feature {
        switch self {
        case .chatMessage: .chat
        case .event: .events
        case .foodPost: .food
        case .marketItem: .market
        case .sharedLink: .links
        }
    }

    var label: String {
        switch self {
        case .chatMessage: String(localized: "Message", comment: "Kind of a search result")
        case .event: String(localized: "Event", comment: "Kind of a search result")
        case .foodPost: String(localized: "Food post", comment: "Kind of a search result")
        case .marketItem: String(localized: "Item", comment: "Kind of a search result (marketplace item)")
        case .sharedLink: String(localized: "Link")
        }
    }
}

struct SearchHit: Identifiable, Hashable, Sendable {
    let kind: SearchKind
    let id: UUID
    let title: String?
    let snippet: String?
    let authorID: UUID
    let authorName: String?
    let createdAt: Date
    let eventAt: Date?
    let matchedWords: [String]
}

/// The RPC row as sent; `kind` stays a string so kinds a newer server adds are skipped, not fatal.
struct SearchHitRow: Decodable, Sendable {
    let kind: String
    let id: UUID
    let title: String?
    let snippet: String?
    let author_id: UUID
    let author_name: String?
    let created_at: Date
    let event_at: Date?
    let matched_words: [String]?

    var hit: SearchHit? {
        guard let kind = SearchKind(rawValue: kind) else { return nil }
        return SearchHit(kind: kind, id: id, title: title, snippet: snippet, authorID: author_id, authorName: author_name,
                         createdAt: created_at, eventAt: event_at, matchedWords: matched_words ?? [])
    }
}

enum SearchRules {
    static let minLength = 2
    static let limit = 30
    static let debounce: Duration = .milliseconds(300)
    /// Messages older than the target that `chat_messages_around` returns (its default).
    static let aroundBefore = 25

    /// The trimmed query, or nil when it is too short to search.
    static func query(_ text: String) -> String? {
        let q = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return q.count >= minLength ? q : nil
    }

    static func hits(_ rows: [SearchHitRow]) -> [SearchHit] { rows.compactMap(\.hit) }
}

enum SearchHighlight {
    private static let special: [Character: String] = ["œ": "oe", "æ": "ae", "ß": "ss", "ø": "o", "ł": "l", "đ": "d", "ı": "i", "ð": "d", "þ": "th"]

    /// Lower-case, accent-free form of one character, like the server's lower(unaccent()).
    static func fold(_ ch: Character) -> String {
        let lower = String(ch).lowercased()
        if lower.count == 1, let first = lower.first, let s = special[first] { return s }
        return lower.decomposedStringWithCanonicalMapping.unicodeScalars
            .filter { ![.nonspacingMark, .spacingMark, .enclosingMark].contains($0.properties.generalCategory) }
            .reduce(into: "") { $0.unicodeScalars.append($1) }
    }

    /// Ranges of `text` to highlight: every occurrence of every word, compared folded; overlapping
    /// or touching ranges merged. Works on Characters, so emoji and combined letters stay whole.
    static func ranges(in text: String, words: [String]) -> [Range<String.Index>] {
        guard !text.isEmpty else { return [] }
        var folded: [Character] = []
        var source: [Range<String.Index>] = []
        var i = text.startIndex
        while i < text.endIndex {
            let next = text.index(after: i)
            for c in fold(text[i]) { folded.append(c); source.append(i..<next) }
            i = next
        }
        var raw: [Range<String.Index>] = []
        for w in words {
            let word = Array(w.map(fold).joined())
            guard !word.isEmpty, word.count <= folded.count else { continue }
            var at = 0
            while at + word.count <= folded.count {
                if Array(folded[at..<at + word.count]) == word {
                    raw.append(source[at].lowerBound..<source[at + word.count - 1].upperBound)
                    at += word.count
                } else {
                    at += 1
                }
            }
        }
        raw.sort { $0.lowerBound < $1.lowerBound }
        var out: [Range<String.Index>] = []
        for r in raw {
            if let last = out.last, r.lowerBound <= last.upperBound {
                out[out.count - 1] = last.lowerBound..<max(last.upperBound, r.upperBound)
            } else {
                out.append(r)
            }
        }
        return out
    }

    /// The text with matches bold in the feature colour (an AttributedString: plain text, no markup).
    static func attributed(_ text: String, words: [String], hue: Hue) -> AttributedString {
        var result = AttributedString(text)
        for r in ranges(in: text, words: words) {
            guard let lower = AttributedString.Index(r.lowerBound, within: result),
                  let upper = AttributedString.Index(r.upperBound, within: result) else { continue }
            result[lower..<upper].inlinePresentationIntent = .stronglyEmphasized
            result[lower..<upper].foregroundColor = hue.text
            result[lower..<upper].backgroundColor = hue.fill.opacity(0.16)
        }
        return result
    }
}

enum ChatJump {
    /// What `chat_messages_around` (in chronological order) means for the chat: whether the target is
    /// there, and whether the start was reached (fewer than `aroundBefore` messages older than it).
    static func window(_ rows: [ChatMessage], target: UUID) -> (found: Bool, reachedStart: Bool) {
        guard let at = rows.firstIndex(where: { $0.id == target }) else { return (false, false) }
        return (true, at < SearchRules.aroundBefore)
    }

    /// Merges the window into the loaded messages by id, in chronological order (the window is
    /// contiguous with the newest page, so the result has no gaps).
    static func merge(_ messages: [ChatMessage], window: [ChatMessage]) -> [ChatMessage] {
        var result = messages
        for m in window { result = ChatTimeline.upsert(result, m) }
        return result
    }
}

extension BoolaaAPI {
    /// `search_bubble`: best first; RLS decides what the caller sees.
    func searchBubble(bubbleID: UUID, query: String, limit: Int = SearchRules.limit) async throws -> [SearchHit] {
        struct Params: Encodable { let p_bubble_id: UUID; let p_query: String; let p_limit: Int }
        let rows: [SearchHitRow] = try await client
            .rpc("search_bubble", params: Params(p_bubble_id: bubbleID, p_query: query, p_limit: limit))
            .execute().value
        return SearchRules.hits(rows)
    }

    /// `chat_messages_around`: the message, up to 25 older ones and everything newer, chronological.
    func chatAround(bubbleID: UUID, messageID: UUID) async throws -> [ChatMessage] {
        struct Params: Encodable { let p_bubble_id: UUID; let p_message_id: UUID }
        let rows: [ChatMessage] = try await client
            .rpc("chat_messages_around", params: Params(p_bubble_id: bubbleID, p_message_id: messageID))
            .select(Self.chatColumns)
            .execute().value
        return rows.reversed()
    }
}
