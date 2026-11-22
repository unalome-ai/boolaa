import SwiftUI

/// Main shell: header with bubble switcher, the current tab, floating pill tab bar and chat button (spec §4).
struct MainShellView: View {
    @Environment(SessionStore.self) private var session
    @Environment(SafetyStore.self) private var safety
    @Environment(UnreadStore.self) private var unread
    @Environment(\.scenePhase) private var scenePhase
    @State private var router = ShellRouter()
    @State private var appliedDebugHooks = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        NavigationStack(path: $router.path) {
            VStack(spacing: 0) {
                ShellHeader(title: router.tab.title)
                ZStack {
                    ZStack {
                        switch router.tab {
                        case .home: HomeView().transition(contentTransition)
                        case .events: EventsView().transition(contentTransition)
                        case .food: FoodView().transition(contentTransition)
                        case .marketplace: MarketplaceView().transition(contentTransition)
                        case .settings: SettingsView().transition(contentTransition)
                        }
                    }
                    // Rebuild tab content when the bubble changes, or after a block/unblock, so every screen reloads.
                    .id("\(session.currentBubble?.id.uuidString ?? "")-\(safety.contentVersion)")
                    .transition(contentTransition)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .background { ShellBackground(hue: Hue.forID(session.currentBubble?.id)) }
            .overlay(alignment: .bottom) {
                Dock(selection: $router.tab, unread: unread.count(for: session.currentBubble?.id)) { router.open(.chat) }
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
        .sheet(isPresented: $router.showProfile) { ProfileSheet().boolaaSheet() }
        .sheet(isPresented: $router.showAddBubble) { AddBubbleSheet().boolaaSheet() }
        .sheet(item: Binding(get: { safety.reportTarget }, set: { safety.reportTarget = $0 })) { ReportSheet(target: $0).boolaaSheet() }
        .sensoryFeedback(.selection, trigger: router.tab)
        .sensoryFeedback(.impact(weight: .medium), trigger: session.currentBubble?.id)
        .errorAlert(Binding(get: { safety.error }, set: { safety.error = $0 }))
        .task(id: session.userID) {
            safety.reset()
            if session.userID != nil { await safety.load() }
        }
        // Unread badges: on start, then live (debounced) until sign-out.
        .task(id: session.userID) {
            unread.reset()
            guard let userID = session.userID else { return }
            await unread.refresh()
            await unread.watch(userID: userID)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await unread.refresh() } }
        }
        .onChange(of: session.bubbles.map(\.id)) { _, _ in
            Task { await unread.refresh() }
        }
        .onAppear(perform: applyDebugHooks)
    }

    /// New content rises in with a little swell; old content just fades.
    private var contentTransition: AnyTransition {
        reduceMotion ? .opacity
            : .asymmetric(insertion: .opacity.combined(with: .offset(y: 14)).combined(with: .scale(scale: 0.98)), removal: .opacity)
    }

    private func applyDebugHooks() {
        guard !appliedDebugHooks else { return }
        appliedDebugHooks = true
        if let tab = DebugHooks.initialTab { router.tab = tab }
        switch DebugHooks.initialOpen {
        case "chat": router.open(.chat)
        case "links": router.open(.links)
        case "profile", "blocked", "deleteAccount", "security": router.showProfile = true
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

extension MainTab {
    /// The colour the dock's selection takes on this tab.
    var hue: Hue {
        switch self {
        case .home: .grape
        case .events: Feature.events.hue
        case .food: Feature.food.hue
        case .marketplace: Feature.market.hue
        case .settings: .indigo
        }
    }
}

extension View {
    /// Shared sheet chrome: big soft corners, a grabber and the app background.
    func boolaaSheet() -> some View {
        presentationCornerRadius(Theme.Radius.hero)
            .presentationDragIndicator(.visible)
            .presentationBackground(Theme.background)
    }
}

/// App background with a soft glow in the current bubble's colour behind the header.
struct ShellBackground: View {
    var hue: Hue
    @Environment(\.colorScheme) private var colorScheme
    var body: some View {
        let dark = colorScheme == .dark
        ZStack {
            Theme.background
            RadialGradient(colors: [hue.fill.opacity(dark ? 0.20 : 0.30), hue.fill.opacity(0)],
                           center: UnitPoint(x: 0.95, y: 0), startRadius: 0, endRadius: 340)
            RadialGradient(colors: [hue.glow.opacity(dark ? 0.12 : 0.22), hue.glow.opacity(0)],
                           center: UnitPoint(x: 0, y: 0.08), startRadius: 0, endRadius: 220)
        }
        .ignoresSafeArea()
        .animation(Motion.gentle, value: hue)
    }
}

/// Large title, avatar button and horizontal bubble chips with "+ New".
struct ShellHeader: View {
    @Environment(SessionStore.self) private var session
    @Environment(ShellRouter.self) private var router
    @Environment(UnreadStore.self) private var unread
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var chips
    var title: LocalizedStringResource

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center) {
                Text(title)
                    .font(.rounded(.largeTitle, weight: .heavy))
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .contentTransition(reduceMotion ? .opacity : .numericText())
                    .animation(Motion.resolve(Motion.snappy, reduceMotion: reduceMotion), value: router.tab)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("screen-title")
                Spacer()
                Button { router.showProfile = true } label: {
                    AvatarView(user: session.profile, size: 44)
                        .floatingShadow(Hue.grape.fill)
                }
                .buttonStyle(.squishIcon)
                .accessibilityLabel(Text("Profile"))
                .accessibilityIdentifier("profile-button")
            }
            .padding(.horizontal, 20)

            ScrollViewReader { proxy in
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(session.bubbles) { bubble in
                            let active = bubble.id == session.currentBubble?.id
                            Button {
                                withAnimation(Motion.resolve(Motion.snappy, reduceMotion: reduceMotion)) { session.selectBubble(bubble.id) }
                            } label: {
                                BubbleChip(bubble: bubble, isActive: active, namespace: chips, unread: unread.count(for: bubble.id))
                            }
                            .buttonStyle(.squish)
                            .id(bubble.id)
                            .accessibilityIdentifier("bubble-chip-\(bubble.name)")
                            .accessibilityAddTraits(active ? .isSelected : [])
                        }
                        Button { router.showAddBubble = true } label: {
                            ChipView(title: String(localized: "New", comment: "Chip that creates or joins another bubble"), isActive: false, systemImage: "plus", outlined: true)
                        }
                        .buttonStyle(.squish)
                        .accessibilityIdentifier("bubble-chip-new")
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 6)
                }
                .onChange(of: session.currentBubble?.id) { _, id in
                    if let id { withAnimation { proxy.scrollTo(id, anchor: .center) } }
                }
            }
        }
        .padding(.top, 8)
        .padding(.bottom, 6)
    }
}

