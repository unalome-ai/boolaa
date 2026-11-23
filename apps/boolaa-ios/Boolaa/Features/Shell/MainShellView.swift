import SwiftUI

/// Main shell: header with bubble switcher, the current tab, floating pill tab bar and chat button (spec §4).
struct MainShellView: View {
    @Environment(SessionStore.self) private var session
    @Environment(SafetyStore.self) private var safety
    @Environment(UnreadStore.self) private var unread
    @Environment(PushCenter.self) private var push
    @Environment(\.scenePhase) private var scenePhase
    @State private var router = ShellRouter()
    @State private var appliedDebugHooks = false
    @State private var showMascots = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        NavigationStack(path: $router.path) {
            VStack(spacing: 0) {
                ShellHeader(title: router.tab.title)
                    // §8.1: the band is exactly as tall as the header (plus the status bar above it).
                    .background { FeatureBand(hue: router.tab.bandScreen.hue(bubble: bubbleHue)).ignoresSafeArea(edges: .top) }
                ConnectivityBanner()
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
            .background { ShellBackground() }
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
        .overlay { CheerHost() }
        .environment(router)
        .sheet(isPresented: $router.showProfile) { ProfileSheet().boolaaSheet() }
        .sheet(isPresented: $router.showAddBubble) { AddBubbleSheet().boolaaSheet() }
        #if DEBUG
        .sheet(isPresented: $showMascots) { MascotGallery().boolaaSheet() }
        #endif
        .sheet(isPresented: $router.showSearch) { SearchView().environment(router).boolaaSheet() }
        .sheet(item: Binding(get: { safety.reportTarget }, set: { safety.reportTarget = $0 })) { ReportSheet(target: $0).calmSurface().boolaaSheet() }
        .haptic(.tabSwitch, trigger: router.tab)
        .haptic(.bubbleSwitch, trigger: session.currentBubble?.id)
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
        .onChange(of: Connectivity.shared.refreshGeneration) { _, _ in
            Task {
                await unread.refresh()
                if !safety.loaded { await safety.load() }
            }
        }
        .onAppear(perform: applyDebugHooks)
        // A tapped notification (docs/push-notifications.md §5), also one that launched the app.
        .task(id: push.pendingRoute?.id) { applyPushRoute() }
    }

    /// Switches to the bubble in the payload and opens its screen; a bubble the user is no longer in opens Home.
    private func applyPushRoute() {
        guard let route = push.pendingRoute else { return }
        push.pendingRoute = nil
        let target = route.resolve(joined: Set(session.bubbles.map(\.id)))
        router.showProfile = false
        router.showAddBubble = false
        router.path = []
        if let bubble = target.bubble { session.selectBubble(bubble) }
        router.highlight = target.highlight
        router.openRequestsFor = target.openRequests
        switch target.destination {
        case .home: router.tab = .home
        case .chat: router.open(.chat)
        case .joinRequests: router.scrollToRequests = true; router.tab = .settings
        case .events: router.tab = .events
        case .food: router.tab = .food
        case .marketplace: router.tab = .marketplace
        }
    }

    private var bubbleHue: Hue { Hue.forID(session.currentBubble?.id) }

    /// New content rises 14 pt with a little swell (`gentle`); old content just fades. Reduce Motion: a fade.
    private var contentTransition: AnyTransition {
        reduceMotion ? AnyTransition.opacity.animation(Motion.fade)
            : AnyTransition.asymmetric(insertion: .opacity.combined(with: .offset(y: 14)).combined(with: .scale(scale: 0.98)), removal: .opacity)
                .animation(Motion.gentle)
    }

    private func applyDebugHooks() {
        guard !appliedDebugHooks else { return }
        appliedDebugHooks = true
        if let tab = DebugHooks.initialTab { router.tab = tab }
        switch DebugHooks.initialOpen {
        case "chat": router.open(.chat)
        case "links": router.open(.links)
        case "profile", "blocked", "deleteAccount", "security", "notifications", "exportData": router.showProfile = true
        case "report": Task { await openDebugReport() }
        case "addBubble": router.showAddBubble = true
        #if DEBUG
        case "mascots": showMascots = true
        #endif
        default: break
        }
        #if DEBUG
        // Screenshots of the cheer toast (-UITestCheer going|firstEvent|firstPost|firstItem; "joined" plays on Home).
        if let kind = DebugHooks.string("UITestCheer"), kind != "joined" {
            Task {
                try? await Task.sleep(for: .seconds(2))
                switch kind {
                case "firstEvent": CheerCenter.shared.show(CheerCenter.firstEvent, hue: .coral)
                case "firstPost": CheerCenter.shared.show(CheerCenter.firstPost, hue: .tangerine)
                case "firstItem": CheerCenter.shared.show(CheerCenter.firstItem, hue: .mint)
                default: CheerCenter.shared.show(CheerCenter.going, hue: .mint)
                }
            }
        }
        // A tapped chat push for another bubble while the chat is open (QA: the chat must land at the newest message).
        if let name = UserDefaults.standard.string(forKey: "UITestPushToBubble"), !name.isEmpty {
            Task {
                try? await Task.sleep(for: .seconds(4))
                guard let bubble = session.bubbles.first(where: { $0.name == name }) else { return }
                push.pendingRoute = PushRoute(payload: PushPayload(kind: .chat, bubbleID: bubble.id))
            }
        }
        #endif
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

/// App background. The header glow of §2.4 gave way to the feature band (§8.1) on every main screen.
struct ShellBackground: View {
    var body: some View {
        Theme.background.ignoresSafeArea()
    }
}

/// Large title, avatar button and horizontal bubble chips with "+ New".
struct ShellHeader: View {
    @Environment(SessionStore.self) private var session
    @Environment(ShellRouter.self) private var router
    @Environment(UnreadStore.self) private var unread
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var chips
    @State private var addTaps = 0
    var title: LocalizedStringResource

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center) {
                // §8.5: 38 black rounded; the brand gradient on Home only (its band is the brand colour).
                DisplayTitle(title: title, gradient: router.tab == .home)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("screen-title")
                Spacer(minLength: 8)
                if session.currentBubble != nil {
                    Button { router.showSearch = true } label: {
                        Image(systemName: "magnifyingglass")
                            .font(.system(size: 18, weight: .heavy))
                            .foregroundStyle(Theme.brandText)
                            .frame(width: 44, height: 44)
                            .background(Circle().fill(Theme.card))
                            .cardChrome(radius: 22)
                    }
                    .buttonStyle(.squishIcon)
                    .accessibilityLabel(Text("Search this bubble"))
                    .accessibilityIdentifier("search-button")
                }
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
                        Button { addTaps += 1; router.showAddBubble = true } label: {
                            ChipView(title: String(localized: "New", comment: "Chip that creates or joins another bubble"), isActive: false, systemImage: "plus", outlined: true)
                        }
                        .buttonStyle(.squish)
                        .haptic(.add, trigger: addTaps)
                        .accessibilityIdentifier("bubble-chip-new")
                    }
                    .padding(.horizontal, 20)
                    .padding(.vertical, 6)
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text("Your bubbles", comment: "Accessibility label of the bubble switcher chip row"))
                .onChange(of: session.currentBubble?.id) { _, id in
                    if let id { withAnimation(Motion.resolve(Motion.gentle, reduceMotion: reduceMotion)) { proxy.scrollTo(id, anchor: .center) } }
                }
            }
        }
        .padding(.top, 8)
        .padding(.bottom, 10) // + the chip row's 6 = 16 below the chips (§8.1)
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
        .minimumHitTarget()
    }
}

