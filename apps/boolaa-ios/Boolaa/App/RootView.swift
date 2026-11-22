import SwiftUI

/// Applies the routing gate: Auth, Onboarding or Main.
struct RootView: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            switch session.route {
            case .launching:
                LaunchView().transition(.opacity)
            case .auth:
                AuthView().transition(screenTransition)
            case .onboarding:
                OnboardingView().transition(screenTransition)
            case .main:
                MainShellView().transition(screenTransition)
            }
        }
        .animation(Motion.resolve(Motion.gentle, reduceMotion: reduceMotion), value: session.route)
    }

    /// Screens swell in like a bubble and fade out.
    private var screenTransition: AnyTransition {
        reduceMotion ? .opacity : .asymmetric(insertion: .opacity.combined(with: .scale(scale: 0.94)), removal: .opacity)
    }
}

struct LaunchView: View {
    var body: some View {
        BoolaaLogo(size: 96)
            .accessibilityIdentifier("launch")
    }
}

/// The Boolaa mark: one big grape bubble with two little friends. Bobs gently when `animated`.
struct BoolaaLogo: View {
    var size: CGFloat = 64
    var animated = true

    var body: some View {
        ZStack {
            orb(.coral, scale: 0.36, x: 0.42, y: -0.34, phase: 0.35)
            orb(.sunny, scale: 0.2, x: 0.62, y: 0.02, phase: 0.6)
            orb(.mint, scale: 0.26, x: -0.46, y: 0.32, phase: 0.8)
            BubbleOrb(hue: .grape)
                .frame(width: size, height: size)
                .shadow(color: Hue.grape.fill.opacity(0.4), radius: size * 0.18, y: size * 0.1)
                .floating(amplitude: animated ? size * 0.04 : 0, period: 5)
        }
        .frame(width: size * 1.5, height: size * 1.2)
        .accessibilityHidden(true)
    }

    private func orb(_ hue: Hue, scale: CGFloat, x: CGFloat, y: CGFloat, phase: Double) -> some View {
        BubbleOrb(hue: hue)
            .frame(width: size * scale, height: size * scale)
            .offset(x: size * x, y: size * y)
            .floating(amplitude: animated ? size * 0.06 : 0, period: 3.6 + phase * 2, phase: phase)
    }
}