/// Bubble switcher chip: the bubble's photo (or a little glossy bubble in its own colour) plus its name.
/// The filled capsule slides between chips and takes the colour of the bubble it lands on.
struct BubbleChip: View {
    var bubble: Bubble
    var isActive: Bool
    var namespace: Namespace.ID
    var unread = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let hue = Hue.forID(bubble.id)
        HStack(spacing: 7) {
            BubbleLogo(bubble: bubble, size: bubble.logo == nil ? 16 : 26)
                .accessibilityHidden(true)
                .overlay(Circle().strokeBorder(.white.opacity(isActive ? 0.9 : 0), lineWidth: 1.5))
                .phaseAnimator(reduceMotion ? [1.0] : [1.0, 1.45, 1.0], trigger: isActive) { orb, scale in
                    orb.scaleEffect(scale)
                } animation: { _ in Motion.bouncy }
            Text(verbatim: bubble.name).font(.rounded(.subheadline)).lineLimit(1)
            UnreadBadge(count: unread, inverted: isActive)
        }
        .foregroundStyle(isActive ? hue.onFill : Theme.ink)
        .padding(.leading, 11)
        .padding(.trailing, 16)
        .frame(minHeight: 38)
        .background {
            if isActive {
                Capsule().fill(hue.gradient)
                    .shadow(color: hue.fill.opacity(0.4), radius: 8, y: 4)
                    .matchedGeometryEffect(id: "active-bubble", in: namespace)
            } else {
                Capsule().fill(Theme.card).overlay(Capsule().strokeBorder(Theme.hairline, lineWidth: 1))
            }
        }
        .contentShape(Capsule())
    }
}

