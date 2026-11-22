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
final class HomeModel {
    var items: [FeedItem] = []
    var loaded = false
    var error: String?

    func load(api: BoolaaAPI, bubbleID: UUID) async {
        do {
            async let m = api.chatMessages(bubbleID: bubbleID, limit: 5)
            async let f = api.foodPosts(bubbleID: bubbleID, limit: 5)
            async let i = api.marketItems(bubbleID: bubbleID, limit: 5)
            async let e = api.upcomingEvents(bubbleID: bubbleID, limit: 5)
            async let l = api.links(bubbleID: bubbleID, limit: 5)
            items = try await FeedItem.combine(messages: m, food: f, market: i, events: e, links: l)
        } catch {
            self.error = error.userMessage
        }
        loaded = true
    }
}

struct HomeView: View {
    @Environment(SessionStore.self) private var session
    @Environment(ShellRouter.self) private var router
    @State private var model = HomeModel()

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                if let bubble = session.currentBubble {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(verbatim: bubble.name).font(.headline)
                            if let d = bubble.description { Text(verbatim: d).font(.subheadline).foregroundStyle(.secondary) }
                        }
                        Spacer()
                        Button { router.open(.links) } label: {
                            Label("Links", systemImage: "link").font(.subheadline.weight(.semibold))
                        }
                        .buttonStyle(.bordered)
                        .accessibilityIdentifier("home-links")
                    }
                    .card()
                }

                if model.loaded && model.items.isEmpty {
                    EmptyStateView(icon: "sparkles", title: "Nothing here yet",
                                   message: "Say hi in the chat, plan an event or share some food.")
                }
                ForEach(model.items) { item in
                    Button { open(item) } label: { FeedCard(item: item) }
                        .buttonStyle(.plain)
                        .safetyContextMenu(item.reportTarget)
                }
                if !model.loaded { ProgressView().frame(maxWidth: .infinity).padding(40) }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, Theme.tabBarClearance)
        }
        .refreshable { await reload() }
        .task { await reload() }
        .errorAlert($model.error)
    }

    private func reload() async {
        guard let id = session.currentBubble?.id else { return }
        await model.load(api: session.api, bubbleID: id)
    }

    private func open(_ item: FeedItem) {
        switch item {
        case .message: router.open(.chat)
        case .food: router.tab = .food
        case .market: router.tab = .marketplace
        case .event: router.tab = .events
        case .link: router.open(.links)
        }
    }
}

struct FeedCard: View {
    var item: FeedItem

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.brand.opacity(0.14))
                Image(systemName: icon).foregroundStyle(Theme.brand).font(.system(size: 17, weight: .semibold))
            }
            .frame(width: 42, height: 42)

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(kind).font(.caption.weight(.bold)).foregroundStyle(Theme.brand).textCase(.uppercase)
                        .lineLimit(1).minimumScaleFactor(0.8)
                    Spacer()
                    Text(item.date.relativeShort).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Text(verbatim: title).font(.body.weight(.semibold)).lineLimit(2).foregroundStyle(.primary)
                if let subtitle { Text(verbatim: subtitle).font(.subheadline).foregroundStyle(.secondary).lineLimit(2) }
            }
            if let image {
                RemoteImage(url: image)
                    .frame(width: 56, height: 56)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
        }
        .card()
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("feed-\(item.id)")
    }

    private var icon: String {
        switch item {
        case .message: "bubble.left.fill"
        case .food: "fork.knife"
        case .market: "tag.fill"
        case .event: "calendar"
        case .link: "link"
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
        case .message(let m): m.content
        case .food(let f): f.description?.nilIfEmpty ?? String(localized: "New food post")
        case .market(let i): i.title
        case .event(let e): e.title
        case .link(let l): l.title?.nilIfEmpty ?? l.url
        }
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
