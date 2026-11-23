import EventKit
import Foundation
import Testing
@testable import Boolaa

private func lproj(_ lang: String) throws -> Bundle {
    let path = try #require(Bundle.main.path(forResource: lang, ofType: "lproj"), "\(lang).lproj missing from Boolaa.app")
    return try #require(Bundle(path: path))
}

/// Marketplace availability (migration 20261123170000) and "Ask in chat" drafts.
@Suite("Market availability")
struct MarketAvailabilityTests {
    private static let owner = UserProfile(id: Seed.alice, name: "Alice", avatar: nil)

    private func item(_ n: Int, _ seconds: TimeInterval, _ availability: MarketAvailability = .available,
                      status: MarketStatus = .free, owner: UserProfile? = MarketAvailabilityTests.owner) -> MarketItem {
        MarketItem(id: UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", n))!, bubbleId: Seed.flatmates,
                   ownerId: Seed.alice, image: "img", title: "Lamp", description: nil, status: status,
                   availability: availability, createdAt: Date(timeIntervalSince1970: seconds), owner: owner)
    }

    private func decode(_ json: String) throws -> MarketItem {
        try BoolaaJSON.decoder.decode(MarketItem.self, from: Data(json.utf8))
    }

    private let base = #"{"id":"00000000-0000-0000-0000-000000000001","bubble_id":"00000000-0000-0000-0000-000000000002","owner_id":"00000000-0000-0000-0000-000000000003","image":"i","title":"Lamp","description":null,"status":"trade","created_at":"2026-11-23T10:00:00+00:00""#

    @Test func decodesAvailability() throws {
        #expect(try decode(base + #","availability":"reserved"}"#).availability == .reserved)
        #expect(try decode(base + #","availability":"taken"}"#).availability == .taken)
    }

    @Test func missingOrUnknownAvailabilityReadsAsAvailable() throws {
        #expect(try decode(base + "}").availability == .available)
        #expect(try decode(base + #","availability":"sold"}"#).availability == .available)
        // The bundled fixtures predate the column.
        #expect(try Fixture.decode([MarketItem].self, "market").allSatisfy { $0.availability == .available })
    }

    @Test func inputEncodesAvailability() throws {
        let input = MarketInput(image: "i", title: "t", description: nil, status: .free, availability: .taken)
        let json = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as? [String: Any])
        #expect(json["availability"] as? String == "taken")
        #expect(json["bubble_id"] == nil && json["owner_id"] == nil, "updates send only granted columns")
    }

    @Test func takenSinksOtherwiseNewestFirst() {
        let rows = [item(1, 100, .taken), item(2, 300), item(3, 200, .reserved), item(4, 400, .taken)]
        #expect(rows.sorted(by: MarketItem.precedes).map(\.createdAt.timeIntervalSince1970) == [300, 200, 400, 100])
    }

    @Test func liveUpdateToTakenMovesItemLast() {
        let rows = [item(1, 300), item(2, 200), item(3, 100)]
        let out = FeedMerge.upsert(rows, item(1, 300, .taken, owner: nil))
        #expect(out.map(\.id) == [rows[1].id, rows[2].id, rows[0].id])
        #expect(out.last?.owner?.name == "Alice", "the joined owner is kept")
        // Back to available: returns to its place.
        let back = FeedMerge.upsert(out, item(1, 300, .available, owner: nil))
        #expect(back.map(\.id) == rows.map(\.id))
    }

    @Test @MainActor func hideTakenFilter() {
        let rows = [item(1, 300, .available, status: .free), item(2, 200, .reserved, status: .trade), item(3, 100, .taken, status: .free)]
        #expect(MarketModel.filter(rows, by: nil).count == 3)
        #expect(MarketModel.filter(rows, by: nil, hideTaken: true).map(\.availability) == [.available, .reserved])
        #expect(MarketModel.filter(rows, by: .free, hideTaken: true).count == 1)
        #expect(MarketModel.filter(rows, by: .free, hideTaken: false).count == 2)
    }

    @Test func chatDraftOnlyForOthersAvailableOrReservedItems() throws {
        let en = try lproj("en")
        #expect(item(1, 0).chatDraft(me: Seed.bob, bundle: en, locale: Locale(identifier: "en")) == "@Alice, is “Lamp” still available?")
        #expect(item(1, 0, .reserved).chatDraft(me: Seed.bob, bundle: en) != nil)
        #expect(item(1, 0).chatDraft(me: Seed.alice) == nil, "never message yourself")
        #expect(item(1, 0, .taken).chatDraft(me: Seed.bob) == nil, "taken items have no shortcut")
    }

    @Test func chatDraftIsTranslatedWithFallbackName() throws {
        let ro = try lproj("ro")
        #expect(item(1, 0).chatDraft(me: Seed.bob, bundle: ro, locale: Locale(identifier: "ro")) == "@Alice, mai e disponibil „Lamp”?")
        let fr = try lproj("fr")
        #expect(item(1, 0).chatDraft(me: Seed.bob, bundle: fr, locale: Locale(identifier: "fr")) == "@Alice, « Lamp » est toujours disponible ?")
        let es = try lproj("es")
        #expect(item(1, 0, owner: nil).chatDraft(me: Seed.bob, bundle: es, locale: Locale(identifier: "es")) == "@Alguien, ¿sigue disponible «Lamp»?")
    }

    @Test func availabilityLabelsTranslated() throws {
        let it = try lproj("it")
        #expect(it.localizedString(forKey: "Taken", value: nil, table: nil) == "Ritirato")
        #expect(it.localizedString(forKey: "Reserved", value: nil, table: nil) == "Prenotato")
        #expect(try lproj("ro").localizedString(forKey: "Hide taken", value: nil, table: nil) == "Ascunde ce e luat")
    }

    @Test @MainActor func routerHandsDraftToChatOnce() {
        let router = ShellRouter()
        router.openChat(draft: "@Alice, hi")
        #expect(router.path == [.chat])
        #expect(router.takeChatDraft() == "@Alice, hi")
        #expect(router.takeChatDraft() == nil)
    }
}

