import Foundation
import Testing
@testable import Boolaa

/// Reactions (docs/boolaa-spec.md, "Reactions"): aggregation, merges by id, toggle results.
@Suite("Reactions")
struct ReactionsTests {
    let me = UUID(), bob = UUID(), carol = UUID()
    let post = UUID(), other = UUID()

    private func row(_ kind: String, by user: UUID, on target: UUID? = nil, type: String = "food_post", id: UUID = UUID()) -> Reaction {
        Reaction(id: id, targetType: type, targetId: target ?? post, reaction: kind, userId: user)
    }

    @Test func summaryCountsInFixedOrderAndHighlightsMine() {
        var set = ReactionSet()
        set.insert(row("thanks", by: bob))
        set.insert(row("love", by: bob))
        set.insert(row("love", by: me))
        set.insert(row("like", by: carol))
        set.insert(row("angry", by: carol)) // unknown key: ignored
        set.insert(row("wow", by: carol, on: other))
        let chips = set.summary(for: post, me: me)
        #expect(chips.map(\.kind) == [.like, .love, .thanks])
        #expect(chips.map(\.count) == [1, 2, 1])
        #expect(chips.map(\.mine) == [false, true, false])
        #expect(set.summary(for: UUID(), me: me).isEmpty)
        #expect(set.summary(for: post, me: nil).allSatisfy { !$0.mine })
        #expect(set.reacted(.love, on: post, me: me))
        #expect(!set.reacted(.like, on: post, me: me))
    }

    @Test func insertIsIdempotentAndDeleteIsByID() {
        var set = ReactionSet()
        let id = UUID()
        let first = set.insert(row("laugh", by: bob, id: id))
        let echo = set.insert(row("laugh", by: bob, id: id))
        #expect(first)
        #expect(!echo, "the realtime echo changes nothing")
        #expect(set.summary(for: post, me: me).first?.count == 1)
        let unknown = set.remove(id: UUID())
        #expect(!unknown, "an id we don't hold changes nothing")
        let removed = set.remove(id: id)
        #expect(removed)
        #expect(set.summary(for: post, me: me).isEmpty)
        #expect(set.count == 0)
    }

    @Test func toggleResultAppliesThenEchoesAreNoOps() {
        var set = ReactionSet()
        let id = UUID()
        let on = ToggleReactionResult(id: id, reacted: true, reaction: "sad", targetType: "food_post", targetId: post)
        set.apply(on, me: me)
        #expect(set.summary(for: post, me: me) == [ReactionSummary(kind: .sad, count: 1, mine: true)])
        // Realtime INSERT of the same row.
        set.insert(Reaction(id: id, targetType: "food_post", targetId: post, reaction: "sad", userId: me))
        #expect(set.summary(for: post, me: me).first?.count == 1)
        let off = ToggleReactionResult(id: id, reacted: false, reaction: "sad", targetType: "food_post", targetId: post)
        set.apply(off, me: me)
        #expect(set.summary(for: post, me: me).isEmpty)
        // Realtime DELETE of the same row afterwards.
        let late = set.remove(id: id)
        #expect(!late)
    }

    @Test func deletedMessageDropsItsReactions() {
        var set = ReactionSet()
        let kept = UUID()
        set.insert(row("like", by: bob, type: "chat_message"))
        set.insert(row("love", by: me, type: "chat_message"))
        set.insert(row("wow", by: bob, on: other, type: "chat_message", id: kept))
        set.dropTarget(post)
        #expect(set.summary(for: post, me: me).isEmpty)
        #expect(set.count == 1)
        #expect(set.contains(kept))
        // A late DELETE for a dropped row is harmless.
        let late = set.remove(id: UUID())
        #expect(!late)
    }

    @Test func reloadReplacesOnlyTheLoadedTargets() {
        var set = ReactionSet()
        set.insert(row("like", by: bob))
        set.insert(row("like", by: bob, on: other))
        set.replace(targets: [post], with: [row("love", by: carol), row("love", by: me)])
        #expect(set.summary(for: post, me: me) == [ReactionSummary(kind: .love, count: 2, mine: true)])
        #expect(set.summary(for: other, me: me).first?.kind == .like)
    }