/// The floating dock (§8.3): the labelled glass tab bar plus the round chat button, with a fade so content
/// dissolves beneath it. Re-measures on rotation, width, text-size and locale changes.
struct Dock: View {
    @Binding var selection: MainTab
    var unread = 0
    var onChat: () -> Void
    @State private var rowWidth: CGFloat = 0

    var body: some View {
        let margin = DockLayout.sideMargin(rowWidth: rowWidth)
        HStack(spacing: DockLayout.gap) {
            PillTabBar(selection: $selection, barWidth: DockLayout.barWidth(rowWidth: rowWidth), rowWidth: rowWidth)
            ChatFAB(unread: unread, action: onChat)
        }
        .padding(.horizontal, margin)
        .padding(.bottom, 8)
        .padding(.top, 28)
        .frame(maxWidth: .infinity)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { rowWidth = $0 }
        .background {
            LinearGradient(stops: [.init(color: Theme.background.opacity(0), location: 0),
                                   .init(color: Theme.background.opacity(0.9), location: 0.5),
                                   .init(color: Theme.background, location: 1)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
                .allowsHitTesting(false)
        }
    }
}

/// Glass pill tab bar. The active tab is a capsule in the feature gradient with icon + short label that slides
/// and stretches between tabs (`snappy`); when the label doesn't fit (or at the accessibility text sizes) it is a
/// 46 pt circle and the name lives on as the accessibility label. Reduce Motion: the pill jumps, the label fades.
struct PillTabBar: View {
    @Binding var selection: MainTab
    var barWidth: CGFloat
    var rowWidth: CGFloat
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.locale) private var locale
    @ScaledMetric(relativeTo: .subheadline) private var labelSize: CGFloat = DockLayout.labelFontSize

    private var activeIndex: Int { MainTab.allCases.firstIndex(of: selection) ?? 0 }

    /// The active pill's width with its label, or nil for the icon-only fallback.
    private var labelledWidth: CGFloat? {
        guard rowWidth > 0 else { return nil }
        let width = DockLayout.measure(String(localized: selection.dockLabel), fontSize: labelSize)
        guard DockLayout.showsLabel(labelWidth: width, rowWidth: rowWidth, accessibilitySize: typeSize.isAccessibilitySize) else { return nil }
        return DockLayout.labelledPillWidth(labelWidth: width)
    }

    var body: some View {
        let pill = labelledWidth
        let slots = DockLayout.slotWidths(barWidth: max(barWidth, 0), activeIndex: activeIndex, activePillWidth: pill)
        let before = slots.prefix(activeIndex).reduce(0, +)
        let indicatorWidth = pill ?? DockLayout.tabHeight
        let indicatorX = before + (pill == nil ? (slots[activeIndex] - DockLayout.tabHeight) / 2 : 0)
        let hue = selection.hue
        HStack(spacing: 0) {
            ForEach(Array(MainTab.allCases.enumerated()), id: \.element) { index, tab in
                tabButton(tab, width: slots[index], labelled: tab == selection && pill != nil)
            }
        }
        .background(alignment: .leading) {
            Capsule().fill(hue.gradient)
                .animation(.easeOut(duration: 0.2), value: hue)
                .shadow(color: hue.fill.opacity(0.45), radius: 8, y: 4)
                .frame(width: indicatorWidth, height: DockLayout.tabHeight)
                .offset(x: indicatorX)
                .accessibilityHidden(true)
        }
        .padding(DockLayout.barPadding)
        .frame(width: barWidth > 0 ? barWidth : nil, alignment: .leading)
        .background { glass }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Main navigation", comment: "Accessibility label of the tab bar"))
        .id(locale.identifier) // re-measure on a locale change
    }

    private func tabButton(_ tab: MainTab, width: CGFloat, labelled: Bool) -> some View {
        let active = tab == selection
        return Button {
            withAnimation(reduceMotion ? nil : Motion.snappy) { selection = tab }
        } label: {
            HStack(spacing: DockLayout.iconGap) {
                Image(systemName: active ? tab.activeIcon : tab.icon)
                    .font(.system(size: DockLayout.icon, weight: active ? .heavy : .semibold))
                    .frame(width: DockLayout.icon + 4)
                    // Icon pop: 0.4 → 1 with `bouncy` when the tab becomes active (still under Reduce Motion).
                    .phaseAnimator(reduceMotion || !active ? [1.0] : [1.0, 0.4, 1.0], trigger: active) { icon, scale in
                        icon.scaleEffect(scale)
                    } animation: { scale in scale == 0.4 ? .linear(duration: 0.01) : Motion.bouncy }
                if labelled {
                    Text(tab.dockLabel)
                        .font(.system(size: labelSize, weight: .heavy, design: .rounded))
                        .lineLimit(1)
                        .fixedSize()
                        .transition(reduceMotion ? AnyTransition.opacity.animation(.easeOut(duration: 0.2))
                                    : AnyTransition.opacity.combined(with: .offset(x: -4)).animation(.easeOut(duration: 0.2).delay(0.06)))
                }
            }
            .foregroundStyle(active ? tab.hue.onFill : Theme.inkSecondary)
            .padding(.leading, labelled ? DockLayout.pillLeading - 2 : 0)
            .padding(.trailing, labelled ? DockLayout.pillTrailing - 2 : 0)
            .frame(width: max(width, 0), height: DockLayout.tabHeight, alignment: labelled ? .leading : .center)
            // The hit area reaches into the bar's padding: at least 44 pt high, the slot's full width.
            .contentShape(Rectangle().inset(by: -DockLayout.barPadding))
        }
        .buttonStyle(.squishIcon)
        // The visible label (when shown) is the same short name (label in name).
        .accessibilityLabel(Text(tab.dockLabel))
        .accessibilityIdentifier("tab-\(tab.rawValue)")
        .accessibilityAddTraits(active ? .isSelected : [])
        .help(Text(tab.dockLabel))
        // The dock doesn't grow with Dynamic Type; a long press shows the large label instead.
        .accessibilityShowsLargeContentViewer {
            Image(systemName: tab.activeIcon)
            Text(tab.dockLabel)
        }
    }

    /// Card at 72 % (80 % dark) over the material, a 1 px top highlight, the hairline and a two-layer shadow.
    private var glass: some View {
        let dark = colorScheme == .dark
        return ZStack {
            Capsule().fill(.ultraThinMaterial)
            Capsule().fill(Theme.card.opacity(dark ? Theme.Brand.glassDark : Theme.Brand.glassLight))
            Capsule().strokeBorder(Theme.hairline, lineWidth: 1)
            Capsule().strokeBorder(LinearGradient(colors: [.white.opacity(dark ? Theme.Brand.glassEdgeDark : Theme.Brand.glassEdgeLight), .clear],
                                                  startPoint: .top, endPoint: UnitPoint(x: 0.5, y: 0.3)), lineWidth: 1)
        }
        .compositingGroup()
        // CSS 0 16 36 −12 + 0 2 6; SwiftUI has no spread, so the large shadow's radius is a bit tighter (§8 iOS note).
        .shadow(color: dark ? .black.opacity(0.6) : Color(hex: 0x2A1B5E, opacity: 0.32), radius: 13, y: 16)
        .shadow(color: dark ? .black.opacity(0.3) : Color(hex: 0x2A1B5E, opacity: 0.08), radius: 3, y: 2)
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
        .haptic(.add, trigger: taps)
        .accessibilityLabel("Open chat")
        .accessibilityValue(unread > 0 ? Text(UnreadBadge.label(unread)) : Text(verbatim: ""))
        .accessibilityShowsLargeContentViewer {
            Image(systemName: Feature.chat.icon)
            Text("Open chat")
        }
        .accessibilityIdentifier("chat-fab")
    }
}

/// Unread chat messages: the number up to 99, "99+" above, nothing at 0.
struct UnreadBadge: View {
    var count: Int
    /// On a filled (active) chip: white badge with ink text. Otherwise ink on coral (6.1:1), as on Android and
    /// the web; white on coral was 2.8:1.
    var inverted = false
    var bordered = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    static func label(_ count: Int) -> String {
        String(localized: "\(count) unread messages", comment: "Accessibility label of the unread badge; the argument is the count (99+ shown above 99)")
    }

