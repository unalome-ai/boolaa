import Foundation
import Supabase
import Testing
@testable import Boolaa

/// The iOS push client against the local backend (20261122200000_push_notifications.sql): token registration
/// through the app's own API calls, notification prefs, bubble mutes and unregistering. Two throwaway users
/// (signed up here, never the seeded ones) in a throwaway bubble.
///
/// The dispatcher runs in dry-run mode locally: a chat message from the owner queues a push for the member's
/// fake token (prefix `c0ffee`), visible in `push_debug_log` / `notification_outbox` (service role only):
///     select provider, title, body, collapse_key, request->'body'->>'type' from push_debug_log
///      where token like 'c0ffee%' order by id desc limit 5;
@Suite("Push client (local backend)", .serialized)
struct PushIntegrationTests {
    private func newUser(_ name: String, locale: String) async throws -> (api: BoolaaAPI, id: UUID) {
        let client = Backend.makeClient(config: try AppConfig.load(), authStorage: InMemoryAuthStorage())
        let email = "push-ios-\(UUID().uuidString.prefix(8).lowercased())@boolaa.test"
        let response = try await client.auth.signUp(email: email, password: "password123",
                                                    data: SessionStore.signUpMetadata(name: name, locale: locale))
        let session = try #require(response.session, "local sign-up returns a session (confirmations off)")
        let api = BoolaaAPI(client: client)
        let device = DeviceIdentity.load(store: MemoryDeviceSecretStore(), label: "iPhone · tests", override: "push-ios-\(UUID().uuidString)")
        _ = try await api.startDeviceCheck(device)
        return (api, session.user.id)
    }

    private struct TokenRow: Decodable { let platform: String; let token: String; let apns_env: String?; let locale: String?; let app_version: String? }

    @Test(.timeLimit(.minutes(2)))
    func registerPrefsMuteAndUnregister() async throws {
        let owner = try await newUser("Ana", locale: "en")
        let member = try await newUser("Radu", locale: "ro")
        let bubble = try await owner.api.createBubble(name: "zz push \(UUID().uuidString.prefix(6))", description: nil, maxSize: 4)
        let request = try await member.api.requestToJoin(inviteCode: bubble.inviteCode)
        _ = try await owner.api.approveJoinRequest(id: request.id)

        // What didRegisterForRemoteNotificationsWithDeviceToken produces, through the same call PushCenter makes.
        let hex = "c0ffee" + PushRules.hex(Data((0..<29).map { _ in UInt8.random(in: 0...255) }))
        try await member.api.registerPushToken(hexToken: hex, apnsEnv: PushRules.apnsEnvironment,
                                               deviceID: "push-ios-device-\(UUID().uuidString)", locale: "ro",
                                               appVersion: PushRules.appVersion())
        // Registering again (every app start) is an upsert, not a second row.
        try await member.api.registerPushToken(hexToken: hex, apnsEnv: PushRules.apnsEnvironment,
                                               deviceID: "push-ios-device-\(UUID().uuidString)", locale: "ro",
                                               appVersion: PushRules.appVersion())
        let rows: [TokenRow] = try await member.api.client.from("push_tokens")
            .select("platform, token, apns_env, locale, app_version").execute().value
        #expect(rows.count == 1)
        #expect(rows.first?.platform == "ios")
        #expect(rows.first?.token == hex)
        #expect(rows.first?.apns_env == "sandbox")
        #expect(rows.first?.locale == "ro")
        #expect(rows.first?.app_version == PushRules.appVersion())

        // Prefs: the trigger-created row with the backend defaults, then a round trip.
        var prefs = try await member.api.notificationPrefs(userID: member.id)
        #expect(prefs == NotificationPrefs(userId: member.id))
        prefs.food = true
        prefs.previewContent = false
        try await member.api.saveNotificationPrefs(prefs)
        #expect(try await member.api.notificationPrefs(userID: member.id) == prefs)
        prefs.previewContent = true
        try await member.api.saveNotificationPrefs(prefs)

        // Mutes: timed, then open-ended (explicit null replaces the time), then unmuted.
        let hour = MuteDuration.hour.until()
        try await member.api.muteBubble(userID: member.id, bubbleID: bubble.id, until: hour)
        let timed = try #require(try await member.api.bubbleMute(userID: member.id, bubbleID: bubble.id))
        #expect(abs((timed.until ?? .distantPast).timeIntervalSince(hour!)) < 1)
        try await member.api.muteBubble(userID: member.id, bubbleID: bubble.id, until: nil)
        let forever = try #require(try await member.api.bubbleMute(userID: member.id, bubbleID: bubble.id))
        #expect(forever.until == nil && forever.isActive())
        try await member.api.unmuteBubble(userID: member.id, bubbleID: bubble.id)
        #expect(try await member.api.bubbleMute(userID: member.id, bubbleID: bubble.id) == nil)
        // A bubble you're not in can't be muted (RLS).
        await #expect(throws: (any Error).self) {
            try await owner.api.muteBubble(userID: owner.id, bubbleID: UUID(), until: nil)
        }

        // A message from the owner queues a push for the member's token; give the dry-run dispatcher a moment.
        _ = try await owner.api.sendMessage(bubbleID: bubble.id, senderID: owner.id, content: "Pizza tonight?")
        try await Task.sleep(for: .seconds(6))

        // Sign-out path: the token is gone.
        try await member.api.unregisterPushToken(hex)
        let after: [TokenRow] = try await member.api.client.from("push_tokens").select("platform, token, apns_env, locale, app_version").execute().value
        #expect(after.isEmpty)

        try? await member.api.leaveBubble(bubbleID: bubble.id, userID: member.id)
        try? await owner.api.leaveBubble(bubbleID: bubble.id, userID: owner.id)
    }
}
