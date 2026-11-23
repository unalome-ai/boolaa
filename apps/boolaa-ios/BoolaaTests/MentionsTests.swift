import Foundation
import Supabase
import Testing
@testable import Boolaa

/// Chat @mentions (docs/boolaa-spec.md, "Mentions"): offsets, rendering, the composer's trigger, filter and token
/// editing, the outbox and the push / prefs contract.
private let me = UUID()
private let ana = UUID()
private let dan = UUID()
private let gone = UUID()

private func lproj(_ lang: String) throws -> Bundle {
    let path = try #require(Bundle.main.path(forResource: lang, ofType: "lproj"))
    return try #require(Bundle(path: path))
}

private func candidate(_ name: String, _ id: UUID = UUID()) -> MentionCandidate {
    MentionCandidate(userID: id, name: name, avatar: nil)
}

@Suite("Mentions: code-point offsets")
struct MentionOffsetTests {
    @Test func pizzaVector() throws {
        let text = "🍕 @Ana Pop, hi"
        let r = try #require(text.range(of: "@Ana Pop"))
        let span = Mentions.span(utf16: NSRange(r, in: text), in: text, userID: ana)
        #expect(span == MentionSpan(start: 2, length: 8, userID: ana))
        #expect(NSRange(r, in: text) == NSRange(location: 3, length: 8), "UTF-16: 3 and 8")
        let back = try #require(Mentions.range(of: span, in: text))
        #expect(text[back] == "@Ana Pop")
        #expect(Mentions.utf16Range(of: span, in: text) == NSRange(location: 3, length: 8))
    }

    @Test func precomposedAndDecomposedAccents() throws {
        let composed = "@Zo\u{00EB} hi"
        let s1 = Mentions.span(utf16: (composed as NSString).range(of: "@Zo\u{00EB}"), in: composed, userID: ana)
        #expect(s1.start == 0 && s1.length == 4)
        let decomposed = "@Zoe\u{0308} hi"
        let s2 = Mentions.span(utf16: (decomposed as NSString).range(of: "@Zoe\u{0308}", options: .literal), in: decomposed, userID: ana)
        #expect(s2.start == 0 && s2.length == 5, "never normalised")
        #expect(decomposed[try #require(Mentions.range(of: s2, in: decomposed))].unicodeScalars.count == 5)
    }

    @Test func familyEmojiVector() throws {
        let text = "👨‍👩‍👧 @Bo"
        let span = Mentions.span(utf16: (text as NSString).range(of: "@Bo"), in: text, userID: ana)
        #expect(span == MentionSpan(start: 6, length: 3, userID: ana))
        #expect(text[try #require(Mentions.range(of: span, in: text))] == "@Bo")
    }

    @Test func spansThatDontFitAreIgnored() {
        let text = "hi @Ana"
        #expect(Mentions.range(of: MentionSpan(start: 3, length: 10, userID: ana), in: text) == nil)
        #expect(Mentions.range(of: MentionSpan(start: -1, length: 2, userID: ana), in: text) == nil)
        #expect(Mentions.valid([MentionSpan(start: 0, length: 3, userID: ana)], in: text).isEmpty, "must start with @")
        // Overlaps: the later one is dropped.
        let valid = Mentions.valid([MentionSpan(start: 3, length: 4, userID: ana), MentionSpan(start: 3, length: 2, userID: dan)], in: text)
        #expect(valid.count == 1)
    }

    @Test func decodesTheServerShape() throws {
        let json = #"{"id":"\#(UUID())","bubble_id":"\#(UUID())","sender_id":"\#(UUID())","content":"hi @Ana","created_at":"2026-11-24T10:00:00.123456+00:00","mentions":[{"length":4,"start":3,"user_id":"\#(ana.uuidString.lowercased())"}]}"#
        let message = try BoolaaJSON.decoder.decode(ChatMessage.self, from: Data(json.utf8))
        #expect(message.mentions == [MentionSpan(start: 3, length: 4, userID: ana)])
        let old = #"{"id":"\#(UUID())","bubble_id":"\#(UUID())","sender_id":"\#(UUID())","content":"hi","created_at":"2026-11-24T10:00:00Z"}"#
        #expect(try BoolaaJSON.decoder.decode(ChatMessage.self, from: Data(old.utf8)).mentions == nil, "cached rows from before")
    }