    @MainActor
    @Test func storeKeepsOnlyItsTypeAndHeldTargets() {
        let store = ReactionStore(.foodPost)
        store.liveInsert(row("like", by: bob), holds: { $0 == post })
        store.liveInsert(row("like", by: bob, type: "event"), holds: { _ in true })
        store.liveInsert(row("like", by: bob, on: other), holds: { $0 == post })
        #expect(store.summary(for: post, me: me).first?.count == 1)
        #expect(store.summary(for: other, me: me).isEmpty)
    }

    @Test func decodesToggleResultAndRealtimeRow() throws {
        let toggle = """
        {"id":"0f0b8a52-2d5e-4c39-9a8e-4b5f4b7c1a11","reacted":true,"reaction":"love","target_type":"chat_message","target_id":"aaaaaaaa-0000-0000-0000-000000000001"}
        """
        let r = try BoolaaJSON.decoder.decode(ToggleReactionResult.self, from: Data(toggle.utf8))
        #expect(r.reacted && r.reaction == "love" && r.targetType == "chat_message")
        #expect(r.targetId == UUID(uuidString: "aaaaaaaa-0000-0000-0000-000000000001"))
        // A realtime record carries every column, including the internal ones.
        let record = """
        {"id":"0f0b8a52-2d5e-4c39-9a8e-4b5f4b7c1a11","bubble_id":"aaaaaaaa-0000-0000-0000-000000000001",
         "user_id":"22222222-2222-2222-2222-222222222222","reaction":"thanks","message_id":null,"event_id":null,
         "food_post_id":"d2413efb-ea4a-4f35-9aee-99aaa65be287","market_item_id":null,"link_id":null,
         "target_owner_id":"11111111-1111-1111-1111-111111111111","target_type":"food_post",
         "target_id":"d2413efb-ea4a-4f35-9aee-99aaa65be287","created_at":"2026-11-23T16:00:00.123456+00:00"}
        """
        let row = try BoolaaJSON.decoder.decode(Reaction.self, from: Data(record.utf8))
        #expect(row.reaction == "thanks" && row.targetType == "food_post")
        #expect(row.userId == UUID(uuidString: "22222222-2222-2222-2222-222222222222"))
    }

    @Test func reactionKindsMatchTheBackendSet() {
        #expect(ReactionKind.allCases.map(\.rawValue) == ["like", "love", "laugh", "wow", "sad", "thanks"])
        #expect(ReactionKind.allCases.map(\.emoji) == ["👍", "❤️", "😂", "😮", "😢", "🙏"])
    }
}

@Suite("Link previews")
struct LinkPreviewTests {
    private func link(_ extra: String) throws -> SharedLink {
        let json = """
        {"id":"d2413efb-ea4a-4f35-9aee-99aaa65be287","bubble_id":"aaaaaaaa-0000-0000-0000-000000000001",
         "user_id":"22222222-2222-2222-2222-222222222222","url":"https://www.bbcgoodfood.com/recipes","title":"Budget",
         "tags":[],"created_at":"2026-11-22T15:26:52.414517+00:00"\(extra)}
        """
        return try BoolaaJSON.decoder.decode(SharedLink.self, from: Data(json.utf8))
    }

    @Test func decodesPreviewColumns() throws {
        let l = try link("""
        ,"preview_status":"ready","preview_title":"Sourdough & friends","preview_description":"Bake it slow.",
         "preview_site_name":"Bread Weekly","preview_image_path":"d2413efb-ea4a-4f35-9aee-99aaa65be287/0f0b8a52-2d5e-4c39-9a8e-4b5f4b7c1a11.jpg",
         "preview_requested_at":null,"preview_claimed_at":null,"preview_fetched_at":"2026-11-23T16:00:00+00:00"
        """)
        #expect(l.previewState == .ready)
        #expect(l.previewTitle == "Sourdough & friends")
        #expect(l.previewSiteName == "Bread Weekly")
        #expect(l.previewImagePath?.hasSuffix(".jpg") == true)
    }

