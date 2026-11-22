import Foundation
import Supabase

// Device verification, age confirmation, sensitive-action codes and account status
// (docs/auth-security.md §2, §3, §6, §8; docs/moderation.md "Clients").

/// Terms version confirmed at sign-up and on the one-time 16+ screen.
let termsVersion = "2026-11-22"

/// Seconds before "Resend code" is enabled again (GoTrue `max_frequency` and the device-code limits).
let codeResendCooldown: TimeInterval = 60

/// `start_device_check` result.
struct DeviceCheck: Decodable, Equatable, Sendable {
    enum Status: String, Decodable, Sendable { case verified, codeRequired = "code_required" }
    var status: Status
    var needsAgeConfirmation: Bool

    enum CodingKeys: String, CodingKey { case status, needsAgeConfirmation = "needs_age_confirmation" }

    init(status: Status, needsAgeConfirmation: Bool = false) {
        self.status = status
        self.needsAgeConfirmation = needsAgeConfirmation
    }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // Anything but "verified" keeps the gate closed.
        status = (try? c.decode(Status.self, forKey: .status)) ?? .codeRequired
        needsAgeConfirmation = (try? c.decode(Bool.self, forKey: .needsAgeConfirmation)) ?? false
    }
}

/// A row of `list_my_devices()`.
struct TrustedDevice: Decodable, Identifiable, Hashable, Sendable {
    let deviceHash: String
    let label: String?
    let createdAt: Date?
    let lastSeenAt: Date?
    var id: String { deviceHash }
    enum CodingKeys: String, CodingKey { case deviceHash = "device_hash", label, createdAt = "created_at", lastSeenAt = "last_seen_at" }
}

/// The caller's own `users` row fields that the gate needs (readable once the device check passes, even when suspended).
struct AccountStatusRow: Decodable, Equatable, Sendable {
    var status: String?
    var statusReason: String?
    var statusUntil: Date?
    var ageConfirmedAt: Date?
    enum CodingKeys: String, CodingKey {
        case status, statusReason = "status_reason", statusUntil = "status_until", ageConfirmedAt = "age_confirmed_at"
    }
}

/// Why the account can't use Boolaa right now (docs/moderation.md).
struct Suspension: Equatable, Sendable {
    enum Kind: Equatable, Sendable {
        case suspended
        case banned
        /// Sign-in answered `user_banned`: no session, so no reason or date.
        case signInBlocked
    }
    var kind: Kind
    var until: Date?
    var reason: ReportReason?

    /// Same rule as the server's `is_account_active()`: inactive = banned, or suspended with no end or an end in the future.
    static func from(_ row: AccountStatusRow, now: Date = .now) -> Suspension? {
        let reason = row.statusReason.flatMap(ReportReason.init(rawValue:))
        switch row.status {
        case "banned": return Suspension(kind: .banned, until: nil, reason: reason)
        case "suspended":
            if let until = row.statusUntil, until <= now { return nil }
            return Suspension(kind: .suspended, until: row.statusUntil, reason: reason)
        default: return nil
        }
    }
}

/// What a code proves: signing in on a new device, or re-confirming a sensitive action in this session.
enum SensitiveAction: String, Sendable {
    case deleteAccount = "delete_account", changePassword = "change_password", changeEmail = "change_email", exportData = "export_data", generic
}

/// A `device-code` Edge Function failure: HTTP status, its `error` code and `attempts_left` for `invalid_code`.
struct DeviceCodeError: Error, Equatable, Sendable {
    var status: Int
    var code: String
    var attemptsLeft: Int?

    static func from(status: Int, body: Data) -> DeviceCodeError {
        struct Payload: Decodable { var error: String?; var attempts_left: Int? }
        let payload = try? JSONDecoder().decode(Payload.self, from: body)
        let code = payload?.error ?? (status == 401 ? "unauthorized" : "server_error")
        return DeviceCodeError(status: status, code: code, attemptsLeft: payload?.attempts_left)
    }
}

/// The routing decision after `start_device_check` (pure, unit tested).
enum DeviceGateDecision: Equatable, Sendable {
    case code, age, suspended(Suspension), ok