    @Test func insertSendsMentionsOnlyWhenThereAreSome() throws {
        let bubble = UUID()
        let with = try JSONSerialization.jsonObject(with: JSONEncoder().encode(
            NewChatMessage(bubbleId: bubble, senderId: me, content: "@Ana hi", mentions: [MentionSpan(start: 0, length: 4, userID: ana)]))) as? [String: Any]
        let spans = with?["mentions"] as? [[String: Any]]
        #expect(spans?.first?["start"] as? Int == 0 && spans?.first?["length"] as? Int == 4)
        #expect((spans?.first?["user_id"] as? String)?.lowercased() == ana.uuidString.lowercased())
        let without = try JSONSerialization.jsonObject(with: JSONEncoder().encode(
            NewChatMessage(bubbleId: bubble, senderId: me, content: "hi"))) as? [String: Any]
        #expect(without?["mentions"] == nil)
    }
}

@Suite("Mentions: rendering")
struct MentionRenderingTests {
    let text = "@Ana Pop and @Me Old and @Gone Person"
    var spans: [MentionSpan] { [
        MentionSpan(start: 0, length: 8, userID: ana),
        MentionSpan(start: 13, length: 7, userID: me),
        MentionSpan(start: 25, length: 12, userID: gone),
    ] }

    @Test func eachCase() {
        let segments = Mentions.segments(text, spans: spans, me: me, meName: "Me New", candidates: [ana: "Ana Popescu"])
        #expect(segments == [
            .mention("@Ana Popescu", .member), // current name
            .text(" and "),
            .mention("@Me New", .me), // the reader's current name
            .text(" and @Gone Person"), // left / deleted / blocked: as written, plain
        ])
        #expect(Mentions.displayed(segments) == "@Ana Popescu and @Me New and @Gone Person")
    }

    @Test func blockedOrDeletedIsPlainText() {
        // Not a candidate (blocked either way, deleted account, left): the span's own text, no highlight.
        let segments = Mentions.segments("hey @Ana Pop", spans: [MentionSpan(start: 4, length: 8, userID: ana)], me: me, meName: "Me", candidates: [:])
        #expect(segments == [.text("hey @Ana Pop")])
    }

    @Test func badSpansNeverCrash() {
        let segments = Mentions.segments("hi", spans: [MentionSpan(start: 5, length: 3, userID: ana)], me: me, meName: nil, candidates: [ana: "Ana"])
        #expect(segments == [.text("hi")])
    }

    @Test func linksStayOutsideMentions() {
        let content = "@Ana see https://x.ro"
        let segments = Mentions.segments(content, spans: [MentionSpan(start: 0, length: 4, userID: ana)], me: me, meName: nil, candidates: [ana: "Ana"])
        let attributed = ChatBubbleStyle.text(segments, isMine: false, bubbleHue: .grape, senderHue: .coral)
        let links = attributed.runs.compactMap(\.link)
        #expect(links == [URL(string: "https://x.ro")!])
        #expect(String(attributed.characters) == content)
    }

    @Test func mentionsMeAndAccessibility() {
        let message = ChatMessage(id: UUID(), bubbleId: UUID(), senderId: ana, content: "@Me hi", createdAt: .now,
                                  sender: UserProfile(id: ana, name: "Ana"), mentions: [MentionSpan(start: 0, length: 3, userID: me)])
        let row = MessageRow(message: message, isMine: false, me: me, meName: "Me Now", mentionNames: [ana: "Ana"], showAuthor: true)
        #expect(row.mentionsMe)
        #expect(row.accessibilityText.hasPrefix("Ana mentioned you, Ana, @Me Now hi"), "\(row.accessibilityText)")
        let mine = MessageRow(message: message, isMine: true, me: ana, meName: "Ana", showAuthor: true)
        #expect(!mine.mentionsMe)
    }

    @Test func unknownMentionedUsersTriggerACandidateReload() {
        #expect(Mentions.unknownUsers([MentionSpan(start: 0, length: 2, userID: dan)], me: me, known: [ana]) == [dan])
        #expect(Mentions.unknownUsers([MentionSpan(start: 0, length: 2, userID: me)], me: me, known: []).isEmpty)
    }
}

@Suite("Mentions: composer trigger and list")
struct MentionTriggerTests {
    @Test(arguments: [
        ("@", 1, ""), ("hi @an", 6, "an"), ("(@an", 4, "an"), ("«@an", 4, "an"), ("“@an", 4, "an"),
        ("@ana p", 6, "ana p"), ("hi\n@x", 5, "x"),
    ])
    func opens(text: String, caret: Int, query: String) {
        #expect(Mentions.activeQuery(in: text, caret: caret)?.query == query)
    }

