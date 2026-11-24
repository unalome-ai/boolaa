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
    /// An `item_request` push: Food / Marketplace opens the owner's Requests sheet on this item once it has loaded.
    var openRequestsFor: UUID?
    /// A join-request notification: Settings scrolls to the pending requests.
    var scrollToRequests = false
    /// Text the chat composer picks up once when it opens ("Ask in chat" on a market item). Never sent automatically.
    var chatDraft: ChatDraft?
    /// The search sheet (docs/boolaa-spec.md, "Search").
    var showSearch = false
    /// A chat message opened from search: the chat loads the window around it, scrolls to it and rings it.
    var chatJump: UUID?
    /// Wide screens: the chat has its own pane beside the tab, so opening it pushes nothing.
    var chatEmbedded = false {
        didSet { if chatEmbedded { path.removeAll { $0 == .chat } } }
    }

    func open(_ destination: ShellDestination) {
        if destination == .chat && chatEmbedded { return }
        if path.last != destination { path.append(destination) }
    }

    /// Opens the bubble chat with `draft` in the composer.
    /// `mention`: the person named in it as "@Name" (the item's owner), made a token when they are a member.
    func openChat(draft: String, mention: UserProfile? = nil) {
        chatDraft = ChatDraft(text: draft, mention: mention)
        open(.chat)
    }

    /// Opens a search hit in context: its tab (or Links / the chat) with the row highlighted.
    func open(_ hit: SearchHit) {
        showSearch = false
        path = []
        switch hit.kind {
        case .chatMessage:
            chatJump = hit.id
            open(.chat)
        case .event: highlight = hit.id; tab = .events
        case .foodPost: highlight = hit.id; tab = .food
        case .marketItem: highlight = hit.id; tab = .marketplace
        case .sharedLink: highlight = hit.id; open(.links)
        }
    }

    /// Hands a pending chat jump to the chat exactly once.
    func takeChatJump() -> UUID? {
        defer { chatJump = nil }
        return chatJump
    }

    /// Hands the pending draft to the composer exactly once.
    func takeChatDraft() -> ChatDraft? {
        defer { chatDraft = nil }
        return chatDraft
    }
}

/// Text the chat composer picks up once, with the person it mentions.
struct ChatDraft: Equatable, Sendable {
    var text: String
    var mention: UserProfile?
}
