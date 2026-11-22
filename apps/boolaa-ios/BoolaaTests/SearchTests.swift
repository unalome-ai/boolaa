import Foundation
import Supabase
import Testing
@testable import Boolaa

/// Search inside a bubble (docs/boolaa-spec.md, "Search"): folding, highlight ranges, row decoding and
/// the chat jump window.
@Suite("Search")
struct SearchTests {
    private func strings(_ text: String, _ words: [String]) -> [String] {
        SearchHighlight.ranges(in: text, words: words).map { String(text[$0]) }
    }

    @Test func foldsCaseAndDiacritics() {
        #expect(SearchHighlight.fold("Ș") == "s")
        #expect(SearchHighlight.fold("ş") == "s")
        #expect(SearchHighlight.fold("É") == "e")
        #expect(SearchHighlight.fold("Œ") == "oe")
        #expect(SearchHighlight.fold("ß") == "ss")
    }

    @Test func highlightRanges() {
        #expect(strings("Sărmăluțe la bunica", ["sarma"]) == ["Sărmă"])
        #expect(strings("Crème brûlée, CRÈME!", ["creme", "brulee"]) == ["Crème", "brûlée", "CRÈME"])
        #expect(strings("cœur", ["coeur"]) == ["cœur"])
        #expect(strings("abcabc", ["abc", "bca"]) == ["abcabc"], "overlaps merge")
        #expect(strings("😀 pizza 🍕", ["pizza"]) == ["pizza"])
        #expect(strings("pizza", []).isEmpty)
        #expect(strings("", ["pizza"]).isEmpty)
    }

    @Test func queryRules() {
        #expect(SearchRules.query(" p ") == nil)
        #expect(SearchRules.query("   ") == nil)
        #expect(SearchRules.query(" pi ") == "pi")
    }

    @Test func decodesRowsAndSkipsUnknownKinds() throws {
        let json = """
        [{"kind":"event","id":"6f0c1d1e-0000-4000-8000-000000000001","title":"Climbing","snippet":null,
          "author_id":"6f0c1d1e-0000-4000-8000-000000000002","author_name":null,
          "created_at":"2026-11-22T10:00:00.123456+00:00","event_at":"2026-11-30T18:00:00+00:00","rank":3.1,"matched_words":["climb"]},
         {"kind":"poll","id":"6f0c1d1e-0000-4000-8000-000000000003","title":null,"snippet":"x",
          "author_id":"6f0c1d1e-0000-4000-8000-000000000002","author_name":"Ana",
          "created_at":"2026-11-22T10:00:00+00:00","event_at":null,"rank":1,"matched_words":null}]
        """
        let rows = try BoolaaJSON.decoder.decode([SearchHitRow].self, from: Data(json.utf8))
        let hits = SearchRules.hits(rows)
        #expect(hits.count == 1)
        #expect(hits.first?.kind == .event)
        #expect(hits.first?.eventAt != nil)
        #expect(hits.first?.matchedWords == ["climb"])
    }

    @Test func chatWindow() {
        let bubble = UUID(), sender = UUID()
        let rows = (0..<40).map { i in
            ChatMessage(id: UUID(), bubbleId: bubble, senderId: sender, content: "m\(i)", createdAt: Date(timeIntervalSince1970: Double(i)))
        }
        #expect(ChatJump.window(rows, target: rows[10].id) == (true, true))
        #expect(ChatJump.window(rows, target: rows[30].id) == (true, false))
        #expect(ChatJump.window(rows, target: UUID()) == (false, false))
        // Merging the window into the newest page fills the gap, keeps order, adds nothing twice.
        let merged = ChatJump.merge(Array(rows[20...]), window: Array(rows[5...]))
        #expect(merged.map(\.content) == (5..<40).map { "m\($0)" })
    }
}

/// `search_bubble` and `chat_messages_around` against the local backend, in a throwaway bubble that is
/// deleted when Alice and Bob leave.
@Suite("Search (local backend)", .serialized)
struct SearchIntegrationTests {
    private func signedInAPI(_ email: String) async throws -> BoolaaAPI {
        let client = Backend.makeClient(config: try AppConfig.load(), authStorage: InMemoryAuthStorage())
        try await client.auth.signIn(email: email, password: "password123")
        return BoolaaAPI(client: client)
    }

    @Test(.timeLimit(.minutes(2)))
    func searchesAndOpensAMessage() async throws {
        let alice = try await signedInAPI("alice@boolaa.test")
        let bob = try await signedInAPI("bob@boolaa.test")
        let bubble = try await alice.createBubble(name: "zz search \(UUID().uuidString.prefix(6))", description: nil, maxSize: 4)
        let request = try await bob.requestToJoin(inviteCode: bubble.inviteCode)
        _ = try await alice.approveJoinRequest(id: request.id)
        do {
            let target = try await alice.sendMessage(bubbleID: bubble.id, senderID: Seed.alice, content: "Sărmăluțe la bunica")
            for i in 1...60 { _ = try await alice.sendMessage(bubbleID: bubble.id, senderID: Seed.alice, content: "filler \(i)") }

            let hits = try await bob.searchBubble(bubbleID: bubble.id, query: "sarmalute")
            let hit = try #require(hits.first { $0.id == target.id })
            #expect(hit.kind == .chatMessage)
            #expect(hit.authorName == "Alice")
            #expect(SearchHighlight.ranges(in: hit.snippet ?? "", words: hit.matchedWords).count == 1)
            #expect(try await bob.searchBubble(bubbleID: bubble.id, query: "s").isEmpty, "too short")

            // The target is outside the newest page; the window reaches it and the newest message.
            let newest = try await bob.chatPage(bubbleID: bubble.id, beforeID: nil)
            #expect(!newest.contains { $0.id == target.id })
            let rows = try await bob.chatAround(bubbleID: bubble.id, messageID: target.id)
            #expect(ChatJump.window(rows, target: target.id) == (true, true))
            #expect(rows.last?.content == "filler 60")
            #expect(rows.first?.sender?.name == "Alice")
            #expect(try await bob.chatAround(bubbleID: bubble.id, messageID: UUID()).isEmpty)
        } catch {
            Issue.record(error)
        }
        try? await bob.leaveBubble(bubbleID: bubble.id, userID: Seed.bob)
        try? await alice.leaveBubble(bubbleID: bubble.id, userID: Seed.alice)
    }
}
