import SwiftUI
import Testing
import UIKit
@testable import Boolaa

// Brand redesign (docs/design-system.md §8): contrast of the new token pairs (§8.6), the dock label fallback,
// mascot expressions per state, the haptic vocabulary and the band hues.

/// sRGB colour maths for composited pairs.
private struct RGB {
    var r: Double, g: Double, b: Double

    init(_ color: Color, dark: Bool) {
        let ui = UIColor(color).resolvedColor(with: UITraitCollection(userInterfaceStyle: dark ? .dark : .light))
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        ui.getRed(&r, green: &g, blue: &b, alpha: &a)
        self.r = Double(r); self.g = Double(g); self.b = Double(b)
        alpha = Double(a)
    }

    init(r: Double, g: Double, b: Double) { self.r = r; self.g = g; self.b = b; alpha = 1 }

    private(set) var alpha: Double

    /// `self` at `opacity` (times its own alpha) over `base`.
    func over(_ base: RGB, opacity: Double = 1) -> RGB {
        let a = alpha * opacity
        return RGB(r: r * a + base.r * (1 - a), g: g * a + base.g * (1 - a), b: b * a + base.b * (1 - a))
    }

    var luminance: Double {
        func lin(_ v: Double) -> Double { v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4) }
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    }

    func contrast(_ other: RGB) -> Double {
        let l1 = luminance + 0.05, l2 = other.luminance + 0.05
        return max(l1, l2) / min(l1, l2)
    }
}

@Suite("Brand contrast (design-system §8.6)")
struct BrandContrastTests {
    private func band(_ hue: Hue, dark: Bool, circles: Bool) -> RGB {
        let bg = RGB(Theme.background, dark: dark)
        let tint = RGB(hue.fill, dark: dark).over(bg, opacity: dark ? Theme.Brand.bandDark : Theme.Brand.bandLight)
        guard circles else { return tint }
        return dark ? bg.over(tint, opacity: Theme.Brand.bandCircleDark) : RGB(r: 1, g: 1, b: 1).over(tint, opacity: Theme.Brand.bandCircleLight)
    }

    @Test(arguments: [false, true])
    func textOnTheFeatureBand(dark: Bool) {
        for hue in Hue.bubblePalette {
            for circles in [false, true] {
                let surface = band(hue, dark: dark, circles: circles)
                #expect(RGB(Theme.ink, dark: dark).contrast(surface) >= 10, "ink on the \(hue.name) band")
                #expect(RGB(Theme.inkSecondary, dark: dark).contrast(surface) >= 4.5, "inkSecondary on the \(hue.name) band")
            }
        }
    }

    @Test(arguments: [false, true])
    func homeTitleGradientIsLargeTextSafe(dark: Bool) {
        // Every stop of the gradient on the Home (grape) band: ≥ 3:1, for text ≥ 24 pt bold.
        for hue in [Hue.grape, .pink, .tangerine] {
            for circles in [false, true] {
                #expect(RGB(hue.text, dark: dark).contrast(band(.grape, dark: dark, circles: circles)) >= 3, "\(hue.name) stop")
            }
        }
    }

    @Test func onFillOnEveryGradientStop() {
        // Own messages, stickers and the dock pill: onFill on both stops of the hue's gradient (§2.1).
        for hue in Hue.bubblePalette {
            let stops = hue.onFill == .white ? [hue.fill, hue.deep] : [hue.glow, hue.fill]
            for stop in stops {
                #expect(RGB(hue.onFill, dark: false).contrast(RGB(stop, dark: false)) >= 4.5, "\(hue.name) onFill")
            }
        }
    }

    @Test(arguments: [false, true])
    func othersMessagesAndTheirLinks(dark: Bool) {
        let card = RGB(Theme.card, dark: dark)
        for hue in Hue.bubblePalette {
            let wash = RGB(hue.fill, dark: dark).over(card, opacity: dark ? 0.24 : 0.14)
            #expect(RGB(Theme.ink, dark: dark).contrast(wash) >= 4.5, "ink on the \(hue.name) wash")
            #expect(RGB(hue.text, dark: dark).contrast(wash) >= 4.5, "\(hue.name) link on its wash")
        }
    }

    @Test(arguments: [false, true])
    func textOverTheChatOrbs(dark: Bool) {
        // Thread panel = card 50 % over the background; an orb's darkest stop at 6 % / 10 % over it.
        let panel = RGB(Theme.card, dark: dark).over(RGB(Theme.background, dark: dark), opacity: Theme.Brand.chatPanel)
        for orb in Hue.bubblePalette {
            let under = RGB(orb.deep, dark: dark).over(panel, opacity: dark ? Theme.Brand.chatOrbDark : Theme.Brand.chatOrbLight)
            for sender in Hue.bubblePalette {
                #expect(RGB(sender.text, dark: dark).contrast(under) >= 4.5, "\(sender.name) name over a \(orb.name) orb")
            }
            #expect(RGB(Theme.inkSecondary, dark: dark).contrast(under) >= 4.5)
            #expect(RGB(Theme.dangerText, dark: dark).contrast(under) >= 4.5)
        }
    }

