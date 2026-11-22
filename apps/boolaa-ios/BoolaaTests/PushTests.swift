import Foundation
import Testing
import UserNotifications
@testable import Boolaa

/// Push notification client logic (docs/push-notifications.md §5, §8, §9).
@Suite("Push payloads and routing")
struct PushPayloadTests {
    private let bubble = UUID()
    private let target = UUID()

    @Test func parsesTheDeepLinkFields() throws {
        let info: [AnyHashable: Any] = ["aps": ["alert": ["title": "Ana in Flatmates"]], "type": "new_event",
                                        "bubble_id": bubble.uuidString.lowercased(), "target_id": target.uuidString.lowercased()]
        let payload = try #require(PushPayload(userInfo: info))
        #expect(payload == PushPayload(kind: .newEvent, bubbleID: bubble, targetID: target))
    }

    @Test func rejectsForeignOrBrokenPayloads() {
        #expect(PushPayload(userInfo: [:]) == nil)
        #expect(PushPayload(userInfo: ["type": "poke", "bubble_id": bubble.uuidString]) == nil)
        #expect(PushPayload(userInfo: ["type": "chat", "bubble_id": "not-a-uuid"]) == nil)
        #expect(PushPayload(userInfo: ["type": "chat"]) == nil)
        let noTarget = PushPayload(userInfo: ["type": "approval", "bubble_id": bubble.uuidString, "target_id": "x"])
        #expect(noTarget?.targetID == nil)
    }

    @Test(arguments: [
        (PushKind.chat, PushDestination.chat, false),
        (.joinRequest, .joinRequests, false),
        (.approval, .home, false),
        (.newEvent, .events, true),
        (.eventReminder, .events, true),
        (.food, .food, true),
        (.market, .marketplace, true),
    ])
    func routesEveryType(kind: PushKind, destination: PushDestination, highlights: Bool) {
        let route = PushRoute(payload: PushPayload(kind: kind, bubbleID: bubble, targetID: target))
        let resolved = route.resolve(joined: [bubble, UUID()])
        #expect(resolved.bubble == bubble)
        #expect(resolved.destination == destination)
        #expect(resolved.highlight == (highlights ? target : nil))
    }

    @Test func aBubbleYouLeftOpensHomeWithoutSwitching() {
        let route = PushRoute(payload: PushPayload(kind: .chat, bubbleID: bubble, targetID: target))
        let resolved = route.resolve(joined: [UUID()])
        #expect(resolved.bubble == nil)
        #expect(resolved.destination == .home)
        #expect(resolved.highlight == nil)
    }

    @Test func everyTapIsANewRoute() {
        let payload = PushPayload(kind: .chat, bubbleID: bubble)
        #expect(PushRoute(payload: payload) != PushRoute(payload: payload))
    }

    @Test func noBannerForTheChatOnScreen() {
        let chat = PushPayload(kind: .chat, bubbleID: bubble)
        #expect(PushRules.presentation(for: chat, visibleChat: bubble).isEmpty)
        #expect(PushRules.presentation(for: chat, visibleChat: UUID()).contains(.banner))
        #expect(PushRules.presentation(for: chat, visibleChat: nil).contains(.banner))
        // Other types of the same bubble still show.
        #expect(PushRules.presentation(for: PushPayload(kind: .newEvent, bubbleID: bubble), visibleChat: bubble).contains(.banner))
        #expect(PushRules.presentation(for: nil, visibleChat: bubble) == [.banner, .list, .sound])
    }

    @Test func categoriesMatchTheBackend() {
        #expect(Set(PushRules.categories.map(\.identifier)) ==
                ["CHAT_MESSAGE", "JOIN_REQUEST", "BUBBLE_JOINED", "NEW_EVENT", "EVENT_REMINDER", "FOOD_POST", "MARKET_ITEM"])
    }
}

@Suite("Push token")
struct PushTokenTests {
    @Test func hexEncodesTheAPNsToken() {
        #expect(PushRules.hex(Data([0x00, 0x0f, 0xab, 0xff])) == "000fabff")
        let token = Data((0..<32).map { UInt8($0 * 7 % 256) })
        let hex = PushRules.hex(token)
        #expect(hex.count == 64)
        #expect(hex.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil, "what register_push_token accepts")
    }

    @Test func debugBuildsUseTheSandbox() {
        // Tests run the Debug configuration; Release (TestFlight, App Store, Ad Hoc) is "production".
        #expect(PushRules.apnsEnvironment == "sandbox")
    }

