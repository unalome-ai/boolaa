import Foundation
import Testing
@testable import Boolaa

@Suite("Model decoding from real PostgREST rows")
struct ModelDecodingTests {
    @Test func users() throws {
        let users = try Fixture.decode([UserProfile].self, "users")
        #expect(users.map(\.name) == ["Alice", "Bob", "Carol"])
        #expect(users[0].id == Seed.alice)
        #expect(users[0].avatar == nil)
        #expect(users[0].createdAt != nil)
    }

    @Test func membershipsEmbedBubble() throws {
        let rows = try Fixture.decode([BubbleMember].self, "members")
        #expect(rows.count == 2)
        let flat = try #require(rows.first { $0.bubbleId == Seed.flatmates })
        #expect(flat.role == .owner)
        #expect(flat.approved)
        #expect(flat.bubble?.name == "Flatmates")
        #expect(flat.bubble?.inviteCode == "FLAT2026")
        #expect(flat.bubble?.maxSize == 8)
        #expect(rows.first { $0.bubbleId == Seed.climbing }?.role == .member)
    }

    @Test func chatMessagesWithSender() throws {
        let messages = try Fixture.decode([ChatMessage].self, "chat")
        #expect(!messages.isEmpty)
        let first = messages[0]
        #expect(first.bubbleId == Seed.flatmates)
        #expect(first.sender?.name == "Alice")
        #expect(first.content.contains("oat milk"))
        // Fractional-second timestamptz keeps sub-second precision (to the millisecond).
        let comps = Calendar(identifier: .gregorian).dateComponents(in: TimeZone(identifier: "UTC")!, from: first.createdAt)
        #expect(comps.year == 2026 && comps.month == 11 && comps.day == 22)
        #expect(zip(messages, messages.dropFirst()).allSatisfy { $0.createdAt <= $1.createdAt })
    }

    @Test func eventsWithRSVPArray() throws {
        let events = try Fixture.decode([BubbleEvent].self, "events")
        let dinner = try #require(events.first { $0.title == "Flat dinner" })
        #expect(dinner.rsvpList == [Seed.alice])
        #expect(dinner.location == "Kitchen")
        #expect(dinner.creator?.name == "Alice")
        #expect(events.contains { $0.description == nil })
    }

    @Test func foodMarketLinks() throws {
        let food = try Fixture.decode([FoodPost].self, "food")
        #expect(food.first?.user?.name == "Bob")
        #expect(food.first?.image.hasPrefix("https://") == true)

        let market = try Fixture.decode([MarketItem].self, "market")
        #expect(market.first?.status == .free)
        #expect(market.first?.owner?.id == Seed.alice)

        let links = try Fixture.decode([SharedLink].self, "links")
        #expect(links.first?.tags == ["food", "cheap"])
        #expect(links.first?.title == "Budget recipes")
    }

    @Test func joinRequestsWithUserAndBubble() throws {
        let requests = try Fixture.decode([JoinRequest].self, "joinreqs")
        let carol = try #require(requests.first)
        #expect(carol.userId == Seed.carol)
        #expect(carol.user?.name == "Carol")
        #expect(carol.bubble?.name == "Flatmates")
        #expect(carol.approverIds.isEmpty)
    }

    @Test func realtimeRecordTimestampShape() throws {
        let message = try Fixture.decode(ChatMessage.self, "realtime_chat_record")
        #expect(message.sender == nil)
        #expect(message.content == "realtime hello")
    }

    @Test(arguments: [
        "2026-11-22T15:26:52.414517+00:00",
        "2026-11-22T15:26:52+00:00",
        "2026-11-22T15:26:52Z",
        "2026-11-22 15:26:52.414517+00",
        "2026-11-22T15:26:52.4+00:00",
    ])
    func timestampShapes(raw: String) throws {
        let date = try #require(BoolaaJSON.parseTimestamp(raw))
        let expected = try #require(BoolaaJSON.parseTimestamp("2026-11-22T15:26:52Z"))
        #expect(abs(date.timeIntervalSince(expected)) < 1)
    }

    @Test func insertPayloadUsesSnakeCase() throws {
        let data = try BoolaaJSON.encoder.encode(NewChatMessage(bubbleId: Seed.flatmates, senderId: Seed.alice, content: "hi"))
        let json = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(Set(json.keys) == ["bubble_id", "sender_id", "content"])

        let edit = try BoolaaJSON.encoder.encode(EventInput(title: "T", description: nil, datetime: .now, location: nil))
        let editJSON = try #require(JSONSerialization.jsonObject(with: edit) as? [String: Any])
        #expect(editJSON["bubble_id"] == nil, "updates must not send bubble_id/creator_id")
        #expect(editJSON.keys.contains("description"), "nil description is sent as null to clear it")
    }
}
