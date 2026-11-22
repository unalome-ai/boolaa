import SwiftUI

@main
struct BoolaaApp: App {
    @State private var session: SessionStore
    @State private var safety: SafetyStore

    init() {
        let session = SessionStore(api: BoolaaAPI(client: Backend.shared))
        _session = State(initialValue: session)
        _safety = State(initialValue: SafetyStore(session: session))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .environment(safety)
                .tint(Theme.brand)
                .task {
                    session.start()
                    await DebugHooks.applyAutoLogin(session: session)
                }
        }
    }
}