    @Test(arguments: [
        ("ana@x.ro", 8), ("a1@b", 4), ("@ana  p", 7), ("@ab\ncd", 6), ("hi", 2),
        ("@" + String(repeating: "a", count: 31), 32),
    ])
    func staysClosed(text: String, caret: Int) {
        #expect(Mentions.activeQuery(in: text, caret: caret) == nil)
    }

    @Test func notInsideAToken() {
        let tokens = [MentionToken(range: NSRange(location: 0, length: 4), userID: ana)]
        #expect(Mentions.activeQuery(in: "@Ana ", caret: 4, tokens: tokens) == nil)
        #expect(Mentions.activeQuery(in: "@Ana @d", caret: 7, tokens: tokens)?.query == "d")
    }

    @Test func filterFoldsAndOrders() {
        let list = [candidate("Ștefan Ilie"), candidate("Ana Pop"), candidate("Dan Popa"), candidate("Popescu Ion"), candidate("Zoë")]
        #expect(Mentions.filter(list, query: "pop").map(\.name) == ["Popescu Ion", "Ana Pop", "Dan Popa"], "starts first, then word starts")
        #expect(Mentions.filter(list, query: "stefan").map(\.name) == ["Ștefan Ilie"])
        #expect(Mentions.filter(list, query: "ZOE").map(\.name) == ["Zoë"])
        #expect(Mentions.filter(list, query: "ana p").map(\.name) == ["Ana Pop"])
        #expect(Mentions.filter(list, query: "").count == 5, "a bare @ lists everyone")
        #expect(Mentions.filter(list, query: "").map(\.name).first == "Ana Pop")
        #expect(Mentions.filter(list, query: "op").isEmpty, "not in the middle of a word")
    }

    @Test func listStates() {
        let list = [candidate("Ana Pop")]
        #expect(Mentions.listState(query: nil, candidates: list, tokenCount: 0) == .hidden)
        #expect(Mentions.listState(query: "x", candidates: [], tokenCount: 0) == .hidden, "alone in the bubble")
        #expect(Mentions.listState(query: "x", candidates: list, tokenCount: 0) == .noMatch)
        #expect(Mentions.listState(query: "x y", candidates: list, tokenCount: 0) == .hidden, "a space and nothing matches")
        #expect(Mentions.listState(query: "", candidates: list, tokenCount: 10) == .limit)
        #expect(Mentions.listState(query: "an", candidates: list, tokenCount: 9) == .rows(list))
    }
}

@Suite("Mentions: token editing")
struct MentionDraftTests {
    private func draft(_ text: String, token: NSRange, caret: Int? = nil) -> MentionDraft {
        var d = MentionDraft(text: text, tokens: [MentionToken(range: token, userID: ana)])
        if let caret { d.selection = NSRange(location: caret, length: 0) }
        return d
    }

    @Test func pickInsertsTokenAndSpace() {
        var d = MentionDraft(text: "hi @an")
        d.insert(candidate("Ana Pop", ana), at: 3)
        #expect(d.text == "hi @Ana Pop ")
        #expect(d.tokens == [MentionToken(range: NSRange(location: 3, length: 8), userID: ana)])
        #expect(d.selection.location == 12)
        // No extra space when one follows already.
        var e = MentionDraft(text: "@a there")
        e.selection = NSRange(location: 2, length: 0)
        e.insert(candidate("Ana", ana), at: 0)
        #expect(e.text == "@Ana there")
    }

    @Test func backspaceAfterATokenRemovesItWhole() {
        var d = draft("hi @Ana Pop", token: NSRange(location: 3, length: 8))
        let applied = d.replace(NSRange(location: 10, length: 1), with: "")
        #expect(applied == NSRange(location: 3, length: 8))
        #expect(d.text == "hi " && d.tokens.isEmpty && d.selection.location == 3)
    }

    @Test func deleteBeforeATokenRemovesItWhole() {
        var d = draft("@Ana x", token: NSRange(location: 0, length: 4))
        d.replace(NSRange(location: 0, length: 1), with: "")
        #expect(d.text == " x" && d.tokens.isEmpty)
    }

