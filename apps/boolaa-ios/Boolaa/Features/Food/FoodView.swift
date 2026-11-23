import SwiftUI

@MainActor
@Observable
final class FoodModel: CacheFirstModel {
    var posts: [FoodPost] = []
    var loaded = false
    var failed = false
    var error: String?
    let reactions = ReactionStore(.foodPost)
    let requests = RequestStore(.food)

    /// The cached view first (offline / slow network), then the server's list.
    func load(api: BoolaaAPI, bubbleID: UUID) async {
        let ok = await loadCacheFirst(key: OfflineCache.Key.food(bubbleID),
                                      apply: { (rows: [FoodPost]) in posts = rows },
                                      fetch: { try await api.foodPosts(bubbleID: bubbleID) })
        if ok {
            async let r: Void = reactions.load(api: api, bubbleID: bubbleID, targetIDs: posts.map(\.id))
            async let q: Void = requests.load(api: api, bubbleID: bubbleID)
            _ = await (r, q)
        }
    }

    /// Other members' inserts, edits and deletes (and requests) stream in until the view goes away.
    func listen(api: BoolaaAPI, bubbleID: UUID) async {
        await LiveFeed.observe(FoodPost.self, api: api, bubbleID: bubbleID,
                               rows: { [weak self] in self?.posts ?? [] },
                               apply: { [weak self] in self?.posts = $0 },
                               reload: { [weak self] in await self?.load(api: api, bubbleID: bubbleID) },
                               reactions: reactions, requests: requests)
    }

    func delete(api: BoolaaAPI, post: FoodPost) async {
        do {
            try await api.deleteFoodPost(id: post.id)
            posts.removeAll { $0.id == post.id }
            await api.removeImage(publicURL: post.image, bucket: .food, userID: post.userId)
        } catch { self.error = error.userMessage }
    }

    /// Applied at once after the owner's pick / undo / hand-over; the UPDATE echo changes nothing more.
    func setAvailability(_ availability: MarketAvailability, of id: UUID) {
        guard let i = posts.firstIndex(where: { $0.id == id }) else { return }
        posts[i].availability = availability
        if availability == .taken { posts[i].handedOverAt = .now }
    }

    /// Expired and handed-over posts are never shown (docs/boolaa-spec.md, "Food expiry").
    nonisolated static func visible(_ posts: [FoodPost], at now: Date) -> [FoodPost] {
        posts.filter { $0.isVisible(at: now) }
    }
}

/// "My posts" and "From the bubble" (spec §8).
struct FoodView: View {
    @Environment(SessionStore.self) private var session
    @Environment(Connectivity.self) private var connectivity
    @Environment(ShellRouter.self) private var router
    @State private var model = FoodModel()
    @State private var editing: FoodEditorTarget?
    @State private var requestsFor: UUID?
    /// Re-rendered every minute and at the earliest expiry on screen, so labels stay current and expired posts go.
    @State private var now = Date.now

