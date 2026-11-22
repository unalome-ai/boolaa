import GoogleSignIn
import SwiftUI

@main
struct BoolaaApp: App {
    @State private var session: SessionStore
    @State private var safety: SafetyStore

    init() {
        let device = DeviceIdentity.load(label: DeviceIdentity.currentLabel, override: DebugHooks.deviceIDOverride)
        let session = SessionStore(api: BoolaaAPI(client: Backend.shared), device: device)
        _session = State(initialValue: session)
        _safety = State(initialValue: SafetyStore(session: session))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .environment(safety)
                .tint(Theme.brandText)
                .task {
                    session.start()
                    await DebugHooks.applyAutoLogin(session: session)
                }
                .onOpenURL { url in
                    // Google Sign-In's redirect, else an OAuth / email-link callback (ro.boolaa.app://auth/callback).
                    if GIDSignIn.sharedInstance.handle(url) { return }
                    guard url.scheme == AppConfig.authCallbackURL.scheme else { return }
                    Task { await session.handleAuthCallback(url, expectingRecovery: PasswordResetFlow.isWaitingForCode) }
                }
        }
    }
}
