import Foundation
import Supabase
import Testing
@testable import Boolaa

private func lproj(_ lang: String) throws -> Bundle {
    let path = try #require(Bundle.main.path(forResource: lang, ofType: "lproj"), "\(lang).lproj missing from Boolaa.app")
    return try #require(Bundle(path: path))
}

/// Tappable links in chat (docs/boolaa-spec.md "Chat"): same rules as the web's linkify.ts.
@Suite("Chat links")
struct LinkifyTests {
    @Test func linksHttpAndWwwKeepsTrailingPunctuationAsText() {
        let text = "See https://example.com/a_(b), www.boolaa.ro. and http://x.y/z?q=1! not ftp://no or wwwx.com"
        let parts = Linkify.split(text)
        #expect(parts.compactMap { p in p.url.map { [p.text, $0.absoluteString] } } == [
            ["https://example.com/a_(b)", "https://example.com/a_(b)"],
            ["www.boolaa.ro", "https://www.boolaa.ro"],
            ["http://x.y/z?q=1", "http://x.y/z?q=1"],
        ])
        #expect(parts.map(\.text).joined() == text)
    }

    @Test func bracketsAndEdgeCases() {
        #expect(Linkify.split("(see https://a.com)").first { $0.url != nil }?.text == "https://a.com")
        #expect(Linkify.split("https://").allSatisfy { $0.url == nil })
        #expect(Linkify.split("no links here") == [Linkify.Part(text: "no links here", url: nil)])
        #expect(Linkify.split("").isEmpty)
        #expect(Linkify.split("émoji 🎉 https://ex.com/ü ok").first { $0.url != nil }?.text == "https://ex.com/ü")
    }

    @Test func attributedCarriesLinks() {
        let attributed = Linkify.attributed("go to www.boolaa.ro now")
        let links = attributed.runs.compactMap(\.link)
        #expect(links == [URL(string: "https://www.boolaa.ro")!])
        #expect(String(attributed.characters) == "go to www.boolaa.ro now")
    }
}

/// Past events (20261123220000_past_events_export_check.sql): an event ends 1 hour after it starts.
@Suite("Past events")
struct PastEventsTests {
    private func event(_ title: String, hoursFromNow: Double, now: Date) -> BubbleEvent {
        BubbleEvent(id: UUID(), bubbleId: Seed.flatmates, creatorId: Seed.bob, title: title, description: nil,
                    datetime: now.addingTimeInterval(hoursFromNow * 3600), location: nil, rsvpList: [],
                    createdAt: .distantPast, creator: nil)
    }

    @Test func endsOneHourAfterTheStart() {
        let now = Date(timeIntervalSince1970: 1_795_000_000)
        #expect(!EventSchedule.hasEnded(event("a", hoursFromNow: -0.5, now: now), now: now))
        #expect(EventSchedule.hasEnded(event("b", hoursFromNow: -1, now: now), now: now))
        #expect(!EventSchedule.hasEnded(event("c", hoursFromNow: 2, now: now), now: now))
    }

    @Test func upcomingSoonestFirstPastMostRecentFirst() {
        let now = Date(timeIntervalSince1970: 1_795_000_000)
        let events = [event("old", hoursFromNow: -48, now: now), event("later", hoursFromNow: 24, now: now),
                      event("running", hoursFromNow: -0.25, now: now), event("recent", hoursFromNow: -2, now: now),
                      event("soon", hoursFromNow: 1, now: now)]
        let split = EventSchedule.split(events, now: now)
        #expect(split.upcoming.map(\.title) == ["running", "soon", "later"])
        #expect(split.past.map(\.title) == ["recent", "old"])
    }

    @Test func eventHasEndedIsMapped() {
        #expect(UserFacingError.classify(PostgrestError(message: "event has ended")) == .eventEnded)
        #expect(UserFacingError.classify(PostgrestError(message: "event not found")) == .eventNotFound)
    }