    private var shown: [FoodPost] { FoodModel.visible(model.posts, at: now) }
    private var mine: [FoodPost] { shown.filter { $0.userId == session.userID } }
    private var others: [FoodPost] { shown.filter { $0.userId != session.userID } }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                SectionHeaderWithAction(title: "My posts", count: mine.count, hue: hue) {
                    AddButton(label: "Share food", id: "share-food", hue: hue) { editing = .new }
                }
                LoadIssueView(failed: model.failed, hasContent: model.loaded) { await reload() }
                if !model.loaded && !model.failed { Delayed { SkeletonList(count: 2) } }
                if model.loaded && shown.isEmpty {
                    // Nothing at all: one empty state (§8.4), no "From the bubble" section.
                    EmptyStateView(title: LocalizedStringResource("Empty table", comment: "Food Circle empty state title"),
                                   message: LocalizedStringResource("Leftovers? Cooked too much? Snap it and share it.", comment: "Food Circle empty state hint (nothing at all)"),
                                   hue: MascotPlace.food.hue(bubble: hue))
                } else if model.loaded && mine.isEmpty {
                    EmptyStateView(title: LocalizedStringResource("Got leftovers?", comment: "Food, empty “My posts” title"),
                                   message: LocalizedStringResource("Share what you've got before it goes off.", comment: "Food, empty “My posts” hint"),
                                   hue: MascotPlace.food.hue(bubble: hue))
                }
                ForEach(Array(mine.enumerated()), id: \.element.id) { index, post in
                    FoodCard(post: post, now: now,
                             reactions: model.reactions.summary(for: post.id, me: session.userID),
                             onReact: { react(post, $0) },
                             onEdit: { editing = .edit(post) },
                             onDelete: { Task { await model.delete(api: session.api, post: post) } }) {
                        requestControls(post, isMine: true)
                    }
                        .safetyContextMenu(.food(post), react: { react(post, $0) })
                        .scrollFade()
                        .popIn(index)
                        .pushHighlightTarget(post.id)
                }
                if !(model.loaded && shown.isEmpty) {
                    SectionHeader(title: "From the bubble", count: others.count, hue: hue)
                }
                if model.loaded && others.isEmpty && !shown.isEmpty {
                    EmptyStateView(title: LocalizedStringResource("Nothing shared yet", comment: "Food, empty “From the bubble” title"),
                                   message: LocalizedStringResource("When someone shares food, it lands here.", comment: "Food, empty “From the bubble” hint"),
                                   hue: MascotPlace.food.hue(bubble: hue))
                }
                ForEach(Array(others.enumerated()), id: \.element.id) { index, post in
                    FoodCard(post: post, now: now,
                             reactions: model.reactions.summary(for: post.id, me: session.userID),
                             onReact: { react(post, $0) }) {
                        requestControls(post, isMine: false)
                    }
                        .safetyContextMenu(.food(post), react: { react(post, $0) })
                        .scrollFade()
                        .popIn(index + mine.count)
                        .pushHighlightTarget(post.id)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)
            .padding(.bottom, Theme.tabBarClearance)
            .animation(Motion.gentle, value: shown.map(\.id))
        }
        .scrollsToPushHighlight(shown.map(\.id))
        .refreshFeedback { await reload() }
        // Back online or in the foreground: reload and resubscribe (Connectivity.refreshGeneration).
        .task(id: connectivity.refreshGeneration) {
            await reload()
            if let id = session.currentBubble?.id { await model.listen(api: session.api, bubbleID: id) }
        }
        // Nothing is sent when a post expires: tick every minute, or sooner at the next expiry on screen.
        .task(id: FoodExpiry.nextExpiry(of: model.posts, after: now)) {
            while !Task.isCancelled {
                let next = FoodExpiry.nextExpiry(of: model.posts, after: .now)
                let wait = min(60, max(1, (next?.timeIntervalSinceNow ?? 60) + 0.5))
                try? await Task.sleep(for: .seconds(wait))
                if Task.isCancelled { return }
                now = .now
            }
        }
        // An item_request push: open the Requests sheet of my post once it has loaded.
        .task(id: "\(router.openRequestsFor?.uuidString ?? "")|\(mine.count)") {
            guard let id = router.openRequestsFor, mine.contains(where: { $0.id == id }) else { return }
            router.openRequestsFor = nil
            requestsFor = id
        }
        .autoRetry(failed: model.failed) { await reload() }
        .sheet(item: $editing) { target in
            FoodEditor(target: target) {
                if case .new = target, mine.isEmpty { CheerCenter.shared.show(CheerCenter.firstPost, hue: .tangerine) }
                Task { await reload() }
            }.boolaaSheet()
        }
        .sheet(item: Binding(get: { requestsFor.flatMap { id in mine.first { $0.id == id } } },
                             set: { if $0 == nil { requestsFor = nil } })) { post in
            RequestsSheet(target: requestTarget(post), store: model.requests,
                          onAvailability: { model.setAvailability($0, of: post.id) },
                          onError: reloadIfStale)
        }
        .errorAlert($model.error)
    }

    @ViewBuilder
    private func requestControls(_ post: FoodPost, isMine: Bool) -> some View {
        let target = requestTarget(post)
        let mineRequest = model.requests.mine(for: post.id, me: session.userID)
        let picked = isMine ? model.requests.picked(for: post.id) : nil
        VStack(alignment: .leading, spacing: 10) {
            if post.availability != .available || post.requestCount > 0 || mineRequest != nil {
                HStack(spacing: 8) {
                    RequestAwareBadge(availability: post.availability, hue: hue, isOwner: isMine, picked: picked, mine: mineRequest)
                    if post.requestCount > 0 {
                        RequestCountPill(count: post.requestCount, hue: hue, onTap: isMine ? { requestsFor = post.id } : nil)
                    }
                }
            }
            if isMine {
                OwnerRequestsButton(count: post.requestCount, hue: hue) { requestsFor = post.id }
            } else {
                RequestActionRow(target: target, store: model.requests, me: session.userID, onError: handle)
            }
        }
    }

    private func requestTarget(_ post: FoodPost) -> RequestTarget {
        RequestTarget(kind: .food, id: post.id, bubbleID: post.bubbleId, ownerID: post.userId,
                      title: post.description?.nilIfEmpty ?? "", ownerName: post.user?.displayName ?? "",
                      availability: post.availability, requestCount: post.requestCount)
    }

    private func handle(_ error: UserFacingError) {
        model.error = String(localized: error.message)
        reloadIfStale(error)
    }

    /// For sheets that show the error themselves.
    private func reloadIfStale(_ error: UserFacingError) {
        if error.reloadsItems { Task { await reload() } }
    }

    private var hue: Hue { Feature.food.hue }

    private func react(_ post: FoodPost, _ kind: ReactionKind) {
        Task {
            if let e = await model.reactions.toggle(api: session.api, target: post.id, kind: kind, me: session.userID) { model.error = e }
        }
    }

    private func reload() async {
        guard let id = session.currentBubble?.id else { return }
        await model.load(api: session.api, bubbleID: id)
        now = .now
    }
}

