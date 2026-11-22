import SwiftUI

@MainActor
@Observable
final class LinksModel {
    var links: [SharedLink] = []
    var loaded = false
    var error: String?

    func load(api: BoolaaAPI, bubbleID: UUID) async {
        do { links = try await api.links(bubbleID: bubbleID) } catch { self.error = error.userMessage }
        loaded = true
    }

    var allTags: [String] { Array(Set(links.flatMap(\.tags))).sorted() }

    nonisolated static func filter(_ links: [SharedLink], tag: String?) -> [SharedLink] {
        guard let tag else { return links }
        return links.filter { $0.tags.contains(tag) }
    }
}

/// Shared links with tags (spec §10). Pushed from Home and Settings.
struct LinksView: View {
    @Environment(SessionStore.self) private var session
    @Environment(SafetyStore.self) private var safety
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var model = LinksModel()
    @State private var tag: String?
    @State private var url = ""
    @State private var title = ""
    @State private var tags = ""
    @State private var busy = false

    private var urlIsValid: Bool {
        let t = url.trimmingCharacters(in: .whitespaces).lowercased()
        return (t.hasPrefix("http://") || t.hasPrefix("https://")) && URL(string: t)?.host() != nil
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 12) {
                    Button { dismiss() } label: {
                        Image(systemName: "chevron.left").font(.system(size: 18, weight: .bold))
                            .foregroundStyle(Theme.brand).frame(width: 40, height: 40)
                            .background(Circle().fill(Theme.card))
                            .shadow(color: .black.opacity(0.08), radius: 6, y: 2)
                    }
                    .accessibilityLabel("Back")
                    Text("Links").font(.system(size: 32, weight: .bold)).accessibilityIdentifier("screen-title")
                    Spacer()
                }

                VStack(spacing: 10) {
                    TextField(text: $url, prompt: Text(verbatim: "https://…")) { Text("Link address") }
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                        .boolaaField()
                        .accessibilityIdentifier("link-url")
                    TextField("Title", text: $title).boolaaField()
                    TextField("Tags, comma-separated", text: $tags)
                        .textInputAutocapitalization(.never).boolaaField()
                    Button { Task { await add() } } label: {
                        if busy { ProgressView().tint(.white) } else { Text("Add link") }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(!urlIsValid || busy)
                }
                .card()

                if !model.allTags.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            Button { tag = nil } label: { ChipView(title: String(localized: "All", comment: "Filter chip showing every item"), isActive: tag == nil) }.buttonStyle(.plain)
                            ForEach(model.allTags, id: \.self) { t in
                                Button { tag = t } label: { ChipView(title: "#" + t, isActive: tag == t) }.buttonStyle(.plain)
                            }
                        }
                    }
                }

                let visible = LinksModel.filter(model.links, tag: tag)
                if model.loaded && visible.isEmpty {
                    EmptyStateView(icon: "link", title: "No links yet", message: "Share recipes, playlists, anything useful.")
                }
                ForEach(visible) { link in
                    LinkRow(link: link, isMine: link.userId == session.userID,
                            onOpen: { if let u = URL(string: link.url) { openURL(u) } },
                            onDelete: { Task { await delete(link) } })
                        .safetyContextMenu(.link(link))
                }
            }
            .padding(16)
        }
        .background(Theme.background.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .refreshable { await reload() }
        .onChange(of: safety.contentVersion) { Task { await reload() } }
        .task { await reload() }
        .errorAlert($model.error)
    }

    private func reload() async {
        guard let id = session.currentBubble?.id else { return }
        await model.load(api: session.api, bubbleID: id)
    }

    private func add() async {
        guard let bubbleID = session.currentBubble?.id, let me = session.userID else { return }
        busy = true; defer { busy = false }
        do {
            try await session.api.createLink(LinkInput(
                bubbleId: bubbleID, userId: me,
                url: url.trimmingCharacters(in: .whitespaces),
                title: title.trimmingCharacters(in: .whitespaces).nilIfEmpty,
                tags: SharedLink.parseTags(tags)))
            url = ""; title = ""; tags = ""
            await reload()
        } catch { model.error = error.userMessage }
    }

    private func delete(_ link: SharedLink) async {
        do {
            try await session.api.deleteLink(id: link.id)
            model.links.removeAll { $0.id == link.id }
        } catch { model.error = error.userMessage }
    }
}

struct LinkRow: View {
    var link: SharedLink
    var isMine: Bool
    var onOpen: () -> Void
    var onDelete: () -> Void
    @State private var confirmDelete = false

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.brand.opacity(0.14))
                Image(systemName: "link").foregroundStyle(Theme.brand)
            }
            .frame(width: 42, height: 42)
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: link.title?.nilIfEmpty ?? link.url).font(.headline).lineLimit(2)
                Text(verbatim: URL(string: link.url)?.host() ?? link.url).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                if !link.tags.isEmpty {
                    Text(verbatim: link.tags.map { "#" + $0 }.joined(separator: " ")).font(.caption.weight(.semibold)).foregroundStyle(Theme.brand)
                }
                HStack(spacing: 6) {
                    AvatarView(user: link.user, size: 18)
                    Text(verbatim: link.user?.displayName ?? "").font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            VStack(spacing: 8) {
                Button(action: onOpen) { Image(systemName: "arrow.up.right.square").font(.title3) }
                    .accessibilityLabel("Open link")
                if isMine {
                    Button { confirmDelete = true } label: { Image(systemName: "trash").foregroundStyle(.red) }
                        .accessibilityLabel("Delete link")
                }
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.brand)
        }
        .card()
        .contentShape(Rectangle())
        .onTapGesture(perform: onOpen)
        .confirmationDialog("Delete this link?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive, action: onDelete)
        }
    }
}
