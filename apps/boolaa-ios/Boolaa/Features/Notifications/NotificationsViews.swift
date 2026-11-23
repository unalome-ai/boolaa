import SwiftUI
import UIKit

/// Profile → Notifications (docs/push-notifications.md §9): the OS permission, the master switch, one switch
/// per type and message previews, stored in the user's `notification_prefs` row.
struct NotificationsView: View {
    @Environment(SessionStore.self) private var session
    @Environment(PushCenter.self) private var push
    @Environment(\.scenePhase) private var scenePhase
    @State private var prefs: NotificationPrefs?
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                PushPermissionCard(showsDismiss: false)

                if let prefs {
                    VStack(spacing: 0) {
                        toggle(LocalizedStringResource("Allow notifications", comment: "Notification setting: master switch"),
                               \.enabled, id: "enabled", prefs: prefs)
                    }
                    .card(padding: 14)

                    VStack(spacing: 0) {
                        ForEach(Array(NotificationPrefs.toggles.enumerated()), id: \.offset) { index, item in
                            toggle(item.title, item.key, id: item.id, prefs: prefs)
                            if index < NotificationPrefs.toggles.count - 1 { Divider() }
                        }
                    }
                    .card(padding: 14)
                    .disabled(!prefs.enabled)
                    .opacity(prefs.enabled ? 1 : 0.5)

                    VStack(alignment: .leading, spacing: 6) {
                        toggle(LocalizedStringResource("Show message previews", comment: "Notification setting"),
                               \.previewContent, id: "preview", prefs: prefs)
                        // The current bubble's name (user content), like the push itself; "Boolaa" without one.
                        Text("When off, notifications only say \"New message in \(session.currentBubble?.name ?? "Boolaa")\", without names or text.",
                             comment: "Hint under the message-preview notification setting; the argument is the current bubble's name")
                            .accessibilityIdentifier("notifications-preview-hint")
                            .font(.footnote).foregroundStyle(Theme.inkSecondary)
                    }
                    .card(padding: 14)
                    .disabled(!prefs.enabled)
                    .opacity(prefs.enabled ? 1 : 0.5)
                } else {
                    SkeletonList(count: 2)
                }
            }
            .padding(20)
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(Text("Notifications", comment: "Screen title"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await push.refreshPermission() } }
        }
        .errorAlert($error)
    }

    private func toggle(_ title: LocalizedStringResource, _ key: WritableKeyPath<NotificationPrefs, Bool>,
                        id: String, prefs: NotificationPrefs) -> some View {
        Toggle(isOn: Binding(get: { prefs[keyPath: key] }, set: { value in
            var next = prefs
            next[keyPath: key] = value
            Task { await save(next) }
        })) {
            Text(title).font(.body.weight(.medium))
        }
        .tint(Hue.grape.fill)
        .frame(minHeight: 44)
        .accessibilityIdentifier("notif-\(id)")
    }

    private func load() async {
        await push.refreshPermission()
        guard let userID = session.userID else { return }
        do { prefs = try await session.api.notificationPrefs(userID: userID) } catch {
            self.error = error.userMessage
            prefs = NotificationPrefs(userId: userID)
        }
    }

    /// Optimistic: show the new value at once, put the old one back if saving fails.
    private func save(_ next: NotificationPrefs) async {
        let previous = prefs
        withAnimation(Motion.snappy) { prefs = next }
        do { try await session.api.saveNotificationPrefs(next) } catch {
            prefs = previous
            self.error = error.userMessage
        }
    }
}