    @Test(arguments: [false, true])
    func inactiveDockIconsOnTheGlass(dark: Bool) {
        // inkSecondary on the glass (card 72 % / 80 %) over black or white content: a UI part, 3:1.
        for content in [RGB(r: 0, g: 0, b: 0), RGB(r: 1, g: 1, b: 1)] {
            let glass = RGB(Theme.card, dark: dark).over(content, opacity: dark ? Theme.Brand.glassDark : Theme.Brand.glassLight)
            #expect(RGB(Theme.inkSecondary, dark: dark).contrast(glass) >= 3)
        }
    }
}

@Suite("Dock label fallback (§8.3)")
struct DockLayoutTests {
    @Test func barGeometry() {
        #expect(DockLayout.sideMargin(rowWidth: 390) == 16)
        #expect(DockLayout.sideMargin(rowWidth: 320) == 12)
        #expect(DockLayout.barWidth(rowWidth: 390) == 288)
        #expect(DockLayout.barWidth(rowWidth: 320) == 226)
        #expect(DockLayout.labelledPillWidth(labelWidth: 40) == 96)
    }

    @Test func thresholdAt390() {
        // 2 × 5 + 4 × 40 + (14 + 20 + 6 + w + 16) ≤ 288  ⇔  w ≤ 62.
        #expect(DockLayout.showsLabel(labelWidth: 62, rowWidth: 390, accessibilitySize: false))
        #expect(!DockLayout.showsLabel(labelWidth: 63, rowWidth: 390, accessibilitySize: false))
    }

    @Test func iconOnlyAt320AndAtAccessibilitySizes() {
        #expect(!DockLayout.showsLabel(labelWidth: 1, rowWidth: 320, accessibilitySize: false))
        #expect(!DockLayout.showsLabel(labelWidth: 30, rowWidth: 430, accessibilitySize: true))
        #expect(!DockLayout.showsLabel(labelWidth: 0, rowWidth: 430, accessibilitySize: false))
    }

    @Test @MainActor func everyShortNameFitsOnCurrentPhones() {
        // docs/i18n-glossary.md, "Dock short labels". SF Pro Rounded heavy is a little wider than the web's font:
        // at 390 every name but "Réglages" (66 pt, limit 62) shows; at 402 (iPhone Pro) all of them do (§8.3 iOS note).
        let names = ["Home", "Events", "Food", "Market", "Settings",
                     "Acasă", "Agendă", "Mâncare", "Piață", "Setări",
                     "Accueil", "Agenda", "Repas", "Marché", "Réglages",
                     "Inicio", "Eventos", "Comida", "Mercado", "Ajustes",
                     "Eventi", "Cibo", "Mercato", "Opzioni"]
        for name in names {
            let width = DockLayout.measure(name, fontSize: DockLayout.labelFontSize)
            #expect(DockLayout.showsLabel(labelWidth: width, rowWidth: 402, accessibilitySize: false), "\(name) is \(width) wide")
            if name != "Réglages" {
                #expect(DockLayout.showsLabel(labelWidth: width, rowWidth: 390, accessibilitySize: false), "\(name) is \(width) wide")
            }
        }
        // The full screen titles would not: that is why the dock has short names.
        #expect(!DockLayout.showsLabel(labelWidth: DockLayout.measure("Marketplace", fontSize: 14), rowWidth: 390, accessibilitySize: false))
    }

    @Test func slotWidthsFillTheBar() {
        let labelled = DockLayout.slotWidths(barWidth: 288, activeIndex: 2, activePillWidth: 100)
        #expect(labelled[2] == 100)
        #expect(abs(labelled.reduce(0, +) - 278) < 0.001)
        #expect(Set(labelled.enumerated().filter { $0.offset != 2 }.map(\.element)).count == 1)
        let iconOnly = DockLayout.slotWidths(barWidth: 226, activeIndex: 0, activePillWidth: nil)
        #expect(iconOnly.allSatisfy { abs($0 - 216.0 / 5) < 0.001 })
        #expect(iconOnly.allSatisfy { $0 >= DockLayout.inactiveSlot })
    }

    @Test func tabsHaveShortAccessibleNames() {
        #expect(String(localized: MainTab.marketplace.dockLabel) == "Market")
        #expect(String(localized: MainTab.food.dockLabel) == "Food")
        #expect(String(localized: MainTab.home.dockLabel) == "Home")
    }
}

@Suite("Mascot, haptics and bands (§8.1, §8.3, §8.4)")
struct BrandRulesTests {
    @Test func expressionPerState() {
        #expect(MascotExpression.for(.empty) == .curious)
        #expect(MascotExpression.for(.success) == .cheering)
        #expect(MascotExpression.for(.loadError(.online)) == .worried)
        #expect(MascotExpression.for(.loadError(.offline)) == .sleepy)
        #expect(MascotExpression.for(.loadError(.unreachable)) == .sleepy)
    }

