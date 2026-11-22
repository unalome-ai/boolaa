import SwiftUI

@MainActor
@Observable
final class FoodModel {
    var posts: [FoodPost] = []
    var loaded = false
    var error: String?

    func load(api: BoolaaAPI, bubbleID: UUID) async {
        do { posts = try await api.foodPosts(bubbleID: bubbleID) } catch { self.error = error.userMessage }
        loaded = true
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
    @State private var model = FoodModel()
    @State private var editing: FoodEditorTarget?

    private var mine: [FoodPost] { model.posts.filter { $0.userId == session.userID } }
    private var others: [FoodPost] { model.posts.filter { $0.userId != session.userID } }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                SectionHeaderWithAction(title: "My posts", count: mine.count) {
                    AddButton(label: "Share food", id: "share-food") { editing = .new }
                }
                if model.loaded && mine.isEmpty {
                    EmptyStateView(icon: "fork.knife", title: "Nothing shared yet", message: "Leftovers? Snap a photo and share them.")
                }
                ForEach(mine) { post in
                    FoodCard(post: post,
                             onEdit: { editing = .edit(post) },
                             onDelete: { Task { await model.delete(api: session.api, post: post) } })
                }
                SectionHeader(title: "From the bubble", count: others.count)
                if model.loaded && others.isEmpty {
                    EmptyStateView(icon: "takeoutbag.and.cup.and.straw", title: "No food posts", message: "Posts from other members show up here.")
                }
                ForEach(others) { FoodCard(post: $0) }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, Theme.tabBarClearance)
        }
        .refreshable { await reload() }
        .task { await reload() }
        .sheet(item: $editing) { target in
            FoodEditor(target: target) { Task { await reload() } }
        }
        .errorAlert($model.error)
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
    var onEdit: (() -> Void)? = nil
    var onDelete: (() -> Void)? = nil
    @State private var confirmDelete = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            RemoteImage(url: post.image)
                .frame(height: 200)
                .frame(maxWidth: .infinity)
                .clipped()
            VStack(alignment: .leading, spacing: 8) {
                if let d = post.description?.nilIfEmpty { Text(verbatim: d).font(.body) }
                HStack {
                    AvatarView(user: post.user, size: 24)
                    Text(verbatim: post.user?.displayName ?? "").font(.caption.weight(.semibold)).lineLimit(1)
                    Text(verbatim: "· " + post.createdAt.relativeShort).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    Spacer()
                    if onEdit != nil {
                        Menu {
                            Button("Edit", systemImage: "pencil") { onEdit?() }
                            Button("Delete", systemImage: "trash", role: .destructive) { confirmDelete = true }
                        } label: {
                            Image(systemName: "ellipsis").foregroundStyle(.secondary).frame(width: 28, height: 24)
                        }
                        .accessibilityLabel(Text("More actions"))
                    }
                }
            }
            .padding(14)
        }
        .background(Theme.card)
        .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous))
        .shadow(color: .black.opacity(0.06), radius: 10, y: 3)
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
                    PhotoField(jpeg: $jpeg, existingURL: existing?.image, height: 240)
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
