import SwiftUI
import UIKit

// The rules of the brand redesign (docs/design-system.md §8) as plain functions, so they are unit-tested:
// which hue owns a screen's band, when the dock shows its label, which face the mascot makes and which
// haptic each interaction plays. Views read these; they don't re-derive them.

/// The screens that carry a feature band (§8.1).
enum BandScreen: Sendable, CaseIterable {
    case home, events, food, marketplace, links, settings, chat

    /// Feature colour = where you are; Chat is the bubble's own room, so its band takes the bubble's hue.
    func hue(bubble: Hue) -> Hue {
        switch self {
        case .home: .grape
        case .events: .coral
        case .food: .tangerine
        case .marketplace: .mint
        case .links: .sky
        case .settings: .indigo
        case .chat: bubble
        }
    }
}

extension MainTab {
    var bandScreen: BandScreen {
        switch self {
        case .home: .home
        case .events: .events
        case .food: .food
        case .marketplace: .marketplace
        case .settings: .settings
        }
    }

    /// Short dock name (`nav.dock.*`, docs/i18n-glossary.md "Dock short labels"): the visible label of the active
    /// pill and every tab's accessibility label. Screen titles keep the full names (`title`).
    var dockLabel: LocalizedStringResource {
        switch self {
        case .home: LocalizedStringResource("nav.dock.home", defaultValue: "Home", comment: "Dock tab short name; must fit the active pill at 390 pt")
        case .events: LocalizedStringResource("nav.dock.events", defaultValue: "Events", comment: "Dock tab short name; must fit the active pill at 390 pt")
        case .food: LocalizedStringResource("nav.dock.food", defaultValue: "Food", comment: "Dock tab short name; must fit the active pill at 390 pt")
        case .marketplace: LocalizedStringResource("nav.dock.marketplace", defaultValue: "Market", comment: "Dock tab short name; must fit the active pill at 390 pt")
        case .settings: LocalizedStringResource("nav.dock.settings", defaultValue: "Settings", comment: "Dock tab short name; must fit the active pill at 390 pt")
        }
    }
}

/// Wide screens (an unfolded iPhone Duo, about 950 pt): the tab on the left, the bubble chat always open on the
/// right (spec "Wide screens"). Phones stay single-column.
enum ShellLayout {
    /// From this width the chat gets its own pane.
    static let wideMinWidth: CGFloat = 820
    static let chatMinWidth: CGFloat = 340
    static let chatMaxWidth: CGFloat = 440

    static func isWide(width: CGFloat) -> Bool { width >= wideMinWidth }

    /// The chat pane: 42 % of the width, kept between 340 and 440 pt.
    static func chatWidth(totalWidth: CGFloat) -> CGFloat {
        min(chatMaxWidth, max(chatMinWidth, (totalWidth * 0.42).rounded()))
    }
}

/// Dock geometry and the "does the label fit" rule (§8.3).
enum DockLayout {
    static let barPadding: CGFloat = 5
    static let tabHeight: CGFloat = 46
    static let inactiveSlot: CGFloat = 40
    static let chatOrb: CGFloat = 60
    static let gap: CGFloat = 10
    static let icon: CGFloat = 20
    static let iconGap: CGFloat = 6
    static let pillLeading: CGFloat = 14
    static let pillTrailing: CGFloat = 16
    static let labelFontSize: CGFloat = 14
    static let tabCount = MainTab.allCases.count

    /// Side margin of the dock row: 16, or 12 below 360 wide.
    static func sideMargin(rowWidth: CGFloat) -> CGFloat { rowWidth < 360 ? 12 : 16 }

    /// The bar fills the row left of the chat orb (the whole row when the chat has its own pane).
    static func barWidth(rowWidth: CGFloat, withChat: Bool = true) -> CGFloat {
        rowWidth - 2 * sideMargin(rowWidth: rowWidth) - (withChat ? chatOrb + gap : 0)
    }

    /// Width of the active pill with its label.
    static func labelledPillWidth(labelWidth: CGFloat) -> CGFloat {
        pillLeading + icon + iconGap + labelWidth + pillTrailing
    }

    /// The label shows when `2 × 5 + 4 × 40 + pill ≤ barWidth`, and never at the accessibility text sizes
    /// (the dock offers the Large Content Viewer there). Never truncated or shrunk.
    static func showsLabel(labelWidth: CGFloat, rowWidth: CGFloat, accessibilitySize: Bool) -> Bool {
        guard !accessibilitySize, labelWidth > 0 else { return false }
        let needed = 2 * barPadding + CGFloat(tabCount - 1) * inactiveSlot + labelledPillWidth(labelWidth: labelWidth)
        return needed <= barWidth(rowWidth: rowWidth)
    }

    /// Slot widths left to right: the labelled active slot is as wide as its pill and the others share the rest;
    /// icon-only, all slots share the inner width equally.
    static func slotWidths(barWidth: CGFloat, activeIndex: Int, activePillWidth: CGFloat?) -> [CGFloat] {
        let inner = max(0, barWidth - 2 * barPadding)
        guard let pill = activePillWidth else {
            return Array(repeating: inner / CGFloat(tabCount), count: tabCount)
        }
        let others = max(inactiveSlot, (inner - pill) / CGFloat(tabCount - 1))
        return (0..<tabCount).map { $0 == activeIndex ? pill : others }
    }