    @Test func mascotHuePerPlace() {
        let bubble = Hue.sky
        #expect(MascotPlace.home.hue(bubble: bubble) == .sky)
        #expect(MascotPlace.chat.hue(bubble: bubble) == .sky)
        #expect(MascotPlace.events.hue(bubble: bubble) == .coral)
        #expect(MascotPlace.food.hue(bubble: bubble) == .tangerine)
        #expect(MascotPlace.marketplace.hue(bubble: bubble) == .mint)
        #expect(MascotPlace.links.hue(bubble: bubble) == .sky)
        #expect(MascotPlace.search.hue(bubble: bubble) == .grape)
        #expect(MascotPlace.loadError.hue(bubble: bubble) == .grape)
        // White face on grape and indigo, ink on the bright hues.
        #expect(MascotExpression.faceIsWhite(.grape) && MascotExpression.faceIsWhite(.indigo))
        #expect(!MascotExpression.faceIsWhite(.coral) && !MascotExpression.faceIsWhite(.sunny))
    }

    @Test func blinkClosesBriefly() {
        #expect(Mascot.eyeOpenness(0) == 1)
        #expect(abs(Mascot.eyeOpenness(4.2 * 0.96) - 0.1) < 0.01)
        #expect(Mascot.eyeOpenness(4.2 * 0.99) == 1)
    }

    @Test func hapticVocabulary() {
        let expected: [Interaction: Haptic] = [
            .tabSwitch: .selection, .bubbleSwitch: .impactMedium, .add: .impactLight, .success: .success,
            .smallSuccess: .success, .destructiveConfirm: .impactRigid, .error: .error, .refreshFinished: .success,
            .reactionAdded: .impactLight, .reactionRemoved: .selection, .send: .impactLight, .rsvpTap: .impactLight,
            .toggle: .selection,
        ]
        for interaction in Interaction.allCases {
            #expect(interaction.haptic == expected[interaction], "\(interaction)")
        }
    }

    @Test func reactionHapticDirection() {
        let none = [ReactionSummary(kind: .like, count: 1, mine: false)]
        let mine = [ReactionSummary(kind: .like, count: 2, mine: true)]
        #expect(ReactionBar.mineCount(mine) > ReactionBar.mineCount(none))
    }

    @Test func bandHues() {
        let bubble = Hue.pink
        #expect(BandScreen.home.hue(bubble: bubble) == .grape)
        #expect(BandScreen.events.hue(bubble: bubble) == .coral)
        #expect(BandScreen.food.hue(bubble: bubble) == .tangerine)
        #expect(BandScreen.marketplace.hue(bubble: bubble) == .mint)
        #expect(BandScreen.links.hue(bubble: bubble) == .sky)
        #expect(BandScreen.settings.hue(bubble: bubble) == .indigo)
        #expect(BandScreen.chat.hue(bubble: bubble) == .pink)
        // The dock pill and the band agree on every tab.
        for tab in MainTab.allCases { #expect(tab.hue == tab.bandScreen.hue(bubble: bubble)) }
    }

    @Test func stickerTilts() {
        #expect(StickerKind.chat.tilt == -3 && StickerKind.event.tilt == 2 && StickerKind.food.tilt == -2)
        #expect(StickerKind.market.tilt == 3 && StickerKind.link.tilt == -2)
        #expect(StickerKind.allCases.allSatisfy { $0.tilt(accessibilitySize: true) == 0 })
    }

    @Test func admittedBubbleIsDetectedOnce() {
        let bubble = UUID(), user = UUID()
        let request = JoinRequest.fixture(bubbleID: bubble, userID: user)
        let member = BubbleMember.fixture(bubbleID: bubble, userID: user)
        #expect(SessionStore.admittedBubble(previousPending: [request], previousMembers: [], now: [member]) == bubble)
        // First load (nothing known before) and an existing membership are not admissions.
        #expect(SessionStore.admittedBubble(previousPending: [request], previousMembers: nil, now: [member]) == nil)
        #expect(SessionStore.admittedBubble(previousPending: [request], previousMembers: [member], now: [member]) == nil)
        #expect(SessionStore.admittedBubble(previousPending: [], previousMembers: [], now: [member]) == nil)
    }
}

private extension JoinRequest {
    static func fixture(bubbleID: UUID, userID: UUID) -> JoinRequest {
        JoinRequest(id: UUID(), userId: userID, bubbleId: bubbleID, approverIds: [], createdAt: .now)
    }
}

private extension BubbleMember {
    static func fixture(bubbleID: UUID, userID: UUID) -> BubbleMember {
        BubbleMember(userId: userID, bubbleId: bubbleID, approved: true, role: .member, createdAt: .now)
    }
}
