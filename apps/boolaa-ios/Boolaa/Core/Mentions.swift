import Foundation
import Supabase

/// Chat @mentions (docs/boolaa-spec.md, "Mentions"): the stored spans, offset conversion between Unicode code
/// points (the server's unit) and native indices, rendering segments, the composer's trigger / query / filter
/// rules and its token editing. Pure logic, unit-tested in MentionsTests.

/// One entry of `chat_messages.mentions`: `content[start, start + length)` in Unicode code points is "@Name".
struct MentionSpan: Codable, Hashable, Sendable {
    let start: Int
    let length: Int
    let userID: UUID

    enum CodingKeys: String, CodingKey {
        case start, length
        case userID = "user_id"
    }
}

/// A row of `mention_candidates(p_bubble_id)`: approved members except the caller, no block either way.
struct MentionCandidate: Codable, Hashable, Identifiable, Sendable {
    let userID: UUID
    var name: String
    var avatar: String?

    var id: UUID { userID }
    var displayName: String { UserProfile(id: userID, name: name, avatar: avatar).displayName }
    var profile: UserProfile { UserProfile(id: userID, name: name, avatar: avatar) }

    enum CodingKeys: String, CodingKey {
        case name, avatar
        case userID = "user_id"
    }
}

enum Mentions {
    /// More spans than this are refused by the server ("too many mentions").
    static let maxPerMessage = 10
    /// The longest query after "@", in code points.
    static let maxQueryLength = 30
    /// Rows visible in the strip before it scrolls.
    static let visibleRows = 5
    /// Characters after which "@" opens the list (besides whitespace and the start of the text).
    static let openers: Set<Character> = ["(", "[", "\"", "'", "“", "„", "«", "‘"]

    // MARK: Offsets

    /// The native range of a span, or nil when it doesn't fit the text (never crash on a bad span).
    static func range(of span: MentionSpan, in text: String) -> Range<String.Index>? {
        guard span.start >= 0, span.length > 0 else { return nil }
        let scalars = text.unicodeScalars
        guard let lower = scalars.index(scalars.startIndex, offsetBy: span.start, limitedBy: scalars.endIndex),
              let upper = scalars.index(lower, offsetBy: span.length, limitedBy: scalars.endIndex),
              lower < upper else { return nil }
        return lower..<upper
    }

    /// The span's range in UTF-16 units (what UIKit text views use).
    static func utf16Range(of span: MentionSpan, in text: String) -> NSRange? {
        guard let r = range(of: span, in: text) else { return nil }
        return NSRange(r, in: text)
    }

    /// Code-point offset of a UTF-16 offset (clamped to the text).
    static func codePoints(beforeUTF16 offset: Int, in text: String) -> Int {
        let utf16 = text.utf16
        let end = utf16.index(utf16.startIndex, offsetBy: max(0, min(offset, utf16.count)))
        return text.unicodeScalars[text.unicodeScalars.startIndex..<end].count
    }

    /// The span of a UTF-16 range of `text`.
    static func span(utf16 range: NSRange, in text: String, userID: UUID) -> MentionSpan {
        let start = codePoints(beforeUTF16: range.location, in: text)
        let end = codePoints(beforeUTF16: range.location + range.length, in: text)
        return MentionSpan(start: start, length: end - start, userID: userID)
    }

    /// Spans of a server row that fit its text, sorted by start, without overlaps.
    static func valid(_ spans: [MentionSpan], in text: String) -> [(span: MentionSpan, range: Range<String.Index>)] {
        var out: [(MentionSpan, Range<String.Index>)] = []
        for span in spans.sorted(by: { $0.start < $1.start }) {
            guard let r = range(of: span, in: text), text.unicodeScalars[r.lowerBound] == "@" else { continue }
            if let last = out.last, last.1.upperBound > r.lowerBound { continue }
            out.append((span, r))
        }
        return out
    }

    // MARK: Rendering

    enum Style: Equatable, Sendable {
        /// The reader: "@" + their current name, filled pill.
        case me
        /// A current member: "@" + their current name, highlighted.
        case member
    }

    enum Segment: Equatable, Sendable {
        case text(String)
        case mention(String, Style)
    }