/// The floating dock: pill tab bar plus the round chat button, with a fade so content dissolves beneath it.
struct Dock: View {
    @Binding var selection: MainTab
    var unread = 0
    var onChat: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            PillTabBar(selection: $selection)
            ChatFAB(unread: unread, action: onChat)
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
        .padding(.top, 28)
        .frame(maxWidth: .infinity)
        .background {
            LinearGradient(stops: [.init(color: Theme.background.opacity(0), location: 0),
                                   .init(color: Theme.background.opacity(0.9), location: 0.5),
                                   .init(color: Theme.background, location: 1)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
                .allowsHitTesting(false)
        }
    }
}

/// Floating pill of icon buttons. A filled circle slides to the active tab and takes that tab's colour.
struct PillTabBar: View {
    @Binding var selection: MainTab
    @Namespace private var namespace
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 2) {
            ForEach(MainTab.allCases) { tab in
                let active = tab == selection
                Button {
                    withAnimation(Motion.resolve(Motion.snappy, reduceMotion: reduceMotion)) { selection = tab }
                } label: {
                    Image(systemName: active ? tab.activeIcon : tab.icon)
                        .font(.system(size: 20, weight: .bold))
                        .symbolEffect(.bounce, value: active)
                        .foregroundStyle(active ? tab.hue.onFill : Theme.inkSecondary)
                        .frame(maxWidth: 52, minHeight: 52, maxHeight: 52)
                        .background {
                            if active {
                                Circle().fill(tab.hue.gradient)
                                    .shadow(color: tab.hue.fill.opacity(0.45), radius: 8, y: 4)
                                    .matchedGeometryEffect(id: "active-tab", in: namespace)
                            }
                        }
                        .contentShape(Circle())
                }
                .buttonStyle(.squishIcon)
                .accessibilityLabel(Text(tab.title))
                .accessibilityIdentifier("tab-\(tab.rawValue)")
                .accessibilityAddTraits(active ? .isSelected : [])
            }
        }
        .padding(6)
        .background(.regularMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(Theme.hairline, lineWidth: 1))
        .floatingShadow()
    }
}

/// Round chat button: a glossy grape bubble with a slow pulse ring.
struct ChatFAB: View {
    var unread = 0
    var action: () -> Void
    @State private var taps = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button {
            taps += 1
            action()
        } label: {
            ZStack {
                if !reduceMotion {
                    TimelineView(.animation(minimumInterval: 1.0 / 60.0)) { timeline in
                        let t = timeline.date.timeIntervalSinceReferenceDate / 3.2
                        let phase = t - t.rounded(.down)
                        Circle().stroke(Hue.grape.fill.opacity(0.45 * (1 - phase)), lineWidth: 2)
                            .scaleEffect(1 + 0.4 * phase)
                    }
                }
                BubbleOrb(hue: .grape)
                Image(systemName: Feature.chat.icon)
                    .font(.system(size: 21, weight: .bold))
                    .foregroundStyle(.white)
                    .symbolEffect(.bounce, value: taps)
            }
            .frame(width: 60, height: 60)
            .floatingShadow(Hue.grape.fill)
            .overlay(alignment: .topTrailing) {
                UnreadBadge(count: unread, inverted: false, bordered: true).offset(x: 6, y: -4)
            }
        }
        .buttonStyle(.squishIcon)
        .sensoryFeedback(.impact(weight: .light), trigger: taps)
        .accessibilityLabel("Open chat")
        .accessibilityValue(unread > 0 ? Text(UnreadBadge.label(unread)) : Text(verbatim: ""))
        .accessibilityIdentifier("chat-fab")
    }
}

/// Unread chat messages: the number up to 99, "99+" above, nothing at 0.
struct UnreadBadge: View {
    var count: Int
    /// On a filled (active) chip: white badge with coloured text.
    var inverted = false
    var bordered = false

    static func label(_ count: Int) -> String {
        String(localized: "\(count) unread messages", comment: "Accessibility label of the unread badge; the argument is the count (99+ shown above 99)")
    }

    var body: some View {
        if let text = ChatUnread.badgeText(count) {
            Text(verbatim: text)
                .font(.system(size: 12, weight: .heavy, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(inverted ? Hue.coral.text : .white)
                .padding(.horizontal, 6)
                .frame(minWidth: 20, minHeight: 20)
                .background(inverted ? AnyShapeStyle(Color.white) : AnyShapeStyle(Hue.coral.gradient), in: Capsule())
                .overlay { if bordered { Capsule().strokeBorder(Theme.background, lineWidth: 2) } }
                .contentTransition(.numericText(value: Double(count)))
                .animation(Motion.snappy, value: count)
                .accessibilityLabel(Text(Self.label(count)))
                .accessibilityIdentifier("unread-badge")
                .transition(.scale.combined(with: .opacity))
        }
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
                    SegmentedPill(selection: $mode, options: OnboardingView.Mode.options)

                    if mode == .join {
                        if requested != nil {
                            Label("Request sent. The members of the bubble will vote on it.",
                                  systemImage: "checkmark.seal.fill")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Hue.mint.text)
                                .padding(14)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(Hue.mint.wash, in: RoundedRectangle(cornerRadius: Theme.Radius.field, style: .continuous))
                                .transition(.scale(scale: 0.9).combined(with: .opacity))
                        }
                        JoinBubbleForm { request in withAnimation(Motion.bouncy) { requested = request } }
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
