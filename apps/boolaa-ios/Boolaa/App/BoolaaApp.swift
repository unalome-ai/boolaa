import SwiftUI

@main
struct BoolaaApp: App {
    @State private var session = SessionStore(api: BoolaaAPI(client: Backend.shared))

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .tint(Theme.brand)
                .task {
                    session.start()
                    await DebugHooks.applyAutoLogin(session: session)
                }
        }
    }
}