enum FoodEditorTarget: Identifiable {
    case new
    case edit(FoodPost)
    var id: String { if case .edit(let p) = self { p.id.uuidString } else { "new" } }
}

struct FoodCard<Footer: View>: View {
    var post: FoodPost
    var now: Date = .now
    var reactions: [ReactionSummary] = []
    var onReact: ((ReactionKind) -> Void)? = nil
    var onEdit: (() -> Void)? = nil
    var onDelete: (() -> Void)? = nil
    /// Badges, the request count and the "I want it" / "Requests" row.
    @ViewBuilder var footer: Footer
    @State private var confirmDelete = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Color.clear
                .frame(height: 210)
                .frame(maxWidth: .infinity)
                .overlay {
                    RemoteImage(url: post.image, hue: Feature.food.hue)
                        .photoLabel(post.user?.displayName, present: !post.image.isEmpty)
                }
                .clipped()
                .overlay(alignment: .bottomLeading) {
                    // Author pill floating on the photo.
                    HStack(spacing: 6) {
                        AvatarView(user: post.user, size: 24).accessibilityHidden(true)
                        Text(verbatim: post.user?.displayName ?? "").font(.rounded(.caption)).lineLimit(2)
                        Text(verbatim: "· " + post.createdAt.relativeShort).font(.caption).foregroundStyle(Theme.inkSecondary).lineLimit(2)
                    }
                    .padding(.leading, 5).padding(.trailing, 12).padding(.vertical, 5)
                    .background(.regularMaterial, in: Capsule())
                    .padding(10)
                }
            if post.description?.nilIfEmpty != nil || onEdit != nil {
                HStack(alignment: .top) {
                    if let d = post.description?.nilIfEmpty { Text(verbatim: d).font(.body.weight(.medium)) }
                    Spacer(minLength: 0)
                    if onEdit != nil {
                        Menu {
                            Button("Edit", systemImage: "pencil") { onEdit?() }
                            Button("Delete", systemImage: "trash", role: .destructive) { confirmDelete = true }
                        } label: {
                            Image(systemName: "ellipsis").font(.body.weight(.bold)).foregroundStyle(Theme.inkSecondary).frame(width: 44, height: 44).contentShape(Rectangle()).dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                        }
                        .accessibilityLabel(Text("More actions"))
                    }
                }
                .padding(16)
            }
            VStack(alignment: .leading, spacing: 10) {
                if let expiresAt = post.expiresAt {
                    let label = FoodExpiry.label(expiresAt: expiresAt, now: now)
                    Label { Text(verbatim: label.text()) } icon: { Image(systemName: "clock") }
                        .font(.rounded(.footnote, weight: .semibold))
                        .foregroundStyle(label.isUrgent ? Theme.dangerText : Feature.food.hue.text)
                        .accessibilityIdentifier("food-expiry")
                }
                footer
            }
            .padding(.horizontal, 16)
            .padding(.top, post.description?.nilIfEmpty != nil || onEdit != nil ? 0 : 14)
            .padding(.bottom, 14)
            if let onReact {
                ReactionBar(summaries: reactions, hue: Feature.food.hue, onToggle: onReact)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 14)
                    .padding(.top, 0)
            }
        }
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
        .cardChrome()
        .confirmationDialog("Delete this post?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { Interaction.destructiveConfirm.play(); onDelete?() }
        }
    }
}