/// "Add to calendar" field mapping (EKEventEditViewController prefill).
@Suite("Calendar export")
struct CalendarExportTests {
    private func event(location: String? = "Kitchen", description: String? = "Bring snacks") -> BubbleEvent {
        BubbleEvent(id: UUID(), bubbleId: Seed.flatmates, creatorId: Seed.bob, title: "Movie night", description: description,
                    datetime: Date(timeIntervalSince1970: 1_795_000_000), location: location, rsvpList: [],
                    createdAt: .distantPast, creator: nil)
    }

    @Test func mapsTitleStartEndLocationNotes() {
        let f = CalendarEventFields(event())
        #expect(f.title == "Movie night")
        #expect(f.start == Date(timeIntervalSince1970: 1_795_000_000))
        #expect(f.end.timeIntervalSince(f.start) == 3600, "no end time stored: one hour")
        #expect(f.location == "Kitchen")
        #expect(f.notes == "Bring snacks")
    }

    @Test func emptyOptionalFieldsAreLeftOut() {
        let f = CalendarEventFields(event(location: "", description: nil))
        #expect(f.location == nil && f.notes == nil)
    }

    @Test func appliesToEKEvent() {
        let store = EKEventStore()
        let ek = EKEvent(eventStore: store)
        let f = CalendarEventFields(event())
        f.apply(to: ek)
        #expect(ek.title == "Movie night")
        #expect(ek.startDate == f.start && ek.endDate == f.end)
        #expect(!ek.isAllDay)
        #expect(ek.location == "Kitchen" && ek.notes == "Bring snacks")
    }
}

/// Owner-only availability changes against the local backend. A throwaway bubble owned by Alice
/// and joined by Bob; both leave at the end, which deletes it with its items.
@Suite("Market availability (local backend)", .serialized)
struct MarketAvailabilityIntegrationTests {
    private func signedInAPI(_ email: String) async throws -> BoolaaAPI {
        let client = Backend.makeClient(config: try AppConfig.load(), authStorage: InMemoryAuthStorage())
        try await client.auth.signIn(email: email, password: "password123")
        return BoolaaAPI(client: client)
    }

    @Test(.timeLimit(.minutes(1)))
    func onlyTheOwnerChangesAvailability() async throws {
        let alice = try await signedInAPI("alice@boolaa.test")
        let bob = try await signedInAPI("bob@boolaa.test")
        let bubble = try await alice.createBubble(name: "zz market \(UUID().uuidString.prefix(6))", description: nil, maxSize: 4)
        do {
            let request = try await bob.requestToJoin(inviteCode: bubble.inviteCode)
            #expect(try await alice.approveJoinRequest(id: request.id))

            var input = MarketInput(image: "\(Seed.alice.uuidString.lowercased())/zz.jpg", title: "zz lamp", description: nil, status: .free)
            input.bubbleId = bubble.id; input.ownerId = Seed.alice
            try await alice.createMarketItem(input)
            let item = try #require(try await bob.marketItems(bubbleID: bubble.id).first)
            #expect(item.availability == .available)

            try await alice.setMarketAvailability(id: item.id, .reserved)
            #expect(try await bob.marketItems(bubbleID: bubble.id).first?.availability == .reserved)

            // Bob's update matches no row (RLS market_update_own): nothing changes.
            try? await bob.setMarketAvailability(id: item.id, .taken)
            #expect(try await alice.marketItems(bubbleID: bubble.id).first?.availability == .reserved)

            try await alice.setMarketAvailability(id: item.id, .taken)
            #expect(try await bob.marketItems(bubbleID: bubble.id).first?.availability == .taken)
        } catch {
            Issue.record(error)
        }
        try? await bob.leaveBubble(bubbleID: bubble.id, userID: Seed.bob)
        try? await alice.leaveBubble(bubbleID: bubble.id, userID: Seed.alice)
    }
}
