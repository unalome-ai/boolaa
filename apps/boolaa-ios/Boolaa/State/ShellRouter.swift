import Foundation
import Observation

enum MainTab: String, CaseIterable, Identifiable, Sendable {
    case home, events, food, marketplace, settings
    var id: String { rawValue }
    var title: LocalizedStringResource {
        switch self {
        case .home: LocalizedStringResource("Home", comment: "Tab title")
        case .events: LocalizedStringResource("Events", comment: "Tab title")
        case .food: LocalizedStringResource("Food Circle", comment: "Tab title")
        case .marketplace: LocalizedStringResource("Marketplace", comment: "Tab title")
        case .settings: LocalizedStringResource("Settings", comment: "Tab title")
        }
    }
    /// Symbol for the selected state (not every symbol has a `.fill` variant, e.g. `calendar`).
    var activeIcon: String {
        switch self {
        case .home: "house.fill"
        case .events: "calendar"
        case .food: "fork.knife"
        case .marketplace: "tag.fill"
        case .settings: "gearshape.fill"
        }
    }
    var icon: String {
        switch self {
        case .home: "house"
        case .events: "calendar"
        case .food: "fork.knife"
        case .marketplace: "tag"
        case .settings: "gearshape"
        }
    }
}

enum ShellDestination: Hashable, Sendable {
    case chat, links
}

/// Navigation state of the main shell: selected tab, pushed screens, open sheets.
@MainActor
@Observable
final class ShellRouter {
    var tab: MainTab = .home
    var path: [ShellDestination] = []
    var showProfile = false
    var showAddBubble = false

    func open(_ destination: ShellDestination) {
        if path.last != destination { path.append(destination) }
    }
}
