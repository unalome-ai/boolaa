import Foundation
import SwiftUI
import Testing
@testable import Boolaa

/// VoiceOver label composition (docs/boolaa-spec.md, "Accessibility"). The simulator runs these in English.
@Suite("Accessibility labels")
struct AccessibilityLabelTests {
    @Test func joinSkipsEmptyParts() {
        #expect(A11y.join(["Bob", nil, "  ", "hi", ""]) == "Bob, hi")
    }

    @Test func photoAndAnnouncementTexts() {
        #expect(A11y.photoFrom("Ana") == "Photo from Ana")
        #expect(A11y.newMessageFrom("Bob") == "New message from Bob")
    }

    @Test func reactionSummaryReadsCountAndYours() {
        let label = A11y.reactions([ReactionSummary(kind: .like, count: 1, mine: true),
                                    ReactionSummary(kind: .love, count: 3, mine: false)])
        #expect(label == "Like: 1 reaction, You reacted, Love: 3 reactions")
    }

    @Test func chatMessageFromSomeoneElse() {
        let label = A11y.chatMessage(sender: "Bob", isMine: false, text: "Pizza tonight?", hasPhoto: true, deleted: false,
                                     time: "19:05", reactions: [ReactionSummary(kind: .laugh, count: 2, mine: false)])
        #expect(label == "Bob, Photo from Bob, Pizza tonight?, 19:05, Haha: 2 reactions")
    }

    @Test func ownChatMessageSaysYou() {
        let label = A11y.chatMessage(sender: "Alice", isMine: true, text: "", hasPhoto: true, deleted: false, time: "08:00", reactions: [])
        #expect(label == "You, Photo, 08:00")
    }

    @Test func deletedMessageReadsThePlaceholderOnly() {
        let label = A11y.chatMessage(sender: "Bob", isMine: false, text: "", hasPhoto: false, deleted: true, time: "10:00",
                                     reactions: [ReactionSummary(kind: .like, count: 1, mine: false)])
        #expect(label == "Bob, This message was deleted, 10:00")
    }

    @Test func messageLinksBecomeActionsOncePerURL() {
        let urls = Linkify.urls(in: "see www.boolaa.ro and https://example.com/a, again www.boolaa.ro.")
        #expect(urls.map(\.absoluteString) == ["https://www.boolaa.ro", "https://example.com/a"])
    }

    @Test @MainActor func unreadBadgeLabelIsPlural() {
        #expect(UnreadBadge.label(1) == "1 unread message")
        #expect(UnreadBadge.label(5) == "5 unread messages")
    }
}

/// The accessibility-only strings exist in every language (the catalog check covers the rest).
@Suite("Accessibility strings")
struct AccessibilityStringTests {
    private func lproj(_ lang: String) throws -> Bundle {
        let path = try #require(Bundle.main.path(forResource: lang, ofType: "lproj"))
        return try #require(Bundle(path: path))
    }

    @Test(arguments: [
        ("ro", "Fotografie de la Ana", "Mesaj nou de la Ana", "Bulele tale", "Navigare principală"),
        ("fr", "Photo de Ana", "Nouveau message de Ana", "Tes bulles", "Navigation principale"),
        ("es", "Foto de Ana", "Nuevo mensaje de Ana", "Tus burbujas", "Navegación principal"),
        ("it", "Foto di Ana", "Nuovo messaggio da Ana", "Le tue bolle", "Navigazione principale"),
    ])
    func translated(lang: String, photo: String, message: String, bubbles: String, navigation: String) throws {
        let bundle = try lproj(lang), locale = Locale(identifier: lang)
        #expect(String(localized: "Photo from \("Ana")", bundle: bundle, locale: locale) == photo)
        #expect(String(localized: "New message from \("Ana")", bundle: bundle, locale: locale) == message)
        #expect(String(localized: "Your bubbles", bundle: bundle, locale: locale) == bubbles)
        #expect(String(localized: "Main navigation", bundle: bundle, locale: locale) == navigation)
        #expect(String(localized: "Open photo", bundle: bundle, locale: locale) != "Open photo")
        #expect(String(localized: "Copied", bundle: bundle, locale: locale) != "Copied")
    }
}