/// The OS permission: "Turn on notifications" (explains first, then the iOS prompt) while iOS hasn't asked
/// yet, or a "turned off in your settings" banner with a button to iOS Settings when denied.
struct PushPermissionCard: View {
    @Environment(PushCenter.self) private var push
    @Environment(\.openURL) private var openURL
    /// On Home: only the "Turn on" card, dismissible for good. In Notifications: never dismissible, and the
    /// "blocked" banner too.
    var showsDismiss: Bool
    @State private var asking = false
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        switch push.permission {
        case .notDetermined where !(showsDismiss && push.promptDismissed):
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top, spacing: 12) {
                    // Decorative; dropped at the accessibility text sizes so the title keeps the width.
                    if !typeSize.isAccessibilitySize { FeatureBadge(icon: "bell.badge.fill", hue: .grape, size: 38) }
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Turn on notifications", comment: "Card title / button that asks for notification permission")
                            .font(.rounded(.headline))
                            .accessibilityAddTraits(.isHeader)
                        Text("Get a ping when your bubbles talk to you.", comment: "Why to turn on notifications")
                            .font(.subheadline).foregroundStyle(Theme.inkSecondary)
                    }
                    Spacer(minLength: 0)
                    if showsDismiss {
                        Button { withAnimation(Motion.gentle) { push.promptDismissed = true } } label: {
                            Image(systemName: "xmark").font(.subheadline.weight(.bold)).foregroundStyle(Theme.inkSecondary)
                                .frame(width: 44, height: 44)
                        }
                        .accessibilityLabel(Text("Not now"))
                        .accessibilityIdentifier("push-prompt-dismiss")
                    }
                }
                Button {
                    Task {
                        asking = true; defer { asking = false }
                        await push.requestPermission()
                        await push.sessionBecameReady()
                    }
                } label: {
                    Text("Turn on notifications", comment: "Card title / button that asks for notification permission")
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(asking)
                .accessibilityIdentifier("push-enable")
            }
            .card()
            .accessibilityIdentifier("push-prompt")
        case .denied where !showsDismiss:
            VStack(alignment: .leading, spacing: 10) {
                Label {
                    Text("Notifications are turned off for Boolaa in your settings.",
                         comment: "Banner when iOS blocks notifications for the app")
                } icon: { Image(systemName: "bell.slash.fill").foregroundStyle(Theme.dangerText) }
                    .font(.subheadline.weight(.semibold))
                Button {
                    if let url = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(url) }
                } label: {
                    Text("Open Settings", comment: "Button that opens the app's page in iOS Settings")
                }
                .buttonStyle(SecondaryButtonStyle())
                .accessibilityIdentifier("push-open-settings")
            }
            .card()
            .accessibilityIdentifier("push-blocked")
        default:
            EmptyView()
        }
    }
}

/// Bubble settings → "Mute this bubble": 1 hour, 8 hours, 1 week or until turned back on (`bubble_mutes`).
struct BubbleMuteCard: View {
    @Environment(SessionStore.self) private var session
    let bubbleID: UUID
    @State private var mute: BubbleMute?
    @State private var busy = false
    @State private var error: String?

    private var active: BubbleMute? { mute.flatMap { $0.isActive() ? $0 : nil } }

    var body: some View {
        HStack(spacing: 12) {
            FeatureBadge(icon: active == nil ? "bell.fill" : "bell.slash.fill", hue: .indigo, size: 38)
            VStack(alignment: .leading, spacing: 2) {
                Text("Mute this bubble", comment: "Bubble settings: mute notifications from this bubble")
                    .font(.rounded(.headline)).foregroundStyle(.primary)
                if let active {
                    Group {
                        if let until = active.until {
                            Text("Muted until \(until.formatted(date: .abbreviated, time: .shortened))",
                                 comment: "Bubble settings: the argument is the date and time the mute ends")
                        } else {
                            Text(MuteDuration.forever.title)
                        }
                    }
                    .font(.subheadline).foregroundStyle(Theme.inkSecondary)
                    .accessibilityIdentifier("mute-status")
                }
            }
            Spacer(minLength: 0)
            if active != nil {
                Button {
                    Task { await unmute() }
                } label: {
                    Text("Unmute", comment: "Bubble settings: turn notifications from this bubble back on")
                }
                .font(.rounded(.subheadline, weight: .bold))
                .buttonStyle(.bordered).buttonBorderShape(.capsule).tint(Hue.grape.text)
                .accessibilityIdentifier("unmute-bubble")
            } else {
                Menu {
                    ForEach(MuteDuration.allCases) { duration in
                        Button { Task { await mute(duration) } } label: { Text(duration.title) }
                            .accessibilityIdentifier("mute-\(duration.rawValue)")
                    }
                } label: {
                    Image(systemName: "chevron.up.chevron.down").font(.subheadline.weight(.bold)).foregroundStyle(Theme.inkSecondary)
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel(Text("Mute this bubble", comment: "Bubble settings: mute notifications from this bubble"))
                .accessibilityIdentifier("mute-bubble")
            }
        }
        .disabled(busy)
        .card(padding: 14)
        .task(id: bubbleID) { await load() }
        .errorAlert($error)
        .sensoryFeedback(.selection, trigger: active)
    }

    private func load() async {
        guard let me = session.userID else { return }
        mute = try? await session.api.bubbleMute(userID: me, bubbleID: bubbleID)
    }

    private func mute(_ duration: MuteDuration) async {
        guard let me = session.userID else { return }
        busy = true; defer { busy = false }
        let until = duration.until()
        do {
            try await session.api.muteBubble(userID: me, bubbleID: bubbleID, until: until)
            withAnimation(Motion.snappy) { mute = BubbleMute(userId: me, bubbleId: bubbleID, until: until) }
        } catch { self.error = error.userMessage }
    }

    private func unmute() async {
        guard let me = session.userID else { return }
        busy = true; defer { busy = false }
        do {
            try await session.api.unmuteBubble(userID: me, bubbleID: bubbleID)
            withAnimation(Motion.snappy) { mute = nil }
        } catch { self.error = error.userMessage }
    }
}

// MARK: Routing helpers for the feature screens

extension View {
    /// A row a notification can point at: scroll anchor plus a brief highlight ring.
    func pushHighlightTarget(_ id: UUID) -> some View { modifier(PushHighlightTarget(id: id)) }