    /// The message split into plain text and mentions. Spans of people who are neither the reader nor a candidate
    /// (left, deleted, blocked, unknown) stay plain text as written.
    static func segments(_ text: String, spans: [MentionSpan], me: UUID?, meName: String?,
                         candidates: [UUID: String]) -> [Segment] {
        var out: [Segment] = []
        var cursor = text.startIndex
        func appendText(_ s: Substring) {
            guard !s.isEmpty else { return }
            if case .text(let prev) = out.last { out[out.count - 1] = .text(prev + s) } else { out.append(.text(String(s))) }
        }
        for (span, r) in valid(spans, in: text) {
            appendText(text[cursor..<r.lowerBound])
            if let me, span.userID == me {
                out.append(.mention("@" + (meName.flatMap { $0.isEmpty ? nil : $0 } ?? String(text[r].dropFirst())), .me))
            } else if let name = candidates[span.userID] {
                out.append(.mention("@" + name, .member))
            } else {
                appendText(text[r])
            }
            cursor = r.upperBound
        }
        appendText(text[cursor...])
        return out
    }

    /// The text as displayed (current names), for VoiceOver.
    static func displayed(_ segments: [Segment]) -> String {
        segments.map { switch $0 { case .text(let s): s; case .mention(let s, _): s } }.joined()
    }

    static func mentions(_ spans: [MentionSpan], user: UUID?) -> Bool {
        guard let user else { return false }
        return spans.contains { $0.userID == user }
    }

    /// Users a message mentions who are neither the reader nor a known candidate (someone joined meanwhile).
    static func unknownUsers(_ spans: [MentionSpan], me: UUID?, known: Set<UUID>) -> Set<UUID> {
        Set(spans.map(\.userID)).subtracting(known).subtracting(me.map { [$0] } ?? [])
    }

    // MARK: Composer: trigger, query, filter

    /// The "@query" being typed at `caret` (UTF-16): the location of its "@" and the query after it, or nil.
    /// `tokens` are the draft's mention tokens: an "@" inside one never opens the list.
    static func activeQuery(in text: String, caret: Int, tokens: [MentionToken] = []) -> (at: Int, query: String)? {
        let ns = text as NSString
        guard caret >= 0, caret <= ns.length else { return nil }
        var i = caret - 1
        var scanned = 0
        while i >= 0 {
            let unit = ns.character(at: i)
            if unit == 0x0A || unit == 0x0D || unit == 0x2028 || unit == 0x2029 { return nil }
            if unit == 0x40 { // "@"
                if tokens.contains(where: { $0.range.location <= i && i < NSMaxRange($0.range) }) { return nil }
                let before: Character? = i == 0 ? nil : Character(ns.substring(with: ns.rangeOfComposedCharacterSequence(at: i - 1)))
                guard before == nil || before!.isWhitespace || openers.contains(before!) else { return nil }
                let query = ns.substring(with: NSRange(location: i + 1, length: caret - i - 1))
                guard query.unicodeScalars.count <= maxQueryLength, !query.contains("  ") else { return nil }
                return (i, query)
            }
            scanned += 1
            if scanned > maxQueryLength * 2 + 2 { return nil } // UTF-16 units: surrogate pairs count twice
            i -= 1
        }
        return nil
    }

    /// Folded like the search highlighter (NFD, marks dropped, lower-case, œ/æ/ß/ø/ł/đ/ı expanded).
    static func fold(_ s: String) -> String { s.map(SearchHighlight.fold).joined() }

    /// Candidates for `query`: names starting with it first, then names with a word starting with it, each in
    /// locale order. A bare "@" lists everyone.
    static func filter(_ candidates: [MentionCandidate], query: String) -> [MentionCandidate] {
        let q = fold(query)
        var starts: [MentionCandidate] = []
        var words: [MentionCandidate] = []
        for c in candidates {
            let name = fold(c.displayName)
            if name.hasPrefix(q) {
                starts.append(c)
            } else if wordStarts(in: name).contains(where: { name[$0...].hasPrefix(q) }) {
                words.append(c)
            }
        }
        let order: (MentionCandidate, MentionCandidate) -> Bool = {
            $0.displayName.localizedStandardCompare($1.displayName) == .orderedAscending
        }
        return starts.sorted(by: order) + words.sorted(by: order)
    }

    private static func wordStarts(in s: String) -> [String.Index] {
        var out: [String.Index] = []
        var previous: Character?
        for i in s.indices {
            let c = s[i]
            if let p = previous, !(p.isLetter || p.isNumber), c.isLetter || c.isNumber { out.append(i) }
            previous = c
        }
        return out
    }

    /// What the strip shows for the current query.
    enum ListState: Equatable, Sendable {
        case hidden
        case limit
        case noMatch
        case rows([MentionCandidate])
    }

    static func listState(query: String?, candidates: [MentionCandidate], tokenCount: Int) -> ListState {
        guard let query, !candidates.isEmpty else { return .hidden }
        if tokenCount >= maxPerMessage { return .limit }
        let rows = filter(candidates, query: query)
        if rows.isEmpty { return query.contains(" ") ? .hidden : .noMatch }
        return .rows(rows)
    }
}

