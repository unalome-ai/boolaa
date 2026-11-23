import Foundation
import Testing
@testable import Boolaa

@Suite("Routing gate")
struct RoutingGateTests {
    typealias Input = RouteGate.Input

    @Test func restoringSessionShowsLaunch() {
        #expect(RouteGate.resolve(Input(isRestoringSession: true, isSignedIn: false, approvedBubbleCount: nil)) == .launching)
        #expect(RouteGate.resolve(Input(isRestoringSession: true, isSignedIn: true, approvedBubbleCount: 3)) == .launching)
    }

    @Test func signedOutGoesToAuth() {
        #expect(RouteGate.resolve(Input(isRestoringSession: false, isSignedIn: false, approvedBubbleCount: nil)) == .auth)
        #expect(RouteGate.resolve(Input(isRestoringSession: false, isSignedIn: false, approvedBubbleCount: 2)) == .auth)
    }

    @Test func signedInWaitsForMemberships() {
        #expect(RouteGate.resolve(Input(isRestoringSession: false, isSignedIn: true, approvedBubbleCount: nil)) == .launching)
    }

    @Test func zeroBubblesGoesToOnboarding() {
        #expect(RouteGate.resolve(Input(isRestoringSession: false, isSignedIn: true, approvedBubbleCount: 0)) == .onboarding)
    }

    @Test(arguments: [1, 2, 10])
    func anyBubbleGoesToMain(count: Int) {
        #expect(RouteGate.resolve(Input(isRestoringSession: false, isSignedIn: true, approvedBubbleCount: count)) == .main)
    }

    @Test func currentBubbleSelection() throws {
        let bubbles = try Fixture.decode([BubbleMember].self, "members").compactMap(\.bubble)
        #expect(RouteGate.pickCurrentBubble(stored: nil, approved: bubbles)?.id == bubbles.first?.id)
        #expect(RouteGate.pickCurrentBubble(stored: Seed.climbing, approved: bubbles)?.name == "Climbing Crew")
        // A stored bubble the user left falls back to the first approved one.
        #expect(RouteGate.pickCurrentBubble(stored: UUID(), approved: bubbles)?.id == bubbles.first?.id)
        #expect(RouteGate.pickCurrentBubble(stored: Seed.flatmates, approved: []) == nil)
    }
}

@Suite("Feature logic")
struct FeatureLogicTests {
    @Test(arguments: [(1, 1), (2, 2), (3, 2), (4, 3), (5, 3), (8, 5)])
    func approvalsNeededIsStrictMajority(members: Int, needed: Int) {
        #expect(JoinRequest.approvalsNeeded(memberCount: members) == needed)
    }

    @Test func approvalsCountOnlyCurrentMembers() throws {
        let requests = try Fixture.decode([JoinRequest].self, "joinreqs")
        var request = try #require(requests.first)
        let gone = UUID()
        request.approverIds = [Seed.alice, gone, Seed.alice]
        #expect(request.countedApprovals(memberIDs: [Seed.alice, Seed.bob]) == 1)
        #expect(request.countedApprovals(memberIDs: []) == 0)
    }

    @Test func waitingForSeatOnlyWhenFullWithMajority() {
        #expect(JoinRequest.isWaitingForSeat(approvals: 2, memberCount: 2, maxSize: 2))
        #expect(!JoinRequest.isWaitingForSeat(approvals: 1, memberCount: 2, maxSize: 2))   // no majority yet
        #expect(!JoinRequest.isWaitingForSeat(approvals: 2, memberCount: 2, maxSize: 8))   // seat free: admitted already
    }

    @Test func storagePathFromPublicURL() {
        let uid = "11111111-1111-1111-1111-111111111111"
        let url = "http://127.0.0.1:55321/storage/v1/object/public/food.images/\(uid)/abc.jpg"
        #expect(BoolaaAPI.storagePath(fromPublicURL: url, bucket: .food) == "\(uid)/abc.jpg")
        #expect(BoolaaAPI.storagePath(fromPublicURL: url + "?t=1", bucket: .food) == "\(uid)/abc.jpg")
        #expect(BoolaaAPI.storagePath(fromPublicURL: url, bucket: .market) == nil)
        #expect(BoolaaAPI.storagePath(fromPublicURL: "https://images.unsplash.com/photo-1?w=800", bucket: .food) == nil)
        #expect(BoolaaAPI.storagePath(fromPublicURL: "http://h/storage/v1/object/public/avatars/a/b/c.jpg", bucket: .avatars) == nil)
    }