    /// Scrolls to `ShellRouter.highlight` once that row has loaded, then lets the highlight fade.
    func scrollsToPushHighlight(_ ids: [UUID]) -> some View { modifier(PushHighlightScroller(ids: ids)) }

    /// Tells PushCenter which bubble's chat is on screen (no banners for it) and clears its delivered pushes.
    func reportsVisibleChat(_ bubbleID: UUID?) -> some View { modifier(VisibleChatReporter(bubbleID: bubbleID)) }
}

private struct PushHighlightTarget: ViewModifier {
    let id: UUID
    @Environment(ShellRouter.self) private var router: ShellRouter?

    func body(content: Content) -> some View {
        content
            .id(id)
            .overlay {
                if router?.highlight == id {
                    RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                        .strokeBorder(Theme.brandText, lineWidth: 3)
                        .allowsHitTesting(false)
                        .transition(.opacity)
                        .accessibilityIdentifier("push-highlight")
                }
            }
    }
}

private struct PushHighlightScroller: ViewModifier {
    let ids: [UUID]
    @Environment(ShellRouter.self) private var router: ShellRouter?

    func body(content: Content) -> some View {
        ScrollViewReader { proxy in
            content
                .task(id: "\(router?.highlight?.uuidString ?? "")|\(router?.highlight.map(ids.contains) ?? false)") {
                    guard let target = router?.highlight, ids.contains(target) else { return }
                    try? await Task.sleep(for: .milliseconds(350))
                    withAnimation(Motion.gentle) { proxy.scrollTo(target, anchor: .center) }
                    try? await Task.sleep(for: .seconds(2.5))
                    if router?.highlight == target { withAnimation(Motion.gentle) { router?.highlight = nil } }
                }
                // The row may be gone (deleted meanwhile): just show the screen and drop the highlight.
                .task(id: router?.highlight) {
                    guard let target = router?.highlight else { return }
                    try? await Task.sleep(for: .seconds(8))
                    if router?.highlight == target { router?.highlight = nil }
                }
        }
    }
}

private struct VisibleChatReporter: ViewModifier {
    let bubbleID: UUID?

    func body(content: Content) -> some View {
        content
            .onAppear { show(bubbleID) }
            .onDisappear {
                if PushCenter.shared.visibleChatBubble == bubbleID { PushCenter.shared.visibleChatBubble = nil }
            }
            .onChange(of: bubbleID) { _, id in show(id) }
    }

    private func show(_ id: UUID?) {
        PushCenter.shared.visibleChatBubble = id
        if let id { Task { await PushCenter.shared.clearDelivered(bubbleID: id) } }
    }
}
