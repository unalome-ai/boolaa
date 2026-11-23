import SwiftUI

/// One entry of the combined Home feed.
enum FeedItem: Identifiable, Hashable, Sendable {
    case message(ChatMessage)
    case food(FoodPost)
    case market(MarketItem)
    case event(BubbleEvent)
    case link(SharedLink)

    var id: String {
        switch self {
        case .message(let m): "m-\(m.id)"
        case .food(let f): "f-\(f.id)"
        case .market(let i): "i-\(i.id)"
        case .event(let e): "e-\(e.id)"
        case .link(let l): "l-\(l.id)"
        }
    }

    /// What Report/Block act on for this card.
    var reportTarget: ReportTarget {
        switch self {
        case .message(let m): .message(m)
        case .food(let f): .food(f)
        case .market(let i): .market(i)
        case .event(let e): .event(e)
        case .link(let l): .link(l)
        }
    }

    /// Recency key: when the item was posted.
    var date: Date {
        switch self {
        case .message(let m): m.createdAt
        case .food(let f): f.createdAt
        case .market(let i): i.createdAt
        case .event(let e): e.createdAt
        case .link(let l): l.createdAt
        }
    }

    /// Merges the sections into one feed, newest first.
    static func combine(messages: [ChatMessage], food: [FoodPost], market: [MarketItem],
                        events: [BubbleEvent], links: [SharedLink]) -> [FeedItem] {
        (messages.map(FeedItem.message) + food.map(FeedItem.food) + market.map(FeedItem.market)
         + events.map(FeedItem.event) + links.map(FeedItem.link))
            .sorted { $0.date > $1.date }
    }
}

@MainActor
@Observable
final class HomeModel: CacheFirstModel {
    var items: [FeedItem] = []
    var loaded = false
    var failed = false
    var error: String?

    /// What the offline cache keeps for Home (`home.<bubble id>`).
    struct Snapshot: Codable, Sendable {
        var messages: [ChatMessage]
        var food: [FoodPost]
        var market: [MarketItem]
        var events: [BubbleEvent]
        var links: [SharedLink]
    }

    /// The cached feed first (offline / slow network), then the server's.
    func load(api: BoolaaAPI, bubbleID: UUID) async {
        await loadCacheFirst(
            key: OfflineCache.Key.home(bubbleID),
            apply: { (s: Snapshot) in
                // Cached upcoming events may have started meanwhile; the feed only lists upcoming ones.
                items = FeedItem.combine(messages: s.messages, food: s.food, market: s.market,
                                         events: s.events.filter { $0.datetime >= .now }, links: s.links)
            },
            fetch: {
                async let m = api.chatMessages(bubbleID: bubbleID, limit: 5, includeDeleted: false)
                async let f = api.foodPosts(bubbleID: bubbleID, limit: 5)
                async let i = api.marketItems(bubbleID: bubbleID, limit: 5)
                async let e = api.upcomingEvents(bubbleID: bubbleID, limit: 5)
                async let l = api.links(bubbleID: bubbleID, limit: 5)
                return try await Snapshot(messages: m, food: f, market: i, events: e, links: l)
            })
    }
}

struct HomeView: View {
    @Environment(SessionStore.self) private var session
    @Environment(Connectivity.self) private var connectivity
    @Environment(ShellRouter.self) private var router
    @State private var model = HomeModel()

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                if let bubble = session.currentBubble {
                    BubbleHero(bubble: bubble, firstName: session.profile?.displayName.split(separator: " ").first.map(String.init)) {
                        router.open(.links)
                    }
                    .popIn(0)
                }
                // After the first bubble: explain, then (on tap) the iOS prompt. Never at launch.
                PushPermissionCard(showsDismiss: true).transition(.opacity)

                LoadIssueView(failed: model.failed, hasContent: model.loaded) { await reload() }
                if model.loaded && model.items.isEmpty {
                    EmptyStateView(icon: "sparkles", title: "Nothing here yet",
                                   message: "Say hi in the chat, plan an event or share some food.")
                }
                if !model.items.isEmpty {
                    SectionHeader(title: "What's new")
                }
                ForEach(Array(model.items.enumerated()), id: \.element.id) { index, item in
                    Button { open(item) } label: { FeedCard(item: item) }
                        .buttonStyle(.squish)
                        .safetyContextMenu(item.reportTarget)
                        .scrollFade()
                        .popIn(index + 1)
                }
                if !model.loaded && !model.failed { Delayed { SkeletonList().padding(.top, 8) } }
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)
            .padding(.bottom, Theme.tabBarClearance)
        }
        .refreshFeedback { await reload() }
        // Also after reconnecting or coming back to the foreground (Connectivity.refreshGeneration).
        .task(id: connectivity.refreshGeneration) { await reload() }
        .autoRetry(failed: model.failed) { await reload() }
        .errorAlert($model.error)
    }

    private func reload() async {
        guard let id = session.currentBubble?.id else { return }
        await model.load(api: session.api, bubbleID: id)
    }

    private func open(_ item: FeedItem) {
        withAnimation(Motion.snappy) {
            switch item {
            case .message: router.open(.chat)
            case .food: router.tab = .food
            case .market: router.tab = .marketplace
            case .event: router.tab = .events
            case .link: router.open(.links)
            }
        }
    }
}