    @Test func statesFallBackToThePlainLink() throws {
        #expect(try link("").previewState == .none, "rows from before the migration")
        #expect(try link(#","preview_status":"none""#).previewState == .none)
        #expect(try link(#","preview_status":"failed""#).previewState == .none)
        #expect(try link(#","preview_status":"pending""#).previewState == .loading)
        #expect(try link(#","preview_status":"fetching""#).previewState == .loading)
        #expect(try link(#","preview_status":"ready""#).previewState == .none, "ready without any content")
    }

    @Test func liveUpdateCarriesThePreview() throws {
        let before = try link(#","preview_status":"pending","user":{"id":"22222222-2222-2222-2222-222222222222","name":"Bob","avatar":null}"#)
        var update = try link(#","preview_status":"ready","preview_title":"T""#)
        update.user = nil
        let merged = FeedMerge.upsert([before], update)
        #expect(merged.first?.previewState == .ready)
        #expect(merged.first?.previewTitle == "T")
        #expect(merged.first?.user?.name == "Bob", "the joined author is kept")
    }

    @Test(arguments: [
        ("https://www.Example.com/a?b=1", "example.com"),
        ("http://news.bbc.co.uk/", "news.bbc.co.uk"),
        ("https://WWW.github.com", "github.com"),
        ("https://wwwx.example.org/", "wwwx.example.org"),
        ("https://[2606:4700::1]/", "2606:4700::1"),
    ])
    func displayDomain(url: String, expected: String) {
        #expect(SharedLink.displayDomain(url) == expected)
    }

    @Test func displayDomainOfGarbage() {
        #expect(SharedLink.displayDomain("not a url") == nil)
        #expect(SharedLink.displayDomain("") == nil)
    }
}

@Suite("Reaction strings")
struct ReactionStringTests {
    private func bundle(_ lang: String) throws -> Bundle {
        let path = try #require(Bundle.main.path(forResource: lang, ofType: "lproj"))
        return try #require(Bundle(path: path))
    }

    private func chip(_ name: String, _ n: Int, _ lang: String) throws -> String {
        String(localized: "\(name): \(n) reactions", bundle: try bundle(lang), locale: Locale(identifier: lang))
    }

    @Test func chipLabelsUseRealPlurals() throws {
        #expect(try chip("Love", 1, "en") == "Love: 1 reaction")
        #expect(try chip("Love", 3, "en") == "Love: 3 reactions")
        #expect(try chip("Ador", 1, "ro") == "Ador: 1 reacție")
        #expect(try chip("Ador", 3, "ro") == "Ador: 3 reacții")
        #expect(try chip("Ador", 20, "ro") == "Ador: 20 de reacții")
        #expect(try chip("J'adore", 1, "fr") == "J'adore : 1 réaction")
        #expect(try chip("J'adore", 2, "fr") == "J'adore : 2 réactions")
        #expect(try chip("Me encanta", 2, "es") == "Me encanta: 2 reacciones")
        #expect(try chip("Adoro", 1, "it") == "Adoro: 1 reazione")
    }

    @Test func everyNewStringIsTranslated() throws {
        let keys = ["Like", "Love", "Haha", "Wow", "Sad", "Thanks", "Add a reaction", "React", "You reacted", "Loading preview…"]
        for lang in ["ro", "fr", "es", "it"] {
            let b = try bundle(lang)
            for key in keys {
                #expect(b.localizedString(forKey: key, value: "⟨missing⟩", table: nil) != "⟨missing⟩", "\(lang): \(key)")
            }
        }
        let ro = try bundle("ro")
        #expect(ro.localizedString(forKey: "Thanks", value: nil, table: nil) == "Mulțumesc")
        #expect(ro.localizedString(forKey: "Loading preview…", value: nil, table: nil) == "Se încarcă previzualizarea…")
        #expect(try bundle("it").localizedString(forKey: "Add a reaction", value: nil, table: nil) == "Aggiungi una reazione")
    }
}