    @Test func wentCountUsesPlurals() throws {
        let ro = try lproj("ro"), locale = Locale(identifier: "ro")
        #expect(String(localized: "\(1) went", bundle: ro, locale: locale) == "A participat 1 persoană")
        #expect(String(localized: "\(3) went", bundle: ro, locale: locale) == "Au participat 3 persoane")
        #expect(String(localized: "\(25) went", bundle: ro, locale: locale) == "Au participat 25 de persoane")
        #expect(String(localized: "\(2) went", bundle: try lproj("en"), locale: Locale(identifier: "en")) == "2 people went")
        #expect(String(localized: "\(0) went", bundle: try lproj("fr"), locale: Locale(identifier: "fr")) == "0 personne y est allée")
    }
}

/// Data export: the 1-per-hour limit is shown before any code is emailed.
@Suite("Data export limit")
struct ExportLimitTests {
    @Test func limitTimeFromEitherFunction() {
        let now = Date(timeIntervalSince1970: 1_795_000_000)
        let fromSend = DeviceCodeError.from(status: 429, body: Data(#"{"error":"export_rate_limited","retry_after":1200}"#.utf8))
        #expect(fromSend.retryAfter == 1200)
        #expect(UserFacingError.classify(deviceCode: fromSend) == .exportRateLimited)
        #expect(DataExport.limitedUntil(fromSend, now: now) == now.addingTimeInterval(1200))
        let fromExport = DataExportError(status: 429, code: "export_rate_limited", retryAfter: 60)
        #expect(DataExport.limitedUntil(fromExport, now: now) == now.addingTimeInterval(60))
        #expect(DataExport.limitedUntil(DeviceCodeError(status: 429, code: "rate_limited", attemptsLeft: nil), now: now) == nil)
    }

    @Test(arguments: ["ro", "fr", "es", "it"])
    func limitMessageIsTranslated(_ lang: String) throws {
        let text = try lproj(lang).localizedString(forKey: "You can download your data once an hour. Try again after %@.",
                                                   value: "⟨missing⟩", table: nil)
        #expect(text != "⟨missing⟩" && text.contains("%@") && !text.contains("Try again"))
    }
}

/// The notification preview hint names the current bubble, not a seeded one.
@Suite("Notification preview hint")
struct PreviewHintTests {
    @Test(arguments: ["ro", "fr", "es", "it"])
    func hintTakesTheBubbleName(_ lang: String) throws {
        let key = "When off, notifications only say \"New message in %@\", without names or text."
        let text = try lproj(lang).localizedString(forKey: key, value: "⟨missing⟩", table: nil)
        #expect(text.contains("%@") && !text.contains("Flatmates"))
    }
}

/// Chat scroll rules after a bubble switch while the chat is open.
@Suite("Chat scroll on bubble switch")
struct ChatScrollTests {
    @Test func eachBubbleIsItsOwnLoad() {
        let a = ChatScroll.loadKey(bubbleID: Seed.flatmates, contentVersion: 0)
        #expect(a != ChatScroll.loadKey(bubbleID: UUID(), contentVersion: 0))
        #expect(a != ChatScroll.loadKey(bubbleID: Seed.flatmates, contentVersion: 1))
        #expect(a == ChatScroll.loadKey(bubbleID: Seed.flatmates, contentVersion: 0))
    }

    @Test func olderPagesOnlyForTheSettledCurrentLoad() {
        let old = ChatScroll.loadKey(bubbleID: Seed.flatmates, contentVersion: 0)
        let new = ChatScroll.loadKey(bubbleID: UUID(), contentVersion: 0)
        // Just switched: the previous load was armed, the new one not yet.
        #expect(!ChatScroll.mayLoadOlder(nearTop: true, initialLoaded: true, armedFor: old, current: new))
        #expect(!ChatScroll.mayLoadOlder(nearTop: true, initialLoaded: false, armedFor: nil, current: new))
        #expect(!ChatScroll.mayLoadOlder(nearTop: false, initialLoaded: true, armedFor: new, current: new))
        #expect(ChatScroll.mayLoadOlder(nearTop: true, initialLoaded: true, armedFor: new, current: new))
    }
}
