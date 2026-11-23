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
///     -UITestOnboarding join|create        onboarding starts on this form
///     -UITestJoinCode FLAT2026             pre-fills the invite code field
///     -UITestBubbleName "Flat 4B"          pre-fills the Create a bubble form (with -UITestBubbleDescription)
///     -UITestScrollTo requests             Settings scrolls to the pending join requests
///     -UITestDeviceID boolaa-test-device   use this device id instead of the Keychain one (the seed trusts it)
///     -UITestOpen security                 opens Profile → Sign-in & security
///     -UITestOpen notifications            opens Profile → Notifications
///     -UITestOpen exportData               opens Profile → Download my data
///     -UITestShowPast YES                  Events starts with "Past events" expanded
///     -UITestPushToBubble "Climbing Crew"  4 s after start, acts as a tapped chat push for this bubble
///     -UITestSimulateOffline YES           start with the network "off": Supabase requests fail fast and the
///                                          offline banner shows; the hidden `debug-network-toggle` button
///                                          in the banner area turns it on and off
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
        while session.userID != nil && session.memberships == nil && session.route == .launching {
            try? await Task.sleep(for: .milliseconds(50))
        }
        if let name = defaults.string(forKey: "UITestBubble"),
           let bubble = session.bubbles.first(where: { $0.name == name }) {
            session.selectBubble(bubble.id)
        }
        #endif
    }

    /// Device id override for tests: seeded users trust `boolaa-test-device`. Always nil in release builds.
    static var deviceIDOverride: String? {
        #if DEBUG
        UserDefaults.standard.string(forKey: "UITestDeviceID")?.nilIfEmpty
        #else
        nil
        #endif
    }

    static var initialTab: MainTab? {
        #if DEBUG
        UserDefaults.standard.string(forKey: "UITestTab").flatMap(MainTab.init(rawValue:))
        #else
        nil
        #endif
    }

    /// Simulated offline mode for the offline UI tests (docs/boolaa-spec.md, "Offline and poor network").
    static var simulateOffline: Bool {
        #if DEBUG
        UserDefaults.standard.bool(forKey: "UITestSimulateOffline")
        #else
        false
        #endif
    }

    static var expandPastEvents: Bool {
        #if DEBUG
        UserDefaults.standard.bool(forKey: "UITestShowPast")
        #else
        false
        #endif
    }

    static var startOnRegister: Bool {
        #if DEBUG
        UserDefaults.standard.bool(forKey: "UITestRegister")
        #else
        false
        #endif
    }

    /// Profile-sheet screen to open once (blocked | security | notifications | deleteAccount | exportData), consumed on first read.
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

    /// A string launch argument, for pre-filling forms and scrolling in marketing screenshots
    /// (Scripts/capture-marketing.sh). Always nil in release builds.
    static func string(_ key: String) -> String? {
        #if DEBUG
        UserDefaults.standard.string(forKey: key)?.nilIfEmpty
        #else
        nil
        #endif
    }
}