/// The current bubble as a big, glossy card in its own colour.
struct BubbleHero: View {
    var bubble: Bubble
    var firstName: String?
    var onLinks: () -> Void

    var body: some View {
        let hue = Hue.forID(bubble.id)
        VStack(alignment: .leading, spacing: 6) {
            if let firstName {
                Text("Hi, \(firstName)!", comment: "Greeting on the Home card; the argument is the user's first name")
                    .font(.rounded(.subheadline, weight: .semibold))
            }
            Text(verbatim: bubble.name)
                .font(.rounded(.title, weight: .heavy))
                .lineLimit(2).minimumScaleFactor(0.75)
            if let d = bubble.description?.nilIfEmpty {
                Text(verbatim: d).font(.subheadline.weight(.medium)).lineLimit(3)
            }
            Button(action: onLinks) {
                Label("Links", systemImage: "link")
                    .font(.rounded(.subheadline))
                    .padding(.horizontal, 14)
                    .frame(minHeight: 36)
                    .background(hue.onFill.opacity(0.16), in: Capsule())
                    .overlay(Capsule().strokeBorder(hue.onFill.opacity(0.25), lineWidth: 1))
            }
            .buttonStyle(.squish)
            .padding(.top, 8)
            .accessibilityIdentifier("home-links")
        }
        .foregroundStyle(hue.onFill)
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            ZStack(alignment: .topTrailing) {
                LinearGradient(colors: hue.onFill == .white ? [hue.fill, hue.deep] : [hue.glow, hue.fill],
                               startPoint: .topLeading, endPoint: .bottomTrailing)
                // Decorative bubbles, shapes only.
                Circle().fill(.white.opacity(0.16)).frame(width: 150, height: 150).offset(x: 46, y: -58)
                Circle().fill(.white.opacity(0.14)).frame(width: 64, height: 64).offset(x: -96, y: 62)
                    .floating(amplitude: 4, period: 6)
                Circle().strokeBorder(.white.opacity(0.35), lineWidth: 1.5).frame(width: 30, height: 30).offset(x: -40, y: 22)
                    .floating(amplitude: 6, period: 4.5, phase: 0.4)
            }
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.hero, style: .continuous))
            .shadow(color: hue.fill.opacity(0.35), radius: 16, y: 10)
        }
    }
}

struct FeedCard: View {
    var item: FeedItem

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            FeatureBadge(icon: feature.icon, hue: feature.hue)

            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(kind).font(.rounded(.caption)).foregroundStyle(feature.hue.text).textCase(.uppercase)
                        .lineLimit(1).minimumScaleFactor(0.8)
                    Spacer()
                    Text(item.date.relativeShort).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Text(verbatim: title).font(.body.weight(.semibold)).lineLimit(2).foregroundStyle(.primary)
                    .multilineTextAlignment(.leading)
                if let subtitle { Text(verbatim: subtitle).font(.subheadline).foregroundStyle(.secondary).lineLimit(2) }
            }
            if let image {
                RemoteImage(url: image, hue: feature.hue)
                    .frame(width: 60, height: 60)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
        }
        .card()
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("feed-\(item.id)")
    }

    private var feature: Feature {
        switch item {
        case .message: .chat
        case .food: .food
        case .market: .market
        case .event: .events
        case .link: .links
        }
    }

    private var kind: LocalizedStringResource {
        switch item {
        case .message: LocalizedStringResource("Chat", comment: "Home feed card kind")
        case .food: LocalizedStringResource("Food Circle", comment: "Home feed card kind")
        case .market: LocalizedStringResource("Marketplace", comment: "Home feed card kind")
        case .event: LocalizedStringResource("Upcoming event", comment: "Home feed card kind")
        case .link: LocalizedStringResource("Link", comment: "Home feed card kind")
        }
    }

    private var title: String {
        switch item {
        case .message(let m): Self.messageTitle(m)
        case .food(let f): f.description?.nilIfEmpty ?? String(localized: "New food post")
        case .market(let i): i.title
        case .event(let e): e.title
        case .link(let l): l.title?.nilIfEmpty ?? l.url
        }
    }

    /// A photo without a caption shows the "Photo" label.
    static func messageTitle(_ m: ChatMessage) -> String {
        m.content.nilIfEmpty ?? (m.imagePath != nil ? String(localized: "Photo", comment: "Home card / chat preview for a photo message without a caption") : "")
    }

    private var subtitle: String? {
        switch item {
        case .message(let m): m.sender?.displayName
        case .food(let f): f.user.map { String(localized: "by \($0.displayName)", comment: "Author line; the argument is a name") }
        case .market(let i): [String(localized: i.status.label), i.owner?.displayName].compactMap { $0 }.joined(separator: " · ")
        case .event(let e): [e.datetime.formatted(date: .abbreviated, time: .shortened), e.location].compactMap { $0 }.joined(separator: " · ")
        case .link(let l): l.tags.isEmpty ? URL(string: l.url)?.host() : l.tags.map { "#\($0)" }.joined(separator: " ")
        }
    }

    private var image: String? {
        switch item {
        case .food(let f): f.image
        case .market(let i): i.image
        default: nil
        }
    }
}
