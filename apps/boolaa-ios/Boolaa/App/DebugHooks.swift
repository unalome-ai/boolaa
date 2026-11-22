import Foundation

/// Launch-argument hooks for automation and screenshots (DEBUG builds only).
///
///     -UITestAutoLogin alice@boolaa.test   sign in as this user (signs out a different user first)
///     -UITestPassword <pw>                 defaults to the seeded password "password123"
///     -UITestBubble "Climbing Crew"        select this bubble by name
///     -UITestTab events|food|marketplace|settings|home
///     -UITestOpen chat|links|profile|addBubble|report|blocked|deleteAccount
///     -UITestRegister YES                  start on the Create account form
///     -UITestSignOut YES                   start signed out
///
/// UserDefaults reads `-Key value` launch arguments automatically.
enum DebugHooks {
    @MainActor
    static func applyAutoLogin(session: SessionStore) async {
        #if DEBUG
        let defaults = UserDefaults.standard
        if defaults.bool(forKey: "UITestSignOut") {
            await session.signOut()
            return
        }
        guard let email = defaults.string(forKey: "UITestAutoLogin"), !email.isEmpty else { return }
        // Wait for the stored session to be restored before deciding.
        while session.isRestoringSession { try? await Task.sleep(for: .milliseconds(50)) }
        if session.email?.lowercased() != email.lowercased() {
            if session.userID != nil { await session.signOut() }
            let password = defaults.string(forKey: "UITestPassword") ?? "password123"
            do { try await session.signIn(email: email, password: password) } catch {
                session.lastError = "Auto-login failed: \(error.userMessage)"
            }
        }
        while session.userID != nil && session.memberships == nil { try? await Task.sleep(for: .milliseconds(50)) }
        if let name = defaults.string(forKey: "UITestBubble"),
           let bubble = session.bubbles.first(where: { $0.name == name }) {
            session.selectBubble(bubble.id)
        }
        #endif
    }

    static var initialTab: MainTab? {
        #if DEBUG
        UserDefaults.standard.string(forKey: "UITestTab").flatMap(MainTab.init(rawValue:))
        #else
        nil
        #endif
    }

    static var startOnRegister: Bool {
        #if DEBUG
        UserDefaults.standard.bool(forKey: "UITestRegister")
        #else
        false
        #endif
    }

    /// Profile-sheet screen to open once (blocked | deleteAccount), consumed on first read.
    @MainActor private static var profileOpenConsumed = false
    @MainActor static func consumeProfileOpen() -> String? {
        guard !profileOpenConsumed else { return nil }
        profileOpenConsumed = true
        return initialOpen
    }

    static var initialOpen: String? {
        #if DEBUG
        UserDefaults.standard.string(forKey: "UITestOpen")
        #else
        nil
        #endif
    }
}