    /// The label's width in the dock font (SF Pro Rounded, heavy) at the current text size.
    @MainActor static func measure(_ label: String, fontSize: CGFloat) -> CGFloat {
        let base = UIFont.systemFont(ofSize: fontSize, weight: .heavy)
        let font = base.fontDescriptor.withDesign(.rounded).map { UIFont(descriptor: $0, size: fontSize) } ?? base
        return ceil((label as NSString).size(withAttributes: [.font: font]).width)
    }
}

/// The mascot's four faces (§8.4).
enum MascotExpression: String, Sendable, CaseIterable {
    case curious, sleepy, cheering, worried

    /// Where it appears: every empty state is curious, a success is cheering, and the inline load error is sleepy
    /// while there is no connection (offline or unreachable) and worried while online (the server answered).
    enum Situation: Sendable { case empty, success, loadError(NetworkStatus) }

    static func `for`(_ situation: Situation) -> MascotExpression {
        switch situation {
        case .empty: .curious
        case .success: .cheering
        case .loadError(let status): status == .online ? .worried : .sleepy
        }
    }

    /// Face colour: the hue's onFill (white on grape and indigo, ink on the bright hues).
    static func faceIsWhite(_ hue: Hue) -> Bool { hue.onFill == .white }
}

/// Which hue the mascot wears on each empty state (§8.4): the feature colour, the bubble colour on Home and in
/// Chat, grape on Search and on load errors.
enum MascotPlace: Sendable {
    case home, chat, events, food, marketplace, links, search, loadError

    func hue(bubble: Hue) -> Hue {
        switch self {
        case .home, .chat: bubble
        case .events: .coral
        case .food: .tangerine
        case .marketplace: .mint
        case .links: .sky
        case .search, .loadError: .grape
        }
    }
}

/// One haptic vocabulary for every interaction (§8.3). Haptics follow the system setting and play under
/// Reduce Motion too.
enum Interaction: Sendable, CaseIterable {
    case tabSwitch, bubbleSwitch, add, success, smallSuccess, destructiveConfirm, error, refreshFinished
    case reactionAdded, reactionRemoved, send, rsvpTap, toggle

    var haptic: Haptic {
        switch self {
        case .tabSwitch, .toggle, .reactionRemoved: .selection
        case .bubbleSwitch: .impactMedium
        case .add, .reactionAdded, .send, .rsvpTap: .impactLight
        case .success, .smallSuccess, .refreshFinished: .success
        case .destructiveConfirm: .impactRigid
        case .error: .error
        }
    }
}

/// The `UIFeedbackGenerator` behind each haptic, and its SwiftUI `sensoryFeedback` equivalent.
enum Haptic: Sendable, Equatable {
    /// `UISelectionFeedbackGenerator.selectionChanged()`
    case selection
    /// `UIImpactFeedbackGenerator(style: .light / .medium / .rigid)`
    case impactLight, impactMedium, impactRigid
    /// `UINotificationFeedbackGenerator.notificationOccurred(.success / .error)`
    case success, error

    var feedback: SensoryFeedback {
        switch self {
        case .selection: .selection
        case .impactLight: .impact(weight: .light)
        case .impactMedium: .impact(weight: .medium)
        case .impactRigid: .impact(flexibility: .rigid)
        case .success: .success
        case .error: .error
        }
    }

    /// Plays it now (for actions without a state change to hang `sensoryFeedback` on, e.g. a confirm button).
    @MainActor func play() {
        switch self {
        case .selection: UISelectionFeedbackGenerator().selectionChanged()
        case .impactLight: UIImpactFeedbackGenerator(style: .light).impactOccurred()
        case .impactMedium: UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        case .impactRigid: UIImpactFeedbackGenerator(style: .rigid).impactOccurred()
        case .success: UINotificationFeedbackGenerator().notificationOccurred(.success)
        case .error: UINotificationFeedbackGenerator().notificationOccurred(.error)
        }
    }
}

extension Interaction {
    @MainActor func play() { haptic.play() }
}

extension View {
    /// `sensoryFeedback` for an interaction of the §8.3 table.
    func haptic<T: Equatable>(_ interaction: Interaction, trigger: T) -> some View {
        sensoryFeedback(interaction.haptic.feedback, trigger: trigger)
    }
}

/// Sticker "kind" labels on the Home feed (§8.5): fixed tilt per kind, upright at the accessibility sizes.
enum StickerKind: Sendable, CaseIterable {
    case chat, event, food, market, link

    var tilt: Double {
        switch self {
        case .chat: -3
        case .event: 2
        case .food: -2
        case .market: 3
        case .link: -2
        }
    }

    func tilt(accessibilitySize: Bool) -> Double { accessibilitySize ? 0 : tilt }

    var feature: Feature {
        switch self {
        case .chat: .chat
        case .event: .events
        case .food: .food
        case .market: .market
        case .link: .links
        }
    }
}
