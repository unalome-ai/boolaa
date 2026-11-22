import Foundation

/// Top-level destinations decided by the routing gate (spec §2).
enum AppRoute: Equatable, Sendable {
    /// Restoring a stored session or loading the user's bubbles.
    case launching
    case auth
    case onboarding
    case main
}

/// Pure routing rules, kept separate from `SessionStore` so they can be unit tested.
enum RouteGate {
    struct Input: Equatable, Sendable {
        var isRestoringSession: Bool
        var isSignedIn: Bool
        /// nil until the memberships for the signed-in user have loaded.
        var approvedBubbleCount: Int?
    }

    static func resolve(_ input: Input) -> AppRoute {
        if input.isRestoringSession { return .launching }
        guard input.isSignedIn else { return .auth }
        guard let count = input.approvedBubbleCount else { return .launching }
        return count == 0 ? .onboarding : .main
    }

    /// Chooses the current bubble: keep the stored one if still approved, else the first approved bubble.
    static func pickCurrentBubble(stored: UUID?, approved: [Bubble]) -> Bubble? {
        if let stored, let match = approved.first(where: { $0.id == stored }) { return match }
        return approved.first
    }
}
