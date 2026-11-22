import Foundation
import UserNotifications

/// Push notification contract (docs/push-notifications.md §5, §8): pure parsing and routing rules,
/// kept free of UIKit state so they can be unit tested.

/// The `type` field of a push.
enum PushKind: String, CaseIterable, Sendable {
    case chat
    case joinRequest = "join_request"
    case approval
    case newEvent = "new_event"
    case eventReminder = "event_reminder"
    case food
    case market

    /// The iOS category the backend puts in `aps.category`.
    var category: String {
        switch self {
        case .chat: "CHAT_MESSAGE"
        case .joinRequest: "JOIN_REQUEST"
        case .approval: "BUBBLE_JOINED"
        case .newEvent: "NEW_EVENT"
        case .eventReminder: "EVENT_REMINDER"
        case .food: "FOOD_POST"
        case .market: "MARKET_ITEM"
        }
    }

    /// Where a tap on this push leads (§5).
    var destination: PushDestination {
        switch self {
        case .chat: .chat
        case .joinRequest: .joinRequests
        case .approval: .home
        case .newEvent, .eventReminder: .events
        case .food: .food
        case .market: .marketplace
        }
    }

    /// Types whose `target_id` is a row the destination screen highlights.
    var highlightsTarget: Bool {
        switch self {
        case .newEvent, .eventReminder, .food, .market: true
        case .chat, .joinRequest, .approval: false
        }
    }
}

enum PushDestination: Equatable, Sendable {
    case home, chat, joinRequests, events, food, marketplace
}

/// `{ type, bubble_id, target_id }` from a notification's `userInfo` (strings, top level next to `aps`).
struct PushPayload: Equatable, Sendable {
    let kind: PushKind
    let bubbleID: UUID
    let targetID: UUID?

    init(kind: PushKind, bubbleID: UUID, targetID: UUID? = nil) {
        self.kind = kind
        self.bubbleID = bubbleID
        self.targetID = targetID
    }

    /// nil for anything that isn't a Boolaa push (unknown type, missing or malformed bubble id).
    nonisolated init?(userInfo: [AnyHashable: Any]) {
        guard let rawType = userInfo["type"] as? String, let kind = PushKind(rawValue: rawType),
              let rawBubble = userInfo["bubble_id"] as? String, let bubbleID = UUID(uuidString: rawBubble) else { return nil }
        self.kind = kind
        self.bubbleID = bubbleID
        self.targetID = (userInfo["target_id"] as? String).flatMap(UUID.init(uuidString:))
    }
}

/// What the main shell does after a tap.
struct PushRoute: Equatable, Identifiable, Sendable {
    let id = UUID()
    let payload: PushPayload

    /// Resolves the screen: a bubble the user is no longer in (left, removed) opens Home without switching.
    func resolve(joined: Set<UUID>) -> (bubble: UUID?, destination: PushDestination, highlight: UUID?) {
        guard joined.contains(payload.bubbleID) else { return (nil, .home, nil) }
        return (payload.bubbleID, payload.kind.destination, payload.kind.highlightsTarget ? payload.targetID : nil)
    }

    static func == (a: PushRoute, b: PushRoute) -> Bool { a.id == b.id }
}

enum PushRules {
    /// Foreground presentation: no banner for a chat push of the chat already on screen (§8 rule 4).
    nonisolated static func presentation(for payload: PushPayload?, visibleChat: UUID?) -> UNNotificationPresentationOptions {
        if let payload, payload.kind == .chat, payload.bubbleID == visibleChat { return [] }
        return [.banner, .list, .sound]
    }

    /// The APNs device token as lowercase hex (what `register_push_token` expects for iOS).
    nonisolated static func hex(_ token: Data) -> String {
        token.map { String(format: "%02x", $0) }.joined()
    }

    /// `sandbox` for Debug builds run from Xcode (development-signed), `production` for TestFlight,
    /// App Store and Ad Hoc (all Release builds).
    nonisolated static var apnsEnvironment: String {
        #if DEBUG
        "sandbox"
        #else
        "production"
        #endif
    }

