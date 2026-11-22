import SwiftUI

/// Main shell: header with bubble switcher, the current tab, floating pill tab bar and chat button (spec §4).
struct MainShellView: View {
    @Environment(SessionStore.self) private var session
    @Environment(SafetyStore.self) private var safety
    @State private var router = ShellRouter()
    @State private var appliedDebugHooks = false

    var body: some View {
        NavigationStack(path: $router.path) {
            VStack(spacing: 0) {
                ShellHeader(title: router.tab.title)
                ZStack {
                    switch router.tab {
                    case .home: HomeView()
                    case .events: EventsView()
                    case .food: FoodView()
                    case .marketplace: MarketplaceView()
                    case .settings: SettingsView()
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                // Rebuild tab content when the bubble changes, or after a block/unblock, so every screen reloads.
                .id("\(session.currentBubble?.id.uuidString ?? "")-\(safety.contentVersion)")
            }
            .background(Theme.background.ignoresSafeArea())
            .overlay(alignment: .bottom) { PillTabBar(selection: $router.tab) }
            .overlay(alignment: .bottomTrailing) {
                ChatFAB { router.open(.chat) }
                    .padding(.trailing, 20)
                    .padding(.bottom, 96)
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: ShellDestination.self) { destination in
                switch destination {
                case .chat: ChatView()
                case .links: LinksView()
                }
            }
        }
        .environment(router)
        .sheet(isPresented: $router.showProfile) { ProfileSheet() }
        .sheet(isPresented: $router.showAddBubble) { AddBubbleSheet() }
        .sheet(item: Binding(get: { safety.reportTarget }, set: { safety.reportTarget = $0 })) { ReportSheet(target: $0) }
        .errorAlert(Binding(get: { safety.error }, set: { safety.error = $0 }))
        .task(id: session.userID) {
            safety.reset()
            if session.userID != nil { await safety.load() }
        }
        .onAppear(perform: applyDebugHooks)
    }

    private func applyDebugHooks() {
        guard !appliedDebugHooks else { return }
        appliedDebugHooks = true
        if let tab = DebugHooks.initialTab { router.tab = tab }
        switch DebugHooks.initialOpen {
        case "chat": router.open(.chat)
        case "links": router.open(.links)
        case "profile", "blocked", "deleteAccount": router.showProfile = true
        case "report": Task { await openDebugReport() }
        case "addBubble": router.showAddBubble = true
        default: break
        }
    }

    /// Debug hook: report the newest chat message from someone else in the current bubble.
    private func openDebugReport() async {
        guard let id = session.currentBubble?.id,
              let messages = try? await session.api.chatMessages(bubbleID: id, limit: 20),
              let message = messages.last(where: { $0.senderId != session.userID }) else { return }
        safety.reportTarget = .message(message)
    }
}

/// Large title, avatar button and horizontal bubble chips with "+ New".
struct ShellHeader: View {
    @Environment(SessionStore.self) private var session
    @Environment(ShellRouter.self) private var router
    var title: LocalizedStringResource

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center) {
                Text(title)
                    .font(.system(size: 32, weight: .bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("screen-title")
                Spacer()
                Button { router.showProfile = true } label: {
                    AvatarView(user: session.profile, size: 42)
                }
                .accessibilityLabel(Text("Profile"))
                .accessibilityIdentifier("profile-button")
            }
            .padding(.horizontal, 16)

            ScrollViewReader { proxy in
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(session.bubbles) { bubble in
                            Button {
                                withAnimation(.snappy) { session.selectBubble(bubble.id) }
                            } label: {
                                ChipView(title: bubble.name, isActive: bubble.id == session.currentBubble?.id)
                            }
                            .buttonStyle(.plain)
                            .id(bubble.id)
                            .accessibilityIdentifier("bubble-chip-\(bubble.name)")
                            .accessibilityAddTraits(bubble.id == session.currentBubble?.id ? .isSelected : [])
                        }
                        Button { router.showAddBubble = true } label: {
                            ChipView(title: String(localized: "New", comment: "Chip that creates or joins another bubble"), isActive: false, systemImage: "plus", outlined: true)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("bubble-chip-new")
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 2)
                }
                .onChange(of: session.currentBubble?.id) { _, id in
                    if let id { withAnimation { proxy.scrollTo(id, anchor: .center) } }
                }
            }
        }
        .padding(.top, 8)
        .padding(.bottom, 12)
        .background(Theme.background)
    }
}

/// Floating rounded pill with circular icon buttons; the active one is filled purple.
struct PillTabBar: View {
    @Binding var selection: MainTab

    var body: some View {
        HStack(spacing: 6) {
            ForEach(MainTab.allCases) { tab in
                let active = tab == selection
                Button {
                    withAnimation(.snappy(duration: 0.25)) { selection = tab }
                } label: {
                    Image(systemName: active ? tab.activeIcon : tab.icon)
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(active ? Color.white : Theme.brand)
                        .frame(width: 50, height: 50)
                        .background(Circle().fill(active ? Theme.brand : Color.clear))
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(tab.title))
                .accessibilityIdentifier("tab-\(tab.rawValue)")
                .accessibilityAddTraits(active ? .isSelected : [])
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(Capsule().fill(Theme.card))
        .overlay(Capsule().stroke(Theme.brand.opacity(0.25), lineWidth: 1))
        .shadow(color: .black.opacity(0.12), radius: 16, x: 0, y: 6)
        .padding(.bottom, 8)
    }
}

struct ChatFAB: View {
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: "bubble.left.and.bubble.right.fill")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 56, height: 56)
                .background(Circle().fill(Theme.brand))
                .shadow(color: .black.opacity(0.22), radius: 8, x: 0, y: 4)
        }
        .accessibilityLabel("Open chat")
        .accessibilityIdentifier("chat-fab")
    }
}

/// "+ New" chip: create another bubble or join one.
struct AddBubbleSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(SessionStore.self) private var session
    @State private var mode: OnboardingView.Mode = .join
    @State private var requested: JoinRequest?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Picker("Mode", selection: $mode) {
                        Text("Join a bubble").tag(OnboardingView.Mode.join)
                        Text("Create a bubble").tag(OnboardingView.Mode.create)
                    }
                    .pickerStyle(.segmented)

                    if mode == .join {
                        if requested != nil {
                            Label("Request sent. The members of the bubble will vote on it.",
                                  systemImage: "checkmark.seal.fill")
                                .foregroundStyle(Theme.brand)
                                .card()
                        }
                        JoinBubbleForm { requested = $0 }
                    } else {
                        CreateBubbleForm { dismiss() }
                    }

                    if !session.pendingRequests.isEmpty {
                        SectionHeader(title: "Your pending requests")
                        PendingRequestsList(error: $error)
                    }
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("New bubble")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
            .errorAlert($error)
        }
        .presentationDetents([.medium, .large])
    }
}
