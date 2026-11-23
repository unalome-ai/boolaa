import SwiftUI

// Offline and poor network (docs/boolaa-spec.md): the shell banner, inline load errors, the stale notice,
// delayed loading indicators, and the cache-first load every main screen uses.

/// A screen model that shows its last cached view first, then loads.
@MainActor
protocol CacheFirstModel: AnyObject {
    /// Something trustworthy is on screen (the network answer or the cached view).
    var loaded: Bool { get set }
    /// The last load failed (inline error, or the stale notice over cached data).
    var failed: Bool { get set }
}

extension CacheFirstModel {
    /// Shows the cached value at once if nothing is on screen yet, then fetches. A success replaces the data,
    /// writes the cache and tells `Connectivity` Supabase answered; a failure keeps what is shown.
    /// Returns whether the fetch succeeded.
    @discardableResult
    func loadCacheFirst<T: Codable & Sendable>(key: String, apply: (T) -> Void,
                                               fetch: () async throws -> T) async -> Bool {
        if !loaded, let cached = OfflineCache.shared.read(T.self, key: key) {
            apply(cached)
            loaded = true
        }
        do {
            let value = try await fetch()
            apply(value)
            loaded = true
            failed = false
            Connectivity.shared.reportSuccess()
            OfflineCache.shared.save(value, key: key)
            return true
        } catch {
            guard !Task.isCancelled else { return false }
            failed = true
            Connectivity.shared.report(error)
            // "session not verified" / "account suspended" re-run the gate as before.
            _ = UserFacingError.classify(error)
            return false
        }
    }
}

/// "Couldn't load this. Check your connection and try again." with Try again: what a screen shows instead of
/// an empty state when its first load failed and nothing is cached.
struct LoadFailedView: View {
    var retry: @MainActor () async -> Void
    @State private var busy = false

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(Theme.brandText)
                .accessibilityHidden(true)
            Text("Couldn't load this. Check your connection and try again.",
                 comment: "Inline error when a screen could not load")
                .font(.subheadline).multilineTextAlignment(.center).foregroundStyle(.secondary)
            RetryButton(busy: busy) {
                busy = true
                await retry()
                busy = false
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 28).padding(.horizontal, 20)
        .card()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("load-failed")
    }
}

/// "Couldn't refresh — showing what you saw last." over cached data when the network is fine but the
/// load failed (offline and unreachable are explained by the shell banner instead).
struct StaleNotice: View {
    var retry: @MainActor () async -> Void
    @State private var busy = false

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "clock.arrow.circlepath").foregroundStyle(.secondary).accessibilityHidden(true)
            Text("Couldn't refresh — showing what you saw last.", comment: "Notice over cached data after a failed refresh")
                .font(.footnote).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
            RetryButton(busy: busy, compact: true) {
                busy = true
                await retry()
                busy = false
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(Theme.field, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("stale-notice")
    }
}

private struct RetryButton: View {
    var busy: Bool
    var compact = false
    var action: @MainActor () async -> Void

    var body: some View {
        Button {
            Task { await action() }
        } label: {
            HStack(spacing: 6) {
                if busy { ProgressView().controlSize(.small) }
                Text("Try again")
            }
            .font(.rounded(compact ? .footnote : .subheadline))
            .foregroundStyle(Theme.brandText)
            .padding(.horizontal, compact ? 12 : 18).frame(minHeight: compact ? 32 : 40)
            .background(Hue.grape.wash, in: Capsule())
        }
        .buttonStyle(.squish)
        .disabled(busy)
        .accessibilityIdentifier("retry")
    }
}

/// The right notice for a screen's load state: the inline error when nothing could be shown, the stale
/// notice over cached data while the network is fine, nothing otherwise.
struct LoadIssueView: View {
    var failed: Bool
    var hasContent: Bool
    var retry: @MainActor () async -> Void
    @Environment(Connectivity.self) private var connectivity

    var body: some View {
        if failed && !hasContent {
            LoadFailedView(retry: retry)
        } else if failed && connectivity.status == .online {
            StaleNotice(retry: retry)
        }
    }
}

/// Shows its content only after `delay` (300 ms): fast loads don't flash a skeleton.
struct Delayed<Content: View>: View {
    var delay: Duration = .milliseconds(300)
    @ViewBuilder var content: Content
    @State private var shown = false

