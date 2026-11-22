import Foundation
import Testing
@testable import Boolaa

/// Merge rules for live feed changes (same cases as web tests/live-feed-merge.spec.ts and Android LiveFeedTest).
@Suite("Live feed merge")
struct LiveFeedMergeTests {
    private static let alice = UserProfile(id: Seed.alice, name: "Alice", avatar: nil)

    private func post(_ id: String, _ seconds: TimeInterval, _ text: String = "x", author: UserProfile? = LiveFeedMergeTests.alice) -> FoodPost {
        FoodPost(id: UUID(uuidString: id)!, bubbleId: Seed.flatmates, userId: Seed.alice, image: "img",
                 description: text, createdAt: Date(timeIntervalSince1970: seconds), user: author)
    }

    private let a = "00000000-0000-0000-0000-00000000000a"
    private let b = "00000000-0000-0000-0000-00000000000b"
    private let c = "00000000-0000-0000-0000-00000000000c"

    @Test func insertKeepsNewestFirst() {
        let rows = [post(a, 300), post(b, 100)]
        let out = FeedMerge.upsert(rows, post(c, 200, author: nil))
        #expect(out.map(\.id) == [a, c, b].map { UUID(uuidString: $0)! })
    }

    @Test func echoOfOwnWriteChangesNothing() {
        let rows = [post(a, 300), post(b, 100)]
        #expect(FeedMerge.upsert(rows, post(a, 300)) == rows)
        // Realtime payloads have no author: still equal once the known author is kept.
        #expect(FeedMerge.upsert(rows, post(a, 300, author: nil)) == rows)
    }

    @Test func updateReplacesFieldsAndKeepsAuthor() {
        let rows = [post(a, 300), post(b, 100)]
        let out = FeedMerge.upsert(rows, post(b, 100, "edited", author: nil))
        #expect(out[1].description == "edited")
        #expect(out[1].user?.name == "Alice")
        #expect(out.count == 2)
    }

    @Test func eventsResortByDatetime() throws {
        func event(_ id: String, _ day: Double, rsvp: [UUID] = []) -> BubbleEvent {
            BubbleEvent(id: UUID(uuidString: id)!, bubbleId: Seed.flatmates, creatorId: Seed.bob, title: "E", description: nil,
                        datetime: Date(timeIntervalSince1970: day * 86_400), location: nil, rsvpList: rsvp,
                        createdAt: .distantPast, creator: nil)
        }
        let rows = [event(a, 1), event(b, 2)]
        #expect(FeedMerge.upsert(rows, event(a, 3)).map(\.id) == [rows[1].id, rows[0].id])
        // An RSVP is an UPDATE of the event row.
        let rsvp = FeedMerge.upsert(rows, event(b, 2, rsvp: [Seed.alice]))
        #expect(rsvp[1].rsvpList == [Seed.alice])
    }

    @Test func deleteByIDIgnoresUnknownIDs() {
        let rows = [post(a, 300), post(b, 100)]
        #expect(FeedMerge.remove(rows, id: UUID(uuidString: a)!).map(\.id) == [UUID(uuidString: b)!])
        #expect(FeedMerge.remove(rows, id: UUID()) == rows)
    }

    /// A Realtime UPDATE record for an event (arrays as JSON arrays, `+00:00` timestamps) decodes.
    @Test func decodesRealtimeEventRecord() throws {
        let json = """
        {"id":"\(a)","bubble_id":"\(Seed.flatmates.uuidString.lowercased())","creator_id":"\(Seed.bob.uuidString.lowercased())",
         "title":"Dinner","description":null,"datetime":"2026-11-25T18:30:00+00:00","location":null,
         "rsvp_list":["\(Seed.alice.uuidString.lowercased())"],"created_at":"2026-11-22T20:41:07.123456+00:00"}
        """
        let event = try BoolaaJSON.decoder.decode(BubbleEvent.self, from: Data(json.utf8))
        #expect(event.rsvpList == [Seed.alice])
        #expect(event.creator == nil)
        #expect(BubbleEvent.table == "events" && FoodPost.table == "food_posts"
                && MarketItem.table == "market_items" && SharedLink.table == "shared_links")
    }
}

/// LiveFeed against the local backend: Alice's new link reaches Bob's open Links list, then leaves it.
@Suite("Live feed (local backend)", .serialized)
@MainActor
struct LiveFeedIntegrationTests {
    private func signedInAPI(_ email: String) async throws -> BoolaaAPI {
        let client = Backend.makeClient(config: try AppConfig.load(), authStorage: InMemoryAuthStorage())
        try await client.auth.signIn(email: email, password: "password123")
        return BoolaaAPI(client: client)
    }

    private func eventually(_ timeout: Duration = .seconds(10), _ condition: () -> Bool) async -> Bool {
        let clock = ContinuousClock(), deadline = clock.now + timeout
        while clock.now < deadline {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(100))
        }
        return condition()
    }

    @Test(.timeLimit(.minutes(1)))
    func linkAppearsAndDisappearsLive() async throws {
        let alice = try await signedInAPI("alice@boolaa.test")
        let bob = try await signedInAPI("bob@boolaa.test")
        let model = LinksModel()
        await model.load(api: bob, bubbleID: Seed.flatmates)
        let listener = Task { await model.listen(api: bob, bubbleID: Seed.flatmates) }
        defer { listener.cancel() }
        try await Task.sleep(for: .seconds(2)) // subscription registers just after SUBSCRIBED

        let title = "zz live \(UUID().uuidString.prefix(6))"
        try await alice.createLink(LinkInput(bubbleId: Seed.flatmates, userId: Seed.alice,
                                             url: "https://example.com/live", title: title, tags: []))
        #expect(await eventually { model.links.contains { $0.title == title && $0.user?.name == "Alice" } })
        #expect(model.links.first?.title == title, "newest first")

        let id = try #require(model.links.first { $0.title == title }?.id)
        try await alice.deleteLink(id: id)
        #expect(await eventually { !model.links.contains { $0.id == id } })
    }
}
