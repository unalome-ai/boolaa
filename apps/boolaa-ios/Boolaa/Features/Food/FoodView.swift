import SwiftUI

@MainActor
@Observable
final class FoodModel: CacheFirstModel {
    var posts: [FoodPost] = []
    var loaded = false
    var failed = false
    var error: String?
    let reactions = ReactionStore(.foodPost)

    /// The cached view first (offline / slow network), then the server's list.
    func load(api: BoolaaAPI, bubbleID: UUID) async {
        let ok = await loadCacheFirst(key: OfflineCache.Key.food(bubbleID),
                                      apply: { (rows: [FoodPost]) in posts = rows },
                                      fetch: { try await api.foodPosts(bubbleID: bubbleID) })
        if ok { await reactions.load(api: api, bubbleID: bubbleID, targetIDs: posts.map(\.id)) }
    }

    /// Other members' inserts, edits and deletes stream in until the view goes away (docs/boolaa-spec.md, Realtime tables).
    func listen(api: BoolaaAPI, bubbleID: UUID) async {
        await LiveFeed.observe(FoodPost.self, api: api, bubbleID: bubbleID,
                               rows: { [weak self] in self?.posts ?? [] },
                               apply: { [weak self] in self?.posts = $0 },
                               reload: { [weak self] in await self?.load(api: api, bubbleID: bubbleID) },
                               reactions: reactions)
    }

    func delete(api: BoolaaAPI, post: FoodPost) async {
        do {
            try await api.deleteFoodPost(id: post.id)
            posts.removeAll { $0.id == post.id }
            await api.removeImage(publicURL: post.image, bucket: .food, userID: post.userId)
        } catch { self.error = error.userMessage }
    }
}

/// "My posts" and "From the bubble" (spec §8).
struct FoodView: View {
    @Environment(SessionStore.self) private var session
    @Environment(Connectivity.self) private var connectivity
    @State private var model = FoodModel()
    @State private var editing: FoodEditorTarget?

    private var mine: [FoodPost] { model.posts.filter { $0.userId == session.userID } }
    private var others: [FoodPost] { model.posts.filter { $0.userId != session.userID } }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                SectionHeaderWithAction(title: "My posts", count: mine.count, hue: hue) {
                    AddButton(label: "Share food", id: "share-food", hue: hue) { editing = .new }
                }
                LoadIssueView(failed: model.failed, hasContent: model.loaded) { await reload() }
                if !model.loaded && !model.failed { Delayed { SkeletonList(count: 2) } }
                if model.loaded && mine.isEmpty {
                    EmptyStateView(icon: "fork.knife", title: "Nothing shared yet", message: "Leftovers? Snap a photo and share them.", hue: hue)
                }
                ForEach(Array(mine.enumerated()), id: \.element.id) { index, post in
                    FoodCard(post: post,
                             reactions: model.reactions.summary(for: post.id, me: session.userID),
                             onReact: { react(post, $0) },
                             onEdit: { editing = .edit(post) },
                             onDelete: { Task { await model.delete(api: session.api, post: post) } })
                        .safetyContextMenu(.food(post), react: { react(post, $0) })
                        .scrollFade()
                        .popIn(index)
                        .pushHighlightTarget(post.id)
                }
                SectionHeader(title: "From the bubble", count: others.count, hue: hue)
                if model.loaded && others.isEmpty {
                    EmptyStateView(icon: "takeoutbag.and.cup.and.straw.fill", title: "No food posts", message: "Posts from other members show up here.", hue: hue)
                }
                ForEach(Array(others.enumerated()), id: \.element.id) { index, post in
                    FoodCard(post: post,
                             reactions: model.reactions.summary(for: post.id, me: session.userID),
                             onReact: { react(post, $0) })
                        .safetyContextMenu(.food(post), react: { react(post, $0) })
                        .scrollFade()
                        .popIn(index + mine.count)
                        .pushHighlightTarget(post.id)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)
            .padding(.bottom, Theme.tabBarClearance)
            .animation(Motion.gentle, value: model.posts.map(\.id))
        }
        .scrollsToPushHighlight(model.posts.map(\.id))
        .refreshFeedback { await reload() }
        // Back online or in the foreground: reload and resubscribe (Connectivity.refreshGeneration).
        .task(id: connectivity.refreshGeneration) {
            await reload()
            if let id = session.currentBubble?.id { await model.listen(api: session.api, bubbleID: id) }
        }
        .autoRetry(failed: model.failed) { await reload() }
        .sheet(item: $editing) { target in
            FoodEditor(target: target) { Task { await reload() } }.boolaaSheet()
        }
        .errorAlert($model.error)
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
    }
}

enum FoodEditorTarget: Identifiable {
    case new
    case edit(FoodPost)
    var id: String { if case .edit(let p) = self { p.id.uuidString } else { "new" } }
}

struct FoodCard: View {
    var post: FoodPost
    var reactions: [ReactionSummary] = []
    var onReact: ((ReactionKind) -> Void)? = nil
    var onEdit: (() -> Void)? = nil
    var onDelete: (() -> Void)? = nil
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
            if let onReact {
                ReactionBar(summaries: reactions, hue: Feature.food.hue, onToggle: onReact)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 14)
                    .padding(.top, post.description?.nilIfEmpty != nil || onEdit != nil ? 0 : 12)
            }
        }
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
        .cardChrome()
        .confirmationDialog("Delete this post?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { onDelete?() }
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

    private var existing: FoodPost? { if case .edit(let p) = target { p } else { nil } }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    PhotoField(jpeg: $jpeg, bucket: .food, error: $error, existingURL: existing?.image, height: 240, hue: Feature.food.hue)
                    TextField("What are you sharing?", text: $description, axis: .vertical)
                        .lineLimit(2...5).padding(.vertical, 12).boolaaField()
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
            .onAppear { description = existing?.description ?? "" }
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
                                  description: description.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty)
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