    @Test func appVersionFitsTheColumn() {
        #expect(PushRules.appVersion(["CFBundleShortVersionString": "1.2", "CFBundleVersion": "34"]) == "1.2 (34)")
        #expect(PushRules.appVersion(["CFBundleShortVersionString": "1.2"]) == "1.2")
        #expect(PushRules.appVersion([:]) == nil)
        #expect(PushRules.appVersion(["CFBundleShortVersionString": String(repeating: "9", count: 40)])?.count == 32)
    }

    @Test func permissionMapping() {
        #expect(PushPermission(.notDetermined) == .notDetermined)
        #expect(PushPermission(.denied) == .denied)
        #expect(PushPermission(.authorized) == .allowed)
        #expect(PushPermission(.provisional) == .allowed)
    }
}

@Suite("Notification settings and mutes")
struct NotificationSettingsTests {
    @Test func muteDurations() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        #expect(MuteDuration.hour.until(from: now) == now.addingTimeInterval(3600))
        #expect(MuteDuration.eightHours.until(from: now) == now.addingTimeInterval(8 * 3600))
        #expect(MuteDuration.week.until(from: now) == now.addingTimeInterval(7 * 86400))
        #expect(MuteDuration.forever.until(from: now) == nil)
    }

    @Test func expiredMutesNoLongerCount() {
        let now = Date()
        let me = UUID(), bubble = UUID()
        #expect(BubbleMute(userId: me, bubbleId: bubble, until: nil).isActive(now: now))
        #expect(BubbleMute(userId: me, bubbleId: bubble, until: now.addingTimeInterval(60)).isActive(now: now))
        #expect(!BubbleMute(userId: me, bubbleId: bubble, until: now.addingTimeInterval(-60)).isActive(now: now))
    }

    @Test func prefsRowCoding() throws {
        let id = UUID()
        let json = """
        {"user_id":"\(id.uuidString)","enabled":true,"chat":false,"join_requests":true,"approvals":true,
         "new_events":false,"event_reminders":true,"food":true,"market":false,"preview_content":false}
        """
        let prefs = try BoolaaJSON.decoder.decode(NotificationPrefs.self, from: Data(json.utf8))
        #expect(!prefs.chat && !prefs.newEvents && prefs.food && !prefs.previewContent)
        let encoded = try JSONSerialization.jsonObject(with: BoolaaJSON.encoder.encode(prefs)) as? [String: Any]
        #expect(Set(encoded?.keys.map { $0 } ?? []) == ["user_id", "enabled", "chat", "join_requests", "approvals",
                                                        "new_events", "event_reminders", "food", "market", "preview_content"])
        // Defaults match the backend: everything on except food and market.
        let defaults = NotificationPrefs(userId: id)
        #expect(defaults.enabled && defaults.chat && defaults.joinRequests && defaults.approvals && defaults.newEvents
                && defaults.eventReminders && !defaults.food && !defaults.market && defaults.previewContent)
        #expect(NotificationPrefs.toggles.count == 7)
    }

    @Test(arguments: [
        ("ro", "Pune bula pe silențios", "Permite notificările", "Până o reactivez"),
        ("fr", "Mettre la bulle en sourdine", "Autoriser les notifications", "Jusqu'à ce que je la réactive"),
        ("es", "Silenciar la burbuja", "Permitir notificaciones", "Hasta que la reactive"),
        ("it", "Silenzia la bolla", "Consenti le notifiche", "Finché non la riattivo"),
        ("en", "Mute this bubble", "Allow notifications", "Until I turn it back on"),
    ])
    func stringsFollowTheGlossary(lang: String, mute: String, allow: String, forever: String) throws {
        let path = try #require(Bundle.main.path(forResource: lang, ofType: "lproj"))
        let bundle = try #require(Bundle(path: path))
        #expect(bundle.localizedString(forKey: "Mute this bubble", value: nil, table: nil) == mute)
        #expect(bundle.localizedString(forKey: "Allow notifications", value: nil, table: nil) == allow)
        #expect(bundle.localizedString(forKey: MuteDuration.forever.title.key, value: nil, table: nil) == forever)
        let until = String(localized: "Muted until \("X")", bundle: bundle, locale: Locale(identifier: lang))
        #expect(until.contains("X") && (lang == "en" || !until.hasPrefix("Muted")))
    }
}
