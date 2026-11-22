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
    /// A row a tapped notification points at (event, food post, market item): scrolled to and highlighted.
    var highlight: UUID?
    /// A join-request notification: Settings scrolls to the pending requests.
    var scrollToRequests = false
    /// Text the chat composer picks up once when it opens ("Ask in chat" on a market item). Never sent automatically.
    var chatDraft: String?

    func open(_ destination: ShellDestination) {
        if path.last != destination { path.append(destination) }
    }

    /// Opens the bubble chat with `draft` in the composer.
    func openChat(draft: String) {
        chatDraft = draft
        open(.chat)
    }

    /// Hands the pending draft to the composer exactly once.
    func takeChatDraft() -> String? {
        defer { chatDraft = nil }
        return chatDraft
    }
}
