import SwiftUI

@MainActor
@Observable
final class MarketModel: CacheFirstModel {
    var items: [MarketItem] = []
    var loaded = false
    var failed = false
    var error: String?
    let reactions = ReactionStore(.marketItem)

    /// The cached view first (offline / slow network), then the server's list.
    func load(api: BoolaaAPI, bubbleID: UUID) async {
        let ok = await loadCacheFirst(key: OfflineCache.Key.market(bubbleID),
                                      apply: { (rows: [MarketItem]) in items = rows },
                                      fetch: { try await api.marketItems(bubbleID: bubbleID).sorted(by: MarketItem.precedes) })
        if ok { await reactions.load(api: api, bubbleID: bubbleID, targetIDs: items.map(\.id)) }
    }

    /// Other members' inserts, edits and deletes stream in until the view goes away (docs/boolaa-spec.md, Realtime tables).
    func listen(api: BoolaaAPI, bubbleID: UUID) async {
        await LiveFeed.observe(MarketItem.self, api: api, bubbleID: bubbleID,
                               rows: { [weak self] in self?.items ?? [] },
                               apply: { [weak self] in self?.items = $0 },
                               reload: { [weak self] in await self?.load(api: api, bubbleID: bubbleID) },
                               reactions: reactions)
    }

    func delete(api: BoolaaAPI, item: MarketItem) async {
        do {
            try await api.deleteMarketItem(id: item.id)
            items.removeAll { $0.id == item.id }
            await api.removeImage(publicURL: item.image, bucket: .market, userID: item.ownerId)
        } catch { self.error = error.userMessage }
    }

    /// Owner only. Applied locally at once; other members get the UPDATE live.
    func setAvailability(api: BoolaaAPI, item: MarketItem, _ availability: MarketAvailability) async {
        guard item.availability != availability else { return }
        do {
            try await api.setMarketAvailability(id: item.id, availability)
            if let idx = items.firstIndex(where: { $0.id == item.id }) {
                items[idx].availability = availability
                items.sort(by: MarketItem.precedes)
            }
        } catch { self.error = error.userMessage }
    }

    /// nil filter = All. `hideTaken` drops taken items; the rest keep their order (taken last).
    nonisolated static func filter(_ items: [MarketItem], by status: MarketStatus?, hideTaken: Bool = false) -> [MarketItem] {
        items.filter { (status == nil || $0.status == status) && !(hideTaken && $0.availability == .taken) }
    }
}

/// Grid of items with Free/Trade badges and filter chips (spec §9).
struct MarketplaceView: View {
    @Environment(SessionStore.self) private var session
    @Environment(Connectivity.self) private var connectivity
    @State private var model = MarketModel()
    @State private var filter: MarketStatus?
    @State private var hideTaken = false
    @Environment(ShellRouter.self) private var router
    @State private var editing: MarketEditorTarget?
    @State private var detail: MarketItem?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize

    /// Two columns; one at the accessibility text sizes so titles and badges have room.
    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: 12), count: typeSize.isAccessibilitySize ? 1 : 2)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) {
                        filterChips
                        Spacer(minLength: 4)
                        AddButton(label: "New item", id: "list-item", hue: hue) { editing = .new }.fixedSize()
                    }
                    VStack(alignment: .leading, spacing: 10) {
                        // Longer translations (ro "Ascunde ce e luat") don't fit one line: scroll the chips
                        // edge to edge instead of letting the row widen the whole screen.
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) { filterChips }
                                .padding(.horizontal, 16)
                                .padding(.vertical, 8)
                        }
                        .padding(.horizontal, -16)
                        .padding(.vertical, -8)
                        AddButton(label: "New item", id: "list-item", hue: hue) { editing = .new }
                    }
                }
                let visible = MarketModel.filter(model.items, by: filter, hideTaken: hideTaken)
                if model.loaded && !visible.isEmpty {
                    Text("\(visible.count) items", comment: "Number of marketplace items shown")
                        .font(.rounded(.subheadline, weight: .semibold)).monospacedDigit().foregroundStyle(Theme.inkSecondary)
                        .contentTransition(.numericText(value: Double(visible.count)))
                }
                LoadIssueView(failed: model.failed, hasContent: model.loaded) { await reload() }
                if !model.loaded && !model.failed {
                    Delayed {
                        LazyVGrid(columns: columns, spacing: 12) {
                            ForEach(0..<4, id: \.self) { _ in
                                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous).fill(Theme.field)
                                    .frame(height: 200).modifier(Shimmer())
                            }
                        }
                        .accessibilityHidden(true)
                    }
                }
                if model.loaded && visible.isEmpty {
                    EmptyStateView(title: LocalizedStringResource("Empty stall", comment: "Marketplace empty state title"),
                                   message: LocalizedStringResource("Got something you don't need? Give it away or trade it.", comment: "Marketplace empty state hint"),
                                   hue: MascotPlace.marketplace.hue(bubble: hue))
                }
                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(Array(visible.enumerated()), id: \.element.id) { index, item in
                        Button { detail = item } label: {
                            MarketCard(item: item, isMine: item.ownerId == session.userID,
                                       reactions: model.reactions.summary(for: item.id, me: session.userID))
                        }
                            .buttonStyle(.squish)
                            .safetyContextMenu(.market(item), react: item.ownerId == session.userID ? nil : { react(item, $0) })
                            .modifier(OwnerAvailabilityMenu(item: item, isMine: item.ownerId == session.userID,
                                                            onReact: { react(item, $0) }) { setAvailability(item, $0) })
                            .motionTransition(.scale(scale: 0.85).combined(with: .opacity))
                            .popIn(index)
                            .pushHighlightTarget(item.id)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)
            .padding(.bottom, Theme.tabBarClearance)
            .animation(Motion.resolve(Motion.snappy, reduceMotion: reduceMotion), value: filter)
            .animation(Motion.resolve(Motion.snappy, reduceMotion: reduceMotion), value: hideTaken)
            .animation(Motion.gentle, value: model.items.map(\.availability))
            .animation(Motion.gentle, value: model.items.map(\.id))
        }
        .scrollsToPushHighlight(model.items.map(\.id))
        .refreshFeedback { await reload() }
        // Back online or in the foreground: reload and resubscribe (Connectivity.refreshGeneration).
        .task(id: connectivity.refreshGeneration) {
            await reload()
            if let id = session.currentBubble?.id { await model.listen(api: session.api, bubbleID: id) }
        }
        .autoRetry(failed: model.failed) { await reload() }
        .haptic(.toggle, trigger: filter)
        .haptic(.toggle, trigger: hideTaken)
        .sheet(item: $editing) { target in
            MarketEditor(target: target) {
                if case .new = target, !model.items.contains(where: { $0.ownerId == session.userID }) {
                    CheerCenter.shared.show(CheerCenter.firstItem, hue: .mint)
                }
                Task { await reload() }
            }.boolaaSheet()
        }
        .sheet(item: $detail) { item in
            // The live row, so a status change made meanwhile shows in the open sheet.
            let live = model.items.first { $0.id == item.id } ?? item
            MarketDetail(item: live, isMine: live.ownerId == session.userID,
                         chatDraft: live.chatDraft(me: session.userID),
                         onEdit: { detail = nil; editing = .edit(live) },
                         onDelete: { detail = nil; Task { await model.delete(api: session.api, item: live) } },
                         onAvailability: { setAvailability(live, $0) },
                         onAskInChat: { draft in detail = nil; router.openChat(draft: draft) },
                         reactions: model.reactions.summary(for: live.id, me: session.userID),
                         onReact: { react(live, $0) })
                .boolaaSheet()
        }
        .errorAlert($model.error)
    }

    @ViewBuilder private var filterChips: some View {
        filterChip(String(localized: "All", comment: "Filter chip showing every item"), id: "all", nil).fixedSize()
        filterChip(String(localized: MarketStatus.free.label), id: "free", .free).fixedSize()
        filterChip(String(localized: MarketStatus.trade.label), id: "trade", .trade).fixedSize()
        Button { hideTaken.toggle() } label: {
            ChipView(title: String(localized: "Hide taken", comment: "Filter toggle hiding taken marketplace items"), isActive: hideTaken, hue: hue)
        }
        .buttonStyle(.squish)
        .fixedSize()
        .accessibilityAddTraits(hideTaken ? .isSelected : [])
        .accessibilityIdentifier("market-hide-taken")
    }

    private func setAvailability(_ item: MarketItem, _ availability: MarketAvailability) {
        Task { await model.setAvailability(api: session.api, item: item, availability) }
    }

    private var hue: Hue { Feature.market.hue }

    private func react(_ item: MarketItem, _ kind: ReactionKind) {
        Task {
            if let e = await model.reactions.toggle(api: session.api, target: item.id, kind: kind, me: session.userID) { model.error = e }
        }
    }

    private func filterChip(_ title: String, id: String, _ status: MarketStatus?) -> some View {
        Button { filter = status } label: {
            ChipView(title: title, isActive: filter == status, hue: hue)
        }
        .buttonStyle(.squish)
        .accessibilityAddTraits(filter == status ? .isSelected : [])
        .accessibilityIdentifier("market-filter-\(id)")
    }

    private func reload() async {
        guard let id = session.currentBubble?.id else { return }
        await model.load(api: session.api, bubbleID: id)
    }
}

