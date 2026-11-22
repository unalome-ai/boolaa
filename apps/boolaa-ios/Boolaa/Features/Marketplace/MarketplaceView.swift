import SwiftUI

@MainActor
@Observable
final class MarketModel {
    var items: [MarketItem] = []
    var loaded = false
    var error: String?

    func load(api: BoolaaAPI, bubbleID: UUID) async {
        do { items = try await api.marketItems(bubbleID: bubbleID) } catch { self.error = error.userMessage }
        loaded = true
    }

    /// Other members' inserts, edits and deletes stream in until the view goes away (docs/boolaa-spec.md, Realtime tables).
    func listen(api: BoolaaAPI, bubbleID: UUID) async {
        await LiveFeed.observe(MarketItem.self, api: api, bubbleID: bubbleID,
                               rows: { [weak self] in self?.items ?? [] },
                               apply: { [weak self] in self?.items = $0 },
                               reload: { [weak self] in await self?.load(api: api, bubbleID: bubbleID) })
    }

    func delete(api: BoolaaAPI, item: MarketItem) async {
        do {
            try await api.deleteMarketItem(id: item.id)
            items.removeAll { $0.id == item.id }
            await api.removeImage(publicURL: item.image, bucket: .market, userID: item.ownerId)
        } catch { self.error = error.userMessage }
    }

    /// nil filter = All.
    nonisolated static func filter(_ items: [MarketItem], by status: MarketStatus?) -> [MarketItem] {
        guard let status else { return items }
        return items.filter { $0.status == status }
    }
}

/// Grid of items with Free/Trade badges and filter chips (spec §9).
struct MarketplaceView: View {
    @Environment(SessionStore.self) private var session
    @State private var model = MarketModel()
    @State private var filter: MarketStatus?
    @State private var editing: MarketEditorTarget?
    @State private var detail: MarketItem?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) {
                        filterChips
                        Spacer(minLength: 4)
                        AddButton(label: "List item", id: "list-item", hue: hue) { editing = .new }.fixedSize()
                    }
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(spacing: 8) { filterChips }
                        AddButton(label: "List item", id: "list-item", hue: hue) { editing = .new }
                    }
                }
                let visible = MarketModel.filter(model.items, by: filter)
                if model.loaded && !visible.isEmpty {
                    Text("\(visible.count) items", comment: "Number of marketplace items shown")
                        .font(.rounded(.subheadline, weight: .semibold)).monospacedDigit().foregroundStyle(.secondary)
                        .contentTransition(.numericText(value: Double(visible.count)))
                }
                if !model.loaded {
                    LazyVGrid(columns: columns, spacing: 12) {
                        ForEach(0..<4, id: \.self) { _ in
                            RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous).fill(Theme.field)
                                .frame(height: 200).modifier(Shimmer())
                        }
                    }
                    .accessibilityHidden(true)
                }
                if model.loaded && visible.isEmpty {
                    EmptyStateView(icon: "tag.fill", title: "Nothing listed", message: "Give away or trade things with your bubble.", hue: hue)
                }
                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(Array(visible.enumerated()), id: \.element.id) { index, item in
                        Button { detail = item } label: { MarketCard(item: item, isMine: item.ownerId == session.userID) }
                            .buttonStyle(.squish)
                            .safetyContextMenu(.market(item))
                            .transition(.scale(scale: 0.85).combined(with: .opacity))
                            .popIn(index)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)
            .padding(.bottom, Theme.tabBarClearance)
            .animation(Motion.resolve(Motion.snappy, reduceMotion: reduceMotion), value: filter)
            .animation(Motion.gentle, value: model.items.map(\.id))
        }
        .refreshFeedback { await reload() }
        .task {
            await reload()
            if let id = session.currentBubble?.id { await model.listen(api: session.api, bubbleID: id) }
        }
        .sensoryFeedback(.selection, trigger: filter)
        .sheet(item: $editing) { target in
            MarketEditor(target: target) { Task { await reload() } }.boolaaSheet()
        }
        .sheet(item: $detail) { item in
            MarketDetail(item: item, isMine: item.ownerId == session.userID,
                         onEdit: { detail = nil; editing = .edit(item) },
                         onDelete: { detail = nil; Task { await model.delete(api: session.api, item: item) } })
                .boolaaSheet()
        }
        .errorAlert($model.error)
    }

    @ViewBuilder private var filterChips: some View {
        filterChip(String(localized: "All", comment: "Filter chip showing every item"), id: "all", nil).fixedSize()
        filterChip(String(localized: MarketStatus.free.label), id: "free", .free).fixedSize()
        filterChip(String(localized: MarketStatus.trade.label), id: "trade", .trade).fixedSize()
    }

    private var hue: Hue { Feature.market.hue }

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
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(hue.gradient, in: Capsule())
            .overlay(Capsule().strokeBorder(.white.opacity(0.5), lineWidth: 1))
    }
}

struct MarketCard: View {
    var item: MarketItem
    var isMine: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Color.clear
                .frame(height: 140)
                .overlay { RemoteImage(url: item.image, hue: Feature.market.hue) }
                .clipped()
                .overlay(alignment: .topLeading) { StatusBadge(status: item.status).padding(8) }
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: item.title).font(.rounded(.subheadline)).lineLimit(1)
                HStack(spacing: 6) {
                    AvatarView(user: item.owner, size: 20)
                    Text(verbatim: isMine ? String(localized: "You", comment: "Shown instead of your own name") : (item.owner?.displayName ?? "")).font(.caption).foregroundStyle(.secondary).lineLimit(1)
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
    var onEdit: () -> Void
    var onDelete: () -> Void
    @State private var confirmDelete = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Color.clear.frame(height: 300)
                    .overlay { RemoteImage(url: item.image, hue: Feature.market.hue) }
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.hero, style: .continuous))
                HStack {
                    Text(verbatim: item.title).font(.rounded(.title2, weight: .heavy))
                    Spacer()
                    StatusBadge(status: item.status)
                }
                if let d = item.description?.nilIfEmpty { Text(verbatim: d) }
                HStack {
                    AvatarView(user: item.owner, size: 28)
                    Text(verbatim: item.owner?.displayName ?? "").font(.subheadline.weight(.semibold))
                    Text(verbatim: "· " + item.createdAt.relativeShort).font(.subheadline).foregroundStyle(.secondary)
                }
                if isMine {
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
            Button("Delete", role: .destructive, action: onDelete)
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
                if let existing { title = existing.title; description = existing.description ?? ""; status = existing.status }
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
                                    status: status)
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
