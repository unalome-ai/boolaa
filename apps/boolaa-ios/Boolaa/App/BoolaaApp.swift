import GoogleSignIn
import SwiftUI

@main
struct BoolaaApp: App {
    @State private var session: SessionStore
    @State private var safety: SafetyStore
    @State private var unread: UnreadStore

    init() {
        let device = DeviceIdentity.load(label: DeviceIdentity.currentLabel, override: DebugHooks.deviceIDOverride)
        let session = SessionStore(api: BoolaaAPI(client: Backend.shared), device: device)
        _session = State(initialValue: session)
        _safety = State(initialValue: SafetyStore(session: session))
        _unread = State(initialValue: UnreadStore(session: session))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .environment(safety)
                .environment(unread)
                .tint(Theme.brandText)
                .task {
                    session.start()
                    await DebugHooks.applyAutoLogin(session: session)
                }
                .onOpenURL { url in
                    // Google Sign-In's redirect, an invite link (boolaa://join/…, ro.boolaa.app://join/…, or a
                    // universal link delivered as a URL), else an OAuth / email-link callback (ro.boolaa.app://auth/callback).
                    if GIDSignIn.sharedInstance.handle(url) { return }
                    if session.handleInviteURL(url) { return }
                    guard url.scheme == AppConfig.authCallbackURL.scheme else { return }
                    Task { await session.handleAuthCallback(url, expectingRecovery: PasswordResetFlow.isWaitingForCode) }
                }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    // Universal link https://boolaa.ro/join/<CODE> (Associated Domains applinks:boolaa.ro).
                    if let url = activity.webpageURL { session.handleInviteURL(url) }
                }
        }
    }
}