enum MarketEditorTarget: Identifiable {
    case new
    case edit(MarketItem)
    var id: String { if case .edit(let i) = self { i.id.uuidString } else { "new" } }
}

struct StatusBadge: View {
    var status: MarketStatus
    var body: some View {
        let hue: Hue = status == .free ? .mint : .sunny
        Label { Text(status.label) } icon: { Image(systemName: status == .free ? "gift.fill" : "arrow.left.arrow.right") }
            .labelStyle(.titleAndIcon)
            .font(.rounded(.caption, weight: .heavy))
            .foregroundStyle(hue.onFill)
            .lineLimit(1)
            .fixedSize()
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(hue.gradient, in: Capsule())
            .overlay(Capsule().strokeBorder(.white.opacity(0.5), lineWidth: 1))
    }
}

/// Shown only when an item is reserved or taken.
struct AvailabilityBadge: View {
    var availability: MarketAvailability
    var body: some View {
        if availability != .available {
            let reserved = availability == .reserved
            Label { Text(availability.label) } icon: { Image(systemName: reserved ? "clock.fill" : "checkmark.seal.fill") }
                .labelStyle(.titleAndIcon)
                .font(.rounded(.caption, weight: .heavy))
                .foregroundStyle(reserved ? Hue.tangerine.onFill : .white)
                .lineLimit(1)
                .fixedSize()
                .padding(.horizontal, 10).padding(.vertical, 5)
                .background { if reserved { Capsule().fill(Hue.tangerine.gradient) } else { Capsule().fill(Theme.taken) } }
                .overlay(Capsule().strokeBorder(.white.opacity(0.5), lineWidth: 1))
                .accessibilityIdentifier("availability-\(availability.rawValue)")
        }
    }
}

/// "Mark as" Available / Reserved / Taken for the owner.
struct AvailabilityMenu: View {
    var current: MarketAvailability
    var onPick: (MarketAvailability) -> Void
    var body: some View {
        Section(String(localized: "Mark as", comment: "Menu heading for changing a marketplace item's availability")) {
            ForEach(MarketAvailability.allCases, id: \.self) { option in
                Button { onPick(option) } label: {
                    if option == current { Label { Text(option.label) } icon: { Image(systemName: "checkmark") } } else { Text(option.label) }
                }
                .accessibilityIdentifier("mark-\(option.rawValue)")
            }
        }
    }
}

