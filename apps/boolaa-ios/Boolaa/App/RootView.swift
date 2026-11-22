import SwiftUI

/// Applies the routing gate: Auth, Onboarding or Main.
struct RootView: View {
    @Environment(SessionStore.self) private var session

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            switch session.route {
            case .launching:
                LaunchView()
            case .auth:
                AuthView().transition(.opacity)
            case .onboarding:
                OnboardingView().transition(.opacity)
            case .main:
                MainShellView().transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: session.route)
    }
}

struct LaunchView: View {
    var body: some View {
        VStack(spacing: 16) {
            BoolaaLogo(size: 72)
            ProgressView()
        }
        .accessibilityIdentifier("launch")
    }
}

struct BoolaaLogo: View {
    var size: CGFloat = 64
    var body: some View {
        ZStack {
            Circle().fill(Theme.brand).frame(width: size, height: size)
            Circle().fill(.white).frame(width: size * 0.42, height: size * 0.42)
            Circle().fill(.white.opacity(0.85)).frame(width: size * 0.16, height: size * 0.16)
                .offset(x: size * 0.22, y: -size * 0.2)
        }
        .shadow(color: Theme.brand.opacity(0.35), radius: 12, y: 6)
    }
}