    @Test func replacingASelectionThatTouchesATokenTakesItAll() {
        var d = draft("ab @Ana cd", token: NSRange(location: 3, length: 4))
        d.replace(NSRange(location: 1, length: 4), with: "Z") // "b @A"
        #expect(d.text == "aZ cd" && d.tokens.isEmpty)
    }

    @Test func typingInsideMakesItPlainText() {
        var d = draft("@Ana Pop", token: NSRange(location: 0, length: 8))
        d.replace(NSRange(location: 4, length: 0), with: "x")
        #expect(d.text == "@Anax Pop" && d.tokens.isEmpty)
    }

    @Test func typingAtTheEdgesKeepsTheToken() {
        var d = draft("@Ana", token: NSRange(location: 0, length: 4))
        d.replace(NSRange(location: 4, length: 0), with: " hi")
        #expect(d.tokens.first?.range == NSRange(location: 0, length: 4))
        d.replace(NSRange(location: 0, length: 0), with: "🍕 ")
        #expect(d.text == "🍕 @Ana hi")
        #expect(d.tokens.first?.range == NSRange(location: 3, length: 4), "edits before shift it")
    }

    @Test func pasteNeverCreatesMentions() {
        var d = MentionDraft(text: "")
        d.replace(NSRange(location: 0, length: 0), with: "@Ana hi")
        #expect(d.tokens.isEmpty)
    }

    @Test func outgoingTrimsAndShifts() {
        let d = MentionDraft(text: "  \n🍕 @Ana Pop, hi  ", tokens: [MentionToken(range: NSRange(location: 6, length: 8), userID: ana)])
        let out = d.outgoing()
        #expect(out.text == "🍕 @Ana Pop, hi")
        #expect(out.mentions == [MentionSpan(start: 2, length: 8, userID: ana)])
        // A token that fell outside the sent text is dropped.
        let cut = MentionDraft(text: "hi @Ana", tokens: [MentionToken(range: NSRange(location: 3, length: 4), userID: ana)]).outgoing(limit: 3)
        #expect(cut.text == "hi ")
        #expect(cut.mentions.isEmpty)
    }

    @MainActor
    @Test func composerModelFlow() {
        let model = MentionComposerModel()
        model.candidates = [candidate("Ana Pop", ana), candidate("Dan", dan)]
        model.focused = true
        _ = model.shouldApply(NSRange(location: 0, length: 0), replacement: "@")
        #expect(model.rows.map(\.name) == ["Ana Pop", "Dan"])
        model.move(by: 1)
        #expect(model.activeIndex == 1)
        model.move(by: 1)
        #expect(model.activeIndex == 0, "wraps")
        model.pickActive()
        #expect(model.text == "@Ana Pop " && !model.isListOpen)
        // Escape closes the list for that "@" only.
        _ = model.shouldApply(NSRange(location: 9, length: 0), replacement: "@d")
        #expect(model.isListOpen)
        model.dismissList()
        #expect(!model.isListOpen)
        _ = model.shouldApply(NSRange(location: 11, length: 0), replacement: "a")
        #expect(!model.isListOpen, "stays closed for the same @")
        // Composition in progress: no list.
        _ = model.shouldApply(NSRange(location: 12, length: 0), replacement: " @")
        #expect(model.isListOpen)
        model.composing = true
        #expect(!model.isListOpen)
    }

    @MainActor
    @Test func askDraftBecomesATokenOnlyForACandidate() {
        let owner = UserProfile(id: ana, name: "Ana Pop")
        let model = MentionComposerModel()
        model.append("@Ana Pop, is “Lamp” still available?", mention: owner)
        #expect(model.draft.tokens.isEmpty, "waits for the candidates")
        model.candidates = [candidate("Ana Pop", ana)]
        #expect(model.draft.tokens == [MentionToken(range: NSRange(location: 0, length: 8), userID: ana)])
        let other = MentionComposerModel()
        other.candidates = [candidate("Dan", dan)]
        other.append("@Ana Pop, is “Lamp” still available?", mention: owner)
        #expect(other.draft.tokens.isEmpty, "not a member: plain text")
    }