    /// `CFBundleShortVersionString (CFBundleVersion)`, at most 32 characters (the column's limit).
    nonisolated static func appVersion(_ info: [String: Any]? = Bundle.main.infoDictionary) -> String? {
        guard let short = info?["CFBundleShortVersionString"] as? String else { return nil }
        let build = info?["CFBundleVersion"] as? String
        return String((build.map { "\(short) (\($0))" } ?? short).prefix(32))
    }

    /// Every category the backend sends. No actions yet (Reply / Approve are possible later additions).
    nonisolated static var categories: Set<UNNotificationCategory> {
        Set(PushKind.allCases.map { UNNotificationCategory(identifier: $0.category, actions: [], intentIdentifiers: []) })
    }
}

// MARK: Settings rows

/// `notification_prefs`: one row per user (created by a trigger; no row means these defaults).
struct NotificationPrefs: Codable, Equatable, Sendable {
    var userId: UUID
    var enabled = true
    var chat = true
    var joinRequests = true
    var approvals = true
    var newEvents = true
    var eventReminders = true
    var food = false
    var market = false
    var previewContent = true

    init(userId: UUID) { self.userId = userId }

    enum CodingKeys: String, CodingKey {
        case enabled, chat, approvals, food, market
        case userId = "user_id"
        case joinRequests = "join_requests"
        case newEvents = "new_events"
        case eventReminders = "event_reminders"
        case previewContent = "preview_content"
    }

    /// The per-type switches in Settings order, with their labels (docs/push-notifications.md §9).
    static var toggles: [(key: WritableKeyPath<NotificationPrefs, Bool>, title: LocalizedStringResource, id: String)] { [
        (\.chat, LocalizedStringResource("Chat messages", comment: "Notification setting"), "chat"),
        (\.joinRequests, LocalizedStringResource("Join requests", comment: "Notification setting"), "join-requests"),
        (\.approvals, LocalizedStringResource("My request was approved", comment: "Notification setting"), "approvals"),
        (\.newEvents, LocalizedStringResource("New events", comment: "Notification setting"), "new-events"),
        (\.eventReminders, LocalizedStringResource("Event reminders (1 hour before)", comment: "Notification setting"), "event-reminders"),
        (\.food, LocalizedStringResource("Food Circle", comment: "Tab title"), "food"),
        (\.market, LocalizedStringResource("Marketplace", comment: "Tab title"), "market"),
    ] }
}

/// `bubble_mutes`: `until` nil = muted until turned back on.
struct BubbleMute: Codable, Equatable, Sendable {
    let userId: UUID
    let bubbleId: UUID
    var until: Date?

    enum CodingKeys: String, CodingKey {
        case until
        case userId = "user_id"
        case bubbleId = "bubble_id"
    }

    /// A mute whose `until` has passed no longer silences anything (the server ignores it too).
    func isActive(now: Date = .now) -> Bool { until.map { $0 > now } ?? true }
}

/// The mute choices in Bubble settings.
enum MuteDuration: String, CaseIterable, Identifiable, Sendable {
    case hour, eightHours, week, forever
    var id: String { rawValue }

    func until(from now: Date = .now) -> Date? {
        switch self {
        case .hour: now.addingTimeInterval(3600)
        case .eightHours: now.addingTimeInterval(8 * 3600)
        case .week: now.addingTimeInterval(7 * 24 * 3600)
        case .forever: nil
        }
    }

    var title: LocalizedStringResource {
        switch self {
        case .hour: LocalizedStringResource("1 hour", comment: "Mute duration")
        case .eightHours: LocalizedStringResource("8 hours", comment: "Mute duration")
        case .week: LocalizedStringResource("1 week", comment: "Mute duration")
        case .forever: LocalizedStringResource("Until I turn it back on", comment: "Mute duration")
        }
    }
}
