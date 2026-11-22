import Foundation
import Supabase

/// Push tokens, notification settings and bubble mutes (docs/push-notifications.md §2, §9).
extension BoolaaAPI {
    /// Upserts this device's APNs token (hex) for the caller. Needs a verified session.
    @discardableResult
    func registerPushToken(hexToken: String, apnsEnv: String, deviceID: String, locale: String, appVersion: String?) async throws -> UUID {
        struct Params: Encodable {
            let p_platform = "ios"
            let p_token: String
            let p_apns_env: String
            let p_device_id: String
            let p_locale: String
            let p_app_version: String?
        }
        return try await client.rpc("register_push_token", params: Params(
            p_token: hexToken, p_apns_env: apnsEnv, p_device_id: deviceID, p_locale: locale, p_app_version: appVersion
        )).execute().value
    }

    /// Deletes the caller's row with this token. Call before signing out (signing out drops it server-side too).
    func unregisterPushToken(_ token: String) async throws {
        struct Params: Encodable { let p_token: String }
        try await client.rpc("unregister_push_token", params: Params(p_token: token)).execute()
    }

    /// The caller's prefs row; the defaults when there is none yet.
    func notificationPrefs(userID: UUID) async throws -> NotificationPrefs {
        let rows: [NotificationPrefs] = try await client.from("notification_prefs")
            .select("user_id, enabled, chat, join_requests, approvals, new_events, event_reminders, food, market, preview_content")
            .eq("user_id", value: userID).limit(1).execute().value
        return rows.first ?? NotificationPrefs(userId: userID)
    }

    /// Writes the whole row (insert if missing, else update).
    func saveNotificationPrefs(_ prefs: NotificationPrefs) async throws {
        try await client.from("notification_prefs").upsert(prefs, onConflict: "user_id").execute()
    }

    func bubbleMute(userID: UUID, bubbleID: UUID) async throws -> BubbleMute? {
        let rows: [BubbleMute] = try await client.from("bubble_mutes").select("user_id, bubble_id, until")
            .eq("user_id", value: userID).eq("bubble_id", value: bubbleID).limit(1).execute().value
        return rows.first
    }

    /// `until` nil = until turned back on.
    func muteBubble(userID: UUID, bubbleID: UUID, until: Date?) async throws {
        struct Row: Encodable {
            let user_id: UUID
            let bubble_id: UUID
            let until: Date?
            // Encode `until: null` explicitly so a timed mute can become an open-ended one.
            func encode(to encoder: any Encoder) throws {
                var c = encoder.container(keyedBy: CodingKeys.self)
                try c.encode(user_id, forKey: .user_id)
                try c.encode(bubble_id, forKey: .bubble_id)
                if let until { try c.encode(until, forKey: .until) } else { try c.encodeNil(forKey: .until) }
            }
            enum CodingKeys: String, CodingKey { case user_id, bubble_id, until }
        }
        try await client.from("bubble_mutes")
            .upsert(Row(user_id: userID, bubble_id: bubbleID, until: until), onConflict: "user_id,bubble_id").execute()
    }

    func unmuteBubble(userID: UUID, bubbleID: UUID) async throws {
        try await client.from("bubble_mutes").delete().eq("user_id", value: userID).eq("bubble_id", value: bubbleID).execute()
    }
}