    @MainActor
    @Test func outboxKeepsTheSpans() async throws {
        let dir = FileManager.default.temporaryDirectory.appending(path: "mentions-outbox-\(UUID())")
        defer { try? FileManager.default.removeItem(at: dir) }
        let box = ChatOutbox(directory: dir)
        box.activate(user: me)
        var delivered: [MentionSpan]?
        box.deliver = { message in delivered = message.mentions; return .failed }
        let spans = [MentionSpan(start: 0, length: 4, userID: ana)]
        await box.enqueue(bubbleID: UUID(), senderID: me, text: "@Ana hi", photo: nil, mentions: spans, online: true)
        #expect(delivered == spans)
        // Persisted with the text and retried unchanged after a restart.
        let restarted = ChatOutbox(directory: dir)
        restarted.activate(user: me)
        #expect(restarted.items.first?.mentions == spans)
    }
}

@Suite("Mentions: errors, push and strings")
struct MentionContractTests {
    @Test func errors() {
        #expect(UserFacingError.classify(message: "too many mentions", code: "22023") == .tooManyMentions)
        #expect(UserFacingError.classify(message: "invalid mentions", code: "22023") == nil, "generic: a client bug")
    }

    @Test func pushRoutesToTheMessage() throws {
        let bubble = UUID(), message = UUID()
        let payload = try #require(PushPayload(userInfo: ["type": "chat_mention", "bubble_id": bubble.uuidString, "target_id": message.uuidString]))
        #expect(payload.kind == .chatMention && payload.kind.category == "CHAT_MENTION")
        let resolved = PushRoute(payload: payload).resolve(joined: [bubble])
        #expect(resolved.destination == .chat && resolved.chatJump == message && resolved.highlight == nil)
        #expect(PushRoute(payload: PushPayload(kind: .chat, bubbleID: bubble, targetID: message)).resolve(joined: [bubble]).chatJump == nil)
        // No banner for the chat on screen, like chat pushes.
        #expect(PushRules.presentation(for: payload, visibleChat: bubble).isEmpty)
        #expect(PushRules.presentation(for: payload, visibleChat: UUID()).contains(.banner))
    }

    @Test func prefs() throws {
        #expect(NotificationPrefs(userId: me).mentions, "on by default")
        let old = #"{"user_id":"\#(me.uuidString)","chat":false}"#
        let prefs = try BoolaaJSON.decoder.decode(NotificationPrefs.self, from: Data(old.utf8))
        #expect(prefs.mentions && !prefs.chat)
        #expect(NotificationPrefs.toggles.count == 10)
        #expect(NotificationPrefs.toggles[1].id == "mentions", "right after Chat messages")
    }

    @Test(arguments: [
        ("en", "Mention Ana", "Ana mentioned you", "3 members", "1 member", "No members match", "Mentions"),
        ("ro", "Menționează: Ana", "Ana te-a menționat", "3 membri", "1 membru", "Niciun membru nu se potrivește", "Mențiuni"),
        ("fr", "Mentionner Ana", "Ana te mentionne", "3 membres", "1 membre", "Aucun membre ne correspond", "Mentions"),
        ("es", "Mencionar a Ana", "Ana te ha mencionado", "3 miembros", "1 miembro", "Ningún miembro coincide", "Menciones"),
        ("it", "Menziona Ana", "Ana ti ha menzionato", "3 membri", "1 membro", "Nessun membro corrisponde", "Menzioni"),
    ])
    func strings(lang: String, row: String, mentioned: String, three: String, one: String, noMatch: String, setting: String) throws {
        let bundle = try lproj(lang), locale = Locale(identifier: lang)
        #expect(String(localized: "Mention \("Ana")", bundle: bundle, locale: locale) == row)
        #expect(String(localized: "\("Ana") mentioned you", bundle: bundle, locale: locale) == mentioned)
        #expect(String(localized: "\(3) members", bundle: bundle, locale: locale) == three)
        #expect(String(localized: "\(1) members", bundle: bundle, locale: locale) == one)
        if lang == "ro" { #expect(String(localized: "\(20) members", bundle: bundle, locale: locale) == "20 de membri") }
        #expect(bundle.localizedString(forKey: "No members match", value: nil, table: nil) == noMatch)
        #expect(bundle.localizedString(forKey: "Mentions", value: nil, table: nil) == setting)
        #expect(bundle.localizedString(forKey: "Members to mention", value: nil, table: nil) != (lang == "en" ? "" : "Members to mention"))
        let limit = bundle.localizedString(forKey: "You can mention up to 10 people in one message.", value: nil, table: nil)
        #expect(limit.contains("10") && (lang == "en" || !limit.hasPrefix("You")))
        #expect(UserFacingError.tooManyMentions.message.key == "You can mention up to 10 people in one message.")
    }
}