struct FoodEditor: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(SessionStore.self) private var session
    var target: FoodEditorTarget
    var onSaved: () -> Void

    @State private var jpeg: Data?
    @State private var description = ""
    @State private var busy = false
    @State private var error: String?
    // "Good until" (docs/boolaa-spec.md, "Food expiry"): default Tomorrow; edits send it only when changed.
    @State private var preset: FoodExpiry.Preset = .tomorrow
    @State private var custom = FoodExpiry.defaultCustom(now: .now)
    @State private var expiryChanged = false

    private var existing: FoodPost? { if case .edit(let p) = target { p } else { nil } }

    /// The chosen instant (presets are recomputed at save time, so "Tomorrow" stays tomorrow 23:59).
    private func expiresAt(now: Date) -> Date {
        preset == .custom ? custom : (FoodExpiry.value(preset, now: now) ?? custom)
    }

    private var expiryControl: some View {
        let now = Date.now
        return VStack(alignment: .leading, spacing: 8) {
            Text("Good until", comment: "Food form: label of the expiry control")
                .font(.rounded(.subheadline, weight: .semibold)).foregroundStyle(Theme.inkSecondary)
            SegmentedPill(selection: Binding(get: { preset }, set: { preset = $0; expiryChanged = true }),
                          options: FoodExpiry.Preset.allCases.map { .init(value: $0, label: $0.label) },
                          hue: Feature.food.hue,
                          disabled: FoodExpiry.todayAvailable(now: now) ? [] : [.today])
                .accessibilityIdentifier("food-expiry-picker")
            if preset == .custom {
                DatePicker(selection: Binding(get: { custom }, set: { custom = $0; expiryChanged = true }),
                           in: FoodExpiry.customRange(now: now)) {
                    Text("Good until", comment: "Food form: label of the expiry control")
                }
                .datePickerStyle(.compact)
                .labelsHidden()
                .tint(Feature.food.hue.text)
                .accessibilityIdentifier("food-expiry-custom")
            }
            Text("Your post disappears after this.", comment: "Food form: hint under the expiry control")
                .font(.caption).foregroundStyle(Theme.inkSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    PhotoField(jpeg: $jpeg, bucket: .food, error: $error, existingURL: existing?.image, height: 240, hue: Feature.food.hue)
                    TextField("What are you sharing?", text: $description, axis: .vertical)
                        .lineLimit(2...5).padding(.vertical, 12).boolaaField()
                    expiryControl
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle(existing == nil ? "Share food" : "Edit post")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await save() } } label: { if busy { ProgressView() } else { Text("Save") } }
                        .disabled(busy || (jpeg == nil && existing == nil))
                }
            }
            .onAppear {
                description = existing?.description ?? ""
                if let expires = existing?.expiresAt {
                    preset = FoodExpiry.preselect(expires, now: .now)
                    if preset == .custom { custom = expires }
                }
            }
            .errorAlert($error)
        }
    }

    private func save() async {
        guard let bubbleID = session.currentBubble?.id, let me = session.userID else { return }
        busy = true; defer { busy = false }
        do {
            var imageURL = existing?.image ?? ""
            if let jpeg { imageURL = try await session.api.uploadImage(jpeg, bucket: .food, userID: me) }
            var input = FoodInput(image: imageURL,
                                  description: description.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
                                  expiresAt: existing == nil || expiryChanged ? expiresAt(now: .now) : nil)
            if let existing {
                try await session.api.updateFoodPost(id: existing.id, input)
                if imageURL != existing.image {
                    await session.api.removeImage(publicURL: existing.image, bucket: .food, userID: me)
                }
            } else {
                input.bubbleId = bubbleID; input.userId = me
                try await session.api.createFoodPost(input)
            }
            onSaved()
            dismiss()
        } catch { self.error = error.userMessage }
    }
}
