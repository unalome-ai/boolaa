import Foundation
import SwiftUI
import Testing
import UIKit
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

/// WCAG 2.2 AA for the shared token pairs (docs/design-system.md §2.5): text 4.5:1, UI parts 3:1.
/// The same pairs are checked on Android (ContrastTest.kt) and, in place, by axe on the web.
@Suite("Token contrast")
struct TokenContrastTests {
    private func rgb(_ color: Color, dark: Bool) -> (Double, Double, Double, Double) {
        let ui = UIColor(color).resolvedColor(with: UITraitCollection(userInterfaceStyle: dark ? .dark : .light))
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        ui.getRed(&r, green: &g, blue: &b, alpha: &a)
        return (Double(r), Double(g), Double(b), Double(a))
    }

    private func luminance(_ c: (Double, Double, Double)) -> Double {
        func lin(_ v: Double) -> Double { v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4) }
        return 0.2126 * lin(c.0) + 0.7152 * lin(c.1) + 0.0722 * lin(c.2)
    }

    /// Contrast of `fg` (composited over `bg` if translucent) against `bg`.
    private func ratio(_ fg: Color, _ bg: Color, dark: Bool) -> Double {
        let f = rgb(fg, dark: dark), b = rgb(bg, dark: dark)
        let over = (f.0 * f.3 + b.0 * (1 - f.3), f.1 * f.3 + b.1 * (1 - f.3), f.2 * f.3 + b.2 * (1 - f.3))
        let l1 = luminance(over) + 0.05, l2 = luminance((b.0, b.1, b.2)) + 0.05
        return max(l1, l2) / min(l1, l2)
    }

    @Test(arguments: [false, true])
    func textOnSurfaces(dark: Bool) {
        for (name, bg) in [("background", Theme.background), ("card", Theme.card), ("field", Theme.field)] {
            #expect(ratio(Theme.ink, bg, dark: dark) >= 4.5, "ink on \(name)")
            #expect(ratio(Theme.inkSecondary, bg, dark: dark) >= 4.5, "inkSecondary on \(name)")
            #expect(ratio(Theme.dangerText, bg, dark: dark) >= 4.5, "dangerText on \(name)")
        }
        // Hue text sits on cards, the background and its own wash, never on `field` (tangerine is 4.46 there).
        for hue in Hue.bubblePalette {
            for (name, bg) in [("background", Theme.background), ("card", Theme.card)] {
                #expect(ratio(hue.text, bg, dark: dark) >= 4.5, "\(hue.name) text on \(name)")
            }
            let wash = Color(uiColor: UIColor(hue.wash).resolvedColor(with: UITraitCollection(userInterfaceStyle: dark ? .dark : .light)))
            let onWash = ratio(hue.text, washOver(wash, Theme.card, dark: dark), dark: dark)
            #expect(onWash >= 4.5, "\(hue.name) text on its wash")
        }
    }

    /// `top` (translucent) composited over `bottom`, as an opaque colour.
    private func washOver(_ top: Color, _ bottom: Color, dark: Bool) -> Color {
        let t = rgb(top, dark: dark), b = rgb(bottom, dark: dark)
        return Color(.sRGB, red: t.0 * t.3 + b.0 * (1 - t.3), green: t.1 * t.3 + b.1 * (1 - t.3), blue: t.2 * t.3 + b.2 * (1 - t.3))
    }

    @Test(arguments: [false, true])
    func fieldEdgesAreVisible(dark: Bool) {
        for (name, bg) in [("background", Theme.background), ("card", Theme.card), ("field", Theme.field)] {
            #expect(ratio(Theme.fieldBorder, bg, dark: dark) >= 3, "fieldBorder on \(name)")
            #expect(ratio(Theme.focusRing, bg, dark: dark) >= 3, "focusRing on \(name)")
        }
    }

    @Test func contentOnFills() {
        for hue in Hue.bubblePalette {
            #expect(ratio(hue.onFill, hue.fill, dark: false) >= 4.5, "\(hue.name) onFill")
        }
        #expect(ratio(.white, Theme.danger, dark: false) >= 4.5)
        #expect(ratio(.white, Theme.taken, dark: false) >= 4.5)
    }
}