    var body: some View {
        Group { if shown { content.transition(.opacity) } }
            .task {
                try? await Task.sleep(for: delay)
                if !Task.isCancelled { withAnimation(Motion.fade) { shown = true } }
            }
    }
}

/// While a screen's load has failed and the network looks fine (a server error), retry with backoff:
/// 1, 2, 4, 8, 16 s (five attempts). Offline/unreachable is handled by `Connectivity` (reconnect → reload).
private struct AutoRetry: ViewModifier {
    var failed: Bool
    var retry: @MainActor () async -> Void
    @Environment(Connectivity.self) private var connectivity

    func body(content: Content) -> some View {
        content.task(id: "\(failed)-\(connectivity.status.rawValue)") {
            guard failed, connectivity.status == .online else { return }
            for attempt in 0..<5 {
                try? await Task.sleep(for: .seconds(Backoff.delay(attempt: attempt, jitter: Backoff.randomJitter())))
                guard !Task.isCancelled else { return }
                await retry()
            }
        }
    }
}

extension View {
    func autoRetry(failed: Bool, _ retry: @escaping @MainActor () async -> Void) -> some View {
        modifier(AutoRetry(failed: failed, retry: retry))
    }
}

#if DEBUG
/// UI tests flip the simulated network with this (DEBUG builds launched with -UITestSimulateOffline only).
struct DebugNetworkToggle: View {
    @Environment(Connectivity.self) private var connectivity
    var body: some View {
        if DebugHooks.simulateOffline {
            Button {
                connectivity.setSimulatedOffline(!connectivity.simulatedOffline)
            } label: {
                Text(verbatim: connectivity.simulatedOffline ? "net off" : "net on")
            }
            .font(.caption2)
            .frame(minWidth: 44, minHeight: 44)
            .opacity(0.05)
            .accessibilityIdentifier("debug-network-toggle")
        }
    }
}
#endif

/// The shell's network pill: "You're offline — showing what you saw last" / "Can't reach Boolaa — …" while
/// it lasts, then "Back online" for 2.5 s. Announced to VoiceOver; animated only without Reduce Motion.
struct ConnectivityBanner: View {
    @Environment(Connectivity.self) private var connectivity
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private enum Shown: Equatable { case offline, unreachable, backOnline }

    private var shown: Shown? {
        switch connectivity.status {
        case .offline: .offline
        case .unreachable: .unreachable
        case .online: connectivity.showBackOnline ? .backOnline : nil
        }
    }

    var body: some View {
        VStack {
            if let shown {
                pill(shown)
                    .transition(reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity))
            }
        }
        .frame(maxWidth: .infinity)
        .animation(Motion.resolve(Motion.gentle, reduceMotion: reduceMotion), value: shown)
        .onChange(of: shown) { _, now in
            guard let now else { return }
            AccessibilityNotification.Announcement(text(now)).post()
        }
    }

    private func text(_ shown: Shown) -> String {
        switch shown {
        case .offline: String(localized: "You're offline — showing what you saw last", comment: "Banner while the device has no network")
        case .unreachable: String(localized: "Can't reach Boolaa — showing what you saw last", comment: "Banner while the server doesn't answer")
        case .backOnline: String(localized: "Back online", comment: "Short notice when the connection comes back")
        }
    }

    private func pill(_ shown: Shown) -> some View {
        HStack(spacing: 8) {
            Image(systemName: shown == .backOnline ? "wifi" : shown == .offline ? "wifi.slash" : "icloud.slash")
                .font(.footnote.weight(.bold))
                .accessibilityHidden(true)
            Text(text(shown))
                .font(.rounded(.footnote, weight: .semibold))
                .multilineTextAlignment(.leading)
        }
        .foregroundStyle(shown == .backOnline ? Hue.mint.text : Theme.inkSecondary)
        .padding(.horizontal, 14).padding(.vertical, 8)
        .background(Capsule().fill(shown == .backOnline ? Hue.mint.wash : Theme.card))
        .overlay(Capsule().strokeBorder(Theme.hairline, lineWidth: 1))
        .padding(.horizontal, 16).padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.updatesFrequently)
        .accessibilityIdentifier(shown == .backOnline ? "back-online" : "offline-banner")
    }
}