/// A mention in the composer: its UTF-16 range in the draft and who it is.
struct MentionToken: Hashable, Sendable {
    var range: NSRange
    let userID: UUID
}

/// The composer's text plus its mention tokens and caret, edited as the spec says: a token is one unit.
struct MentionDraft: Equatable, Sendable {
    var text = ""
    var tokens: [MentionToken] = []
    /// Caret / selection in UTF-16 units.
    var selection = NSRange(location: 0, length: 0)

    init(text: String = "", tokens: [MentionToken] = []) {
        self.text = text
        self.tokens = tokens.sorted { $0.range.location < $1.range.location }
        selection = NSRange(location: (text as NSString).length, length: 0)
    }

    var isEmpty: Bool { text.isEmpty }

    /// The edit a text view asks for, applied with the token rules. Returns the range actually replaced (wider than
    /// `range` when it swallowed whole tokens) so the view can tell whether it must apply the edit itself.
    @discardableResult
    mutating func replace(_ range: NSRange, with replacement: String) -> NSRange {
        let ns = text as NSString
        var target = NSRange(location: max(0, min(range.location, ns.length)), length: 0)
        target.length = max(0, min(range.length, ns.length - target.location))
        var kept: [MentionToken] = []
        if target.length > 0 {
            // A deletion or replacement touching part of a token takes the whole token with it.
            var lower = target.location, upper = NSMaxRange(target)
            for t in tokens where t.range.location < upper && NSMaxRange(t.range) > lower {
                lower = min(lower, t.range.location)
                upper = max(upper, NSMaxRange(t.range))
            }
            target = NSRange(location: lower, length: upper - lower)
            kept = tokens.filter { NSMaxRange($0.range) <= target.location || $0.range.location >= NSMaxRange(target) }
        } else {
            // Typing or pasting strictly inside a token turns it into plain text.
            kept = tokens.filter { !(replacement.isEmpty == false && $0.range.location < target.location && target.location < NSMaxRange($0.range)) }
        }
        let delta = (replacement as NSString).length - target.length
        tokens = kept.map { t in
            var t = t
            if t.range.location >= NSMaxRange(target) { t.range.location += delta }
            return t
        }
        text = ns.replacingCharacters(in: target, with: replacement)
        selection = NSRange(location: target.location + (replacement as NSString).length, length: 0)
        return target
    }

    /// Picks `candidate` for the "@query" starting at `at` (UTF-16) and ending at the caret.
    mutating func insert(_ candidate: MentionCandidate, at: Int) {
        let ns = text as NSString
        let end = max(at, min(selection.location, ns.length))
        let token = "@" + candidate.displayName
        let nextIsSpace = end < ns.length && Character(ns.substring(with: ns.rangeOfComposedCharacterSequence(at: end))).isWhitespace
        replace(NSRange(location: at, length: end - at), with: token + (nextIsSpace ? "" : " "))
        let length = (token as NSString).length
        tokens.append(MentionToken(range: NSRange(location: at, length: length), userID: candidate.userID))
        tokens.sort { $0.range.location < $1.range.location }
        selection = NSRange(location: at + length + 1, length: 0)
    }

    /// The text to send and its spans: trimmed, spans shifted by the trimmed prefix, spans outside dropped.
    func outgoing(limit: Int = 4000) -> (text: String, mentions: [MentionSpan]) {
        let ns = text as NSString
        var lower = 0, upper = ns.length
        let ws = CharacterSet.whitespacesAndNewlines
        while lower < upper, let s = UnicodeScalar(ns.character(at: lower)), ws.contains(s) { lower += 1 }
        while upper > lower, let s = UnicodeScalar(ns.character(at: upper - 1)), ws.contains(s) { upper -= 1 }
        var sent = ns.substring(with: NSRange(location: lower, length: upper - lower))
        if sent.count > limit { sent = String(sent.prefix(limit)) }
        let sentLength = (sent as NSString).length
        let spans = tokens.compactMap { t -> MentionSpan? in
            let shifted = NSRange(location: t.range.location - lower, length: t.range.length)
            guard shifted.location >= 0, NSMaxRange(shifted) <= sentLength else { return nil }
            return Mentions.span(utf16: shifted, in: sent, userID: t.userID)
        }
        return (sent, spans)
    }
}

extension BoolaaAPI {
    /// `mention_candidates`: who the composer offers and whose mentions are highlighted.
    func mentionCandidates(bubbleID: UUID) async throws -> [MentionCandidate] {
        struct Params: Encodable { let p_bubble_id: UUID }
        return try await client.rpc("mention_candidates", params: Params(p_bubble_id: bubbleID)).execute().value
    }
}
