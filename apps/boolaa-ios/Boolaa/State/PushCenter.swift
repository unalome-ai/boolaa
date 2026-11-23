import Foundation
import Observation
import UIKit
import UserNotifications

/// The OS permission for notifications, as Settings shows it.
enum PushPermission: Equatable, Sendable {
    case unknown, notDetermined, denied, allowed

    init(_ status: UNAuthorizationStatus) {
        switch status {
        case .notDetermined: self = .notDetermined
        case .denied: self = .denied
        case .authorized, .provisional, .ephemeral: self = .allowed
        @unknown default: self = .unknown
        }
    }
}

/// Owns this device's push state (docs/push-notifications.md §8, iOS): permission, the APNs token and its
/// registration with the backend, the tapped notification waiting to be routed, and the chat on screen.
/// One per app, reachable from the app delegate (`PushCenter.shared`).
@MainActor
@Observable
final class PushCenter {
    static let shared = PushCenter()

    private(set) var permission: PushPermission = .unknown
    /// Hex APNs token from the last `didRegisterForRemoteNotifications`.
    private(set) var deviceToken: String?
    /// A tapped notification, routed by the main shell once it is on screen.
    var pendingRoute: PushRoute?
    /// The bubble whose chat is on screen (no banner for its chat pushes).
    var visibleChatBubble: UUID?
    /// "Turn on notifications" card on Home dismissed.
    var promptDismissed: Bool {
        didSet { defaults.set(promptDismissed, forKey: Self.promptDismissedKey) }
    }

    @ObservationIgnored weak var session: SessionStore?
    /// The `(user, token, locale)` registered during this launch, so it's sent once per start (and again on change).
    @ObservationIgnored private(set) var registeredKey: String?
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored var registerForRemote: @MainActor () -> Void = { UIApplication.shared.registerForRemoteNotifications() }
    @ObservationIgnored var center: @MainActor () -> UNUserNotificationCenter? = { UNUserNotificationCenter.current() }
    private static let promptDismissedKey = "boolaa.pushPromptDismissed"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        promptDismissed = defaults.bool(forKey: Self.promptDismissedKey)
    }

    /// Signed in, device verified, age confirmed, not suspended: `register_push_token` will be accepted.
    var sessionReady: Bool {
        guard let session, session.userID != nil else { return false }
        return session.route == .main || session.route == .onboarding
    }

    /// Show the in-app explanation card (Home) only while iOS hasn't been asked yet.
    var shouldOfferPrompt: Bool { permission == .notDetermined && !promptDismissed }

    // MARK: Permission

    func refreshPermission() async {
        guard let center = center() else { return }
        permission = PushPermission(await center.notificationSettings().authorizationStatus)
    }

    /// Only ever called from a button ("Turn on notifications"): the OS prompt follows our own explanation.
    @discardableResult
    func requestPermission() async -> Bool {
        guard let center = center() else { return false }
        let granted = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        await refreshPermission()
        if granted { registerForRemote() }
        return granted
    }

    // MARK: Token registration

    /// Every app start and every sign-in once the gate is open: ask APNs for the token again (it hands back the
    /// current one), which in turn registers it. Never prompts.
    func sessionBecameReady() async {
        await refreshPermission()
        guard sessionReady, permission == .allowed else { return }
        registerForRemote()
        await registerIfNeeded()
    }

    /// `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)`.
    func didReceive(token: Data) async {
        let hex = PushRules.hex(token)
        if hex != deviceToken { registeredKey = nil }
        deviceToken = hex
        await registerIfNeeded()
    }

    func registerIfNeeded() async {
        guard sessionReady, let session, let userID = session.userID, let token = deviceToken else { return }
        let locale = AppLanguage.current.rawValue
        let key = "\(userID.uuidString)|\(token)|\(locale)"
        guard key != registeredKey else { return }
        do {
            try await session.api.registerPushToken(hexToken: token, apnsEnv: PushRules.apnsEnvironment,
                                                    deviceID: session.device.id, locale: locale,
                                                    appVersion: PushRules.appVersion())
            registeredKey = key
        } catch {
            // A client bug or offline: the next start tries again. Never shown to the user (§2: generic).
            _ = UserFacingError.classify(error)
        }
    }

    /// Before `signOut()`: remove this device's token. The server drops it with the session anyway,
    /// so a failure (offline) is harmless; never waits more than a few seconds.
    func unregisterBeforeSignOut(api: BoolaaAPI) async {
        defer { registeredKey = nil }
        guard registeredKey != nil, let token = deviceToken else { return }
        await withTaskGroup(of: Void.self) { group in
            group.addTask { try? await api.unregisterPushToken(token) }
            group.addTask { try? await Task.sleep(for: .seconds(3)) }
            await group.next()
            group.cancelAll()
        }
    }

    /// Account deleted: the rows went with the account (cascade); forget the local state only.
    func forgetRegistration() {
        registeredKey = nil
        pendingRoute = nil
    }

    // MARK: Notifications

    /// A tap on a notification. An approval first refreshes the bubbles (the new one isn't in the list yet).
    func open(_ payload: PushPayload) async {
        if payload.kind == .approval, let session, session.userID != nil { await session.reload() }
        pendingRoute = PushRoute(payload: payload)
    }

    func presentation(for payload: PushPayload?) -> UNNotificationPresentationOptions {
        let active = UIApplication.shared.applicationState == .active
        return PushRules.presentation(for: payload, visibleChat: active ? visibleChatBubble : nil)
    }

    /// Opening a bubble's chat clears its delivered chat notifications (`thread-id` = bubble id).
    func clearDelivered(bubbleID: UUID) async {
        guard let center = center() else { return }
        let thread = bubbleID.uuidString.lowercased()
        let ids = await center.deliveredNotifications()
            .filter { $0.request.content.threadIdentifier.lowercased() == thread
                && [PushKind.chat.category, PushKind.chatMention.category].contains($0.request.content.categoryIdentifier) }
            .map(\.request.identifier)
        if !ids.isEmpty { center.removeDeliveredNotifications(withIdentifiers: ids) }
    }
}