/// Long press on your own item: "Mark as" Available / Reserved / Taken.
private struct OwnerAvailabilityMenu: ViewModifier {
    var item: MarketItem
    var isMine: Bool
    var onReact: (ReactionKind) -> Void
    var onPick: (MarketAvailability) -> Void
    func body(content: Content) -> some View {
        if isMine {
            content.contextMenu {
                ReactSubmenu(onPick: onReact)
                AvailabilityMenu(current: item.availability, onPick: onPick)
            }
        } else {
            content
        }
    }
}

struct MarketCard: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    var item: MarketItem
    var isMine: Bool
    /// Read-only here (the card is a button); reacting happens in the detail sheet or the long-press menu.
    var reactions: [ReactionSummary] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Color.clear
                .frame(height: 140)
                .overlay {
                    RemoteImage(url: item.image, hue: Feature.market.hue)
                        .saturation(item.availability == .taken ? 0 : 1)
                        .opacity(item.availability == .taken ? 0.55 : 1)
                }
                .clipped()
                .overlay(alignment: .topLeading) { StatusBadge(status: item.status).padding(8) }
                .overlay(alignment: .bottomLeading) { AvailabilityBadge(availability: item.availability).padding(8) }
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: item.title).font(.rounded(.subheadline)).lineLimit(typeSize.isAccessibilitySize ? 3 : 1)
                HStack(spacing: 6) {
                    AvatarView(user: item.owner, size: 20).accessibilityHidden(true)
                    Text(verbatim: isMine ? String(localized: "You", comment: "Shown instead of your own name") : (item.owner?.displayName ?? "")).font(.caption).foregroundStyle(Theme.inkSecondary).lineLimit(1)
                }
                if !reactions.isEmpty {
                    FlowLayout(spacing: 4) {
                        ForEach(reactions) { r in
                            Text(verbatim: "\(r.kind.emoji) \(r.count)")
                                .font(.rounded(.caption2, weight: .bold)).monospacedDigit()
                                .foregroundStyle(r.mine ? Feature.market.hue.text : Theme.inkSecondary)
                                .padding(.horizontal, 7).padding(.vertical, 3)
                                .background(Capsule().fill(r.mine ? Feature.market.hue.wash : Theme.chipInactive))
                                .accessibilityLabel(Text(verbatim: r.kind.chipLabel(count: r.count)))
                                .accessibilityValue(r.mine ? Text("You reacted") : Text(verbatim: ""))
                        }
                    }
                    .padding(.top, 2)
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous))
        .cardChrome()
        .accessibilityIdentifier("market-item-\(item.title)")
    }
}

struct MarketDetail: View {
    @Environment(\.dismiss) private var dismiss
    var item: MarketItem
    var isMine: Bool
    var chatDraft: String? = nil
    var onEdit: () -> Void
    var onDelete: () -> Void
    var onAvailability: (MarketAvailability) -> Void = { _ in }
    var onAskInChat: (String) -> Void = { _ in }
    var reactions: [ReactionSummary] = []
    var onReact: ((ReactionKind) -> Void)? = nil
    @State private var confirmDelete = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Color.clear.frame(height: 300)
                    .overlay { RemoteImage(url: item.image, hue: Feature.market.hue) }
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.hero, style: .continuous))
                    .photoLabel(item.owner?.displayName, present: !item.image.isEmpty)
                AdaptiveStack {
                    Text(verbatim: item.title).font(.rounded(.title2, weight: .heavy))
                        .accessibilityAddTraits(.isHeader)
                    Spacer(minLength: 0)
                    HStack(spacing: 6) {
                        AvailabilityBadge(availability: item.availability)
                        StatusBadge(status: item.status)
                    }
                }
                if let d = item.description?.nilIfEmpty { Text(verbatim: d) }
                HStack {
                    AvatarView(user: item.owner, size: 28).accessibilityHidden(true)
                    Text(verbatim: item.owner?.displayName ?? "").font(.subheadline.weight(.semibold))
                    Text(verbatim: "· " + item.createdAt.relativeShort).font(.subheadline).foregroundStyle(Theme.inkSecondary)
                }
                if let onReact {
                    ReactionBar(summaries: reactions, hue: Feature.market.hue, onToggle: onReact)
                }
                if !isMine, let chatDraft {
                    Button { onAskInChat(chatDraft) } label: {
                        Label { Text("Ask in chat", comment: "Opens the bubble chat with a question about this item") }
                            icon: { Image(systemName: "bubble.left.and.bubble.right.fill") }
                    }
                    .buttonStyle(PrimaryButtonStyle(hue: Feature.market.hue))
                    .accessibilityIdentifier("market-ask-in-chat")
                }
                if isMine {
                    Menu {
                        AvailabilityMenu(current: item.availability, onPick: onAvailability)
                    } label: {
                        Label { Text("Mark as", comment: "Menu heading for changing a marketplace item's availability") + Text(verbatim: ": ") + Text(item.availability.label) }
                            icon: { Image(systemName: "tag.fill") }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .accessibilityIdentifier("market-mark-as")
                    HStack(spacing: 12) {
                        Button("Edit", action: onEdit).buttonStyle(SecondaryButtonStyle())
                        Button("Delete") { confirmDelete = true }.buttonStyle(PrimaryButtonStyle(hue: .coral))
                    }
                }
            }
            .padding(20)
            .padding(.top, 8)
        }
        .presentationDetents([.large])
        .confirmationDialog(Text("Delete “\(item.title)”?", comment: "Confirmation title; the argument is the item title"), isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { Interaction.destructiveConfirm.play(); onDelete() }
        }
    }
}