    /// - Parameters:
    ///   - deviceVerified: `is_device_verified()`; only asked when the check said `code_required`. A `code_required`
    ///     device only blocks while enforcement is on, so nobody gets a code before the rollout switch (same rule as web).
    ///   - account: the own `users` row, nil when it couldn't be read.
    ///   - isOAuthUser: Google/Apple accounts never saw the sign-up checkbox, so they confirm 16+ once even before
    ///     `age_confirmation_required` is on.
    static func decide(check: DeviceCheck, deviceVerified: Bool?, account: AccountStatusRow?, isOAuthUser: Bool, now: Date = .now) -> DeviceGateDecision {
        if check.status == .codeRequired && deviceVerified != true { return .code }
        if let account, let suspension = Suspension.from(account, now: now) { return .suspended(suspension) }
        if check.needsAgeConfirmation { return .age }
        if isOAuthUser, let account, account.ageConfirmedAt == nil { return .age }
        return .ok
    }
}

extension BoolaaAPI {
    func startDeviceCheck(_ device: DeviceIdentity) async throws -> DeviceCheck {
        struct Params: Encodable { let p_device_id: String; let p_label: String }
        return try await client.rpc("start_device_check", params: Params(p_device_id: device.id, p_label: device.label)).execute().value
    }

    func isDeviceVerified() async throws -> Bool {
        try await client.rpc("is_device_verified").execute().value
    }

    func accountStatus(userID: UUID) async throws -> AccountStatusRow? {
        let rows: [AccountStatusRow] = try await client.from("users")
            .select("status, status_reason, status_until, age_confirmed_at")
            .eq("id", value: userID).limit(1).execute().value
        return rows.first
    }

    func listMyDevices() async throws -> [TrustedDevice] {
        try await client.rpc("list_my_devices").execute().value
    }

    @discardableResult
    func revokeDevice(hash: String) async throws -> Bool {
        struct Params: Encodable { let p_device_hash: String }
        return try await client.rpc("revoke_device", params: Params(p_device_hash: hash)).execute().value
    }

    func confirmAge() async throws {
        struct Params: Encodable { let p_terms_version: String }
        try await client.rpc("confirm_age", params: Params(p_terms_version: termsVersion)).execute()
    }

    // MARK: device-code Edge Function

    /// The JSON body of a `device-code` call (pure, so the wire format is unit tested).
    enum DeviceCodeBody {
        static func sendDevice(_ device: DeviceIdentity, locale: String) -> [String: String] {
            ["action": "send", "purpose": "device", "device_id": device.id, "label": device.label, "locale": locale]
        }
        static func verifyDevice(_ device: DeviceIdentity, code: String) -> [String: String] {
            ["action": "verify", "purpose": "device", "device_id": device.id, "label": device.label, "code": code]
        }
        static func sendSensitive(_ action: SensitiveAction, locale: String) -> [String: String] {
            ["action": "send", "purpose": "sensitive_action", "sensitive_action": action.rawValue, "locale": locale]
        }
        static func verifySensitive(code: String) -> [String: String] {
            ["action": "verify", "purpose": "sensitive_action", "code": code]
        }
    }

    /// Calls `device-code`. A 401 refreshes the session and retries once, as the contract asks; a second 401 is thrown.
    func deviceCode(_ body: [String: String]) async throws {
        do {
            try await invokeDeviceCode(body)
        } catch let error as DeviceCodeError where error.status == 401 {
            guard (try? await client.auth.refreshSession()) != nil else { throw error }
            try await invokeDeviceCode(body)
        }
    }

    private func invokeDeviceCode(_ body: [String: String]) async throws {
        do {
            try await client.functions.invoke("device-code", options: FunctionInvokeOptions(body: body))
        } catch FunctionsError.httpError(let code, let data) {
            throw DeviceCodeError.from(status: code, body: data)
        }
    }
}

/// Signals raised wherever a backend error is mapped: "session not verified" (e.g. another device revoked this
/// one) sends the user back to the code screen, "account suspended" to the suspended screen.
@MainActor
enum SecurityEvents {
    enum Kind: Sendable { case sessionNotVerified, accountSuspended }
    static var handler: ((Kind) -> Void)?

    nonisolated static func post(_ kind: Kind) {
        Task { @MainActor in handler?(kind) }
    }
}