    var body: some View {
        if let text = ChatUnread.badgeText(count) {
            Text(verbatim: text)
                .font(.system(size: 12, weight: .heavy, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(Hue.coral.onFill)
                .padding(.horizontal, 6)
                .frame(minWidth: 20, minHeight: 20)
                .background(inverted ? AnyShapeStyle(Color.white) : AnyShapeStyle(Hue.coral.gradient), in: Capsule())
                .overlay { if bordered { Capsule().strokeBorder(Theme.background, lineWidth: 2) } }
                .contentTransition(reduceMotion ? .opacity : .numericText(value: Double(count)))
                .animation(Motion.resolve(Motion.snappy, reduceMotion: reduceMotion), value: count)
                .accessibilityLabel(Text(Self.label(count)))
                .accessibilityIdentifier("unread-badge")
                .transition(reduceMotion ? .opacity : .scale.combined(with: .opacity))
        }
    }
}

/// "+ New" chip: create another bubble or join one.
struct AddBubbleSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
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
                                .transition(reduceMotion ? .opacity : .scale(scale: 0.9).combined(with: .opacity))
                        }
                        JoinBubbleForm { request in
                            withAnimation(Motion.resolve(Motion.bouncy, reduceMotion: reduceMotion)) { requested = request }
                            A11y.announce(String(localized: "Request sent. The members of the bubble will vote on it."))
                        }
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

#if DEBUG
/// Screenshot aid (-UITestOpen mascots): the four expressions as the app shows them.
private struct MascotGallery: View {
    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                EmptyStateView(title: LocalizedStringResource("Got a plan?", comment: "Events, empty “My events” title"),
                               message: LocalizedStringResource("Dinner, a hike, a film night: start something.", comment: "Events, empty “My events” hint"),
                               hue: .coral)
                HStack(spacing: 12) {
                    gallery(.sleepy)
                    gallery(.worried)
                }
                HStack(spacing: 12) {
                    Mascot(expression: .cheering, hue: .mint, size: 96)
                    Mascot(expression: .curious, hue: .grape, size: 96)
                }
            }
            .padding(20)
        }
        .background(Theme.background)
    }

    private func gallery(_ expression: MascotExpression) -> some View {
        VStack(spacing: 10) {
            Mascot(expression: expression, hue: .grape, size: 72)
            Text("Couldn't load this. Check your connection and try again.", comment: "Inline error when a screen could not load")
                .font(.subheadline).multilineTextAlignment(.center).foregroundStyle(Theme.inkSecondary)
        }
        .frame(maxWidth: .infinity)
        .card()
    }
}
#endif