struct MarketEditor: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(SessionStore.self) private var session
    var target: MarketEditorTarget
    var onSaved: () -> Void

    @State private var jpeg: Data?
    @State private var title = ""
    @State private var description = ""
    @State private var status: MarketStatus = .free
    @State private var availability: MarketAvailability = .available
    @State private var busy = false
    @State private var error: String?

    private var existing: MarketItem? { if case .edit(let i) = target { i } else { nil } }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    PhotoField(jpeg: $jpeg, bucket: .market, error: $error, existingURL: existing?.image, height: 220, hue: Feature.market.hue)
                    TextField("Title", text: $title).boolaaField()
                    TextField("Description", text: $description, axis: .vertical)
                        .lineLimit(2...5).padding(.vertical, 12).boolaaField()
                    SegmentedPill(selection: $status, options: MarketStatus.allCases.map { .init(value: $0, label: $0.label) },
                                  hue: Feature.market.hue)
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Availability", comment: "Label of the marketplace availability picker")
                            .font(.rounded(.subheadline, weight: .semibold)).foregroundStyle(Theme.inkSecondary)
                        SegmentedPill(selection: $availability, options: MarketAvailability.allCases.map { .init(value: $0, label: $0.label) },
                                      hue: Feature.market.hue)
                    }
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle(existing == nil ? "List an item" : "Edit item")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await save() } } label: { if busy { ProgressView() } else { Text("Save") } }
                        .disabled(busy || title.trimmingCharacters(in: .whitespaces).isEmpty || (jpeg == nil && existing == nil))
                }
            }
            .onAppear {
                if let existing { title = existing.title; description = existing.description ?? ""; status = existing.status; availability = existing.availability }
            }
            .errorAlert($error)
        }
    }

    private func save() async {
        guard let bubbleID = session.currentBubble?.id, let me = session.userID else { return }
        busy = true; defer { busy = false }
        do {
            var imageURL = existing?.image ?? ""
            if let jpeg { imageURL = try await session.api.uploadImage(jpeg, bucket: .market, userID: me) }
            var input = MarketInput(image: imageURL, title: title.trimmingCharacters(in: .whitespaces),
                                    description: description.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
                                    status: status, availability: availability)
            if let existing {
                try await session.api.updateMarketItem(id: existing.id, input)
                if imageURL != existing.image {
                    await session.api.removeImage(publicURL: existing.image, bucket: .market, userID: me)
                }
            } else {
                input.bubbleId = bubbleID; input.ownerId = me
                try await session.api.createMarketItem(input)
            }
            onSaved()
            dismiss()
        } catch { self.error = error.userMessage }
    }
}
