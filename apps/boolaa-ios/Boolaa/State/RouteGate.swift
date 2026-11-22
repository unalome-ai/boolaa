import Foundation

/// Top-level destinations decided by the routing gate (spec §2, docs/auth-security.md §8, docs/moderation.md).
enum AppRoute: Equatable, Sendable {
    /// Restoring a stored session, running the device check or loading the user's bubbles.
    case launching
    case auth
    /// A reset code signed the user in; they still choose the new password.
    case resetPassword
    /// "Check your email": this device needs the emailed code.
    case deviceCode
    /// One-time "I'm 16 or older" + Terms.
    case ageConfirmation
    /// The account is suspended or banned.
    case suspended
    case onboarding
    case main
}

/// Where the signed-in session stands in the device check (`start_device_check`).
enum DeviceGateState: Equatable, Sendable {
    case checking, codeRequired, verified
    /// The check itself failed (offline, server error); the code screen shows "Try again".
    case failed
}

/// Pure routing rules, kept separate from `SessionStore` so they can be unit tested.
enum RouteGate {
    struct Input: Equatable, Sendable {
        var isRestoringSession: Bool
        var isSignedIn: Bool
        /// nil until the memberships for the signed-in user have loaded.
        var approvedBubbleCount: Int?
        var deviceGate: DeviceGateState = .verified
        var needsAgeConfirmation = false
        var recoveringPassword = false
        /// Suspended or banned (signed in), or sign-in answered `user_banned` (signed out).
        var suspended = false
    }

    static func resolve(_ input: Input) -> AppRoute {
        if input.isRestoringSession { return .launching }
        guard input.isSignedIn else { return input.suspended ? .suspended : .auth }
        if input.recoveringPassword { return .resetPassword }
        // Unverified sessions never reach the bubble screens.
        switch input.deviceGate {
        case .checking: return .launching
        case .codeRequired, .failed: return .deviceCode
        case .verified: break
        }
        if input.suspended { return .suspended }
        if input.needsAgeConfirmation { return .ageConfirmation }
        guard let count = input.approvedBubbleCount else { return .launching }
        return count == 0 ? .onboarding : .main
    }

    /// Chooses the current bubble: keep the stored one if still approved, else the first approved bubble.
    static func pickCurrentBubble(stored: UUID?, approved: [Bubble]) -> Bubble? {
        if let stored, let match = approved.first(where: { $0.id == stored }) { return match }
        return approved.first
    }

    /// Send a code on entering the code screen, unless one went out less than `cooldown` ago (§8.2).
    static func shouldAutoSend(lastSentAt: Date?, now: Date = .now, cooldown: TimeInterval = codeResendCooldown) -> Bool {
        guard let lastSentAt else { return true }
        return now.timeIntervalSince(lastSentAt) >= cooldown
    }

    /// Whole seconds left before "Resend code" is enabled again.
    static func resendSecondsLeft(lastSentAt: Date?, now: Date = .now, cooldown: TimeInterval = codeResendCooldown) -> Int {
        guard let lastSentAt else { return 0 }
        return max(0, Int((cooldown - now.timeIntervalSince(lastSentAt)).rounded(.up)))
    }
}