    @Test func legalPageURLsCarryLanguage() {
        let base = URL(string: "http://localhost:3200")!
        #expect(LegalPage.privacy.url(base: base, language: .ro).absoluteString == "http://localhost:3200/privacy?lang=ro")
        #expect(LegalPage.terms.url(base: base, language: .fr).absoluteString == "http://localhost:3200/terms?lang=fr")
        #expect(LegalPage(link: URL(string: "boolaa-legal://terms")!) == .terms)
        #expect(LegalPage(link: URL(string: "https://example.com/terms")!) == nil)
        #expect(AppConfig.webBaseURL.host() != nil)
    }

    @Test func deleteConfirmationWord() {
        #expect(DeleteAccountSheet.matches(" delete ", word: "DELETE"))
        #expect(DeleteAccountSheet.matches("sterge", word: "ȘTERGE"))
        #expect(!DeleteAccountSheet.matches("DELET", word: "DELETE"))
        #expect(!DeleteAccountSheet.matches("", word: "DELETE"))
    }

    @Test func reportTargetsUseTheAuthor() throws {
        let messages = try Fixture.decode([ChatMessage].self, "chat")
        let m = try #require(messages.first)
        let t = ReportTarget.message(m)
        #expect(t.type.rawValue == "chat_message" && t.targetID == m.id && t.authorID == m.senderId)
        #expect(ReportReason.allCases.map(\.rawValue) == ["spam", "harassment", "hate", "sexual", "violence", "self_harm", "other"])
    }

    @Test func tagParsing() {
        #expect(SharedLink.parseTags("food, cheap ,  ,Recipes, food") == ["food", "cheap", "recipes"])
        #expect(SharedLink.parseTags("") == [])
    }

    @Test func homeFeedIsRecencySorted() throws {
        let feed = FeedItem.combine(
            messages: try Fixture.decode([ChatMessage].self, "chat"),
            food: try Fixture.decode([FoodPost].self, "food"),
            market: try Fixture.decode([MarketItem].self, "market"),
            events: try Fixture.decode([BubbleEvent].self, "events"),
            links: try Fixture.decode([SharedLink].self, "links"))
        #expect(feed.count >= 5)
        #expect(zip(feed, feed.dropFirst()).allSatisfy { $0.date >= $1.date })
        #expect(Set(feed.map(\.id)).count == feed.count)
    }

    @Test @MainActor func marketFilter() throws {
        let items = try Fixture.decode([MarketItem].self, "market")
        #expect(MarketModel.filter(items, by: nil).count == items.count)
        #expect(MarketModel.filter(items, by: .free).allSatisfy { $0.status == .free })
        #expect(MarketModel.filter(items, by: .trade).allSatisfy { $0.status == .trade })
    }

    @Test @MainActor func chatMergeDedupesAndOrders() throws {
        let model = ChatModel()
        let messages = try Fixture.decode([ChatMessage].self, "chat")
        for m in messages.reversed() { model.merge(m) }
        model.merge(messages[0])
        #expect(model.messages.map(\.id) == messages.map(\.id))
    }

    @Test func avatarInitials() {
        #expect(AvatarView.initials(for: "Alice") == "A")
        #expect(AvatarView.initials(for: "Mary Jane Watson") == "MJ")
        #expect(AvatarView.initials(for: "  ") == "?")
        #expect(AvatarView.initials(for: "Ana (Flat 4B)") == "AF")
        #expect(AvatarView.initials(for: "Ion - Pop") == "IP")
        #expect(AvatarView.initials(for: "🍕") == "🍕")
    }

    /// The bubble colour must match Android and web: FNV-1a 32-bit of the lowercase UUID, xor-folded, modulo the palette.
    @Test func bubbleColourIsDeterministic() {
        #expect(Hue.fnv1a("") == 2_166_136_261)
        #expect(Hue.fnv1a("a") == 3_826_002_220)
        #expect(Hue.fnv1a("boolaa") == 3_352_750_575)
        #expect(Hue.bubblePalette.map(\.name) == ["grape", "coral", "mint", "sky", "sunny", "pink", "tangerine", "indigo"])
        #expect(Hue.forID(UUID(uuidString: "AAAAAAAA-0000-0000-0000-000000000001")) == .sky)
        #expect(Hue.forID(UUID(uuidString: "aaaaaaaa-0000-0000-0000-000000000002")) == .tangerine)
        #expect(Hue.forSeed("11111111-1111-1111-1111-111111111111") == .sunny)
        #expect(Hue.forID(nil) == .grape)
    }
}
