import SwiftUI

@MainActor
@Observable
final class LinksModel: CacheFirstModel {
    var links: [SharedLink] = []
    var loaded = false
    var failed = false
    var error: String?
    let reactions = ReactionStore(.sharedLink)

    /// The cached view first (offline / slow network), then the server's list.
    func load(api: BoolaaAPI, bubbleID: UUID) async {
        let ok = await loadCacheFirst(key: OfflineCache.Key.links(bubbleID),
                                      apply: { (rows: [SharedLink]) in links = rows },
                                      fetch: { try await api.links(bubbleID: bubbleID) })
        if ok { await reactions.load(api: api, bubbleID: bubbleID, targetIDs: links.map(\.id)) }
    }

    /// Other members' inserts, edits and deletes stream in until the view goes away (docs/boolaa-spec.md, Realtime tables).
    func listen(api: BoolaaAPI, bubbleID: UUID) async {
        await LiveFeed.observe(SharedLink.self, api: api, bubbleID: bubbleID,
                               rows: { [weak self] in self?.links ?? [] },
                               apply: { [weak self] in self?.links = $0 },
                               reload: { [weak self] in await self?.load(api: api, bubbleID: bubbleID) },
                               reactions: reactions)
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
    @Environment(Connectivity.self) private var connectivity
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var model = LinksModel()
    @State private var tag: String?
    @State private var url = ""
    @State private var title = ""
    @State private var tags = ""
    @State private var busy = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var hue: Hue { Feature.links.hue }

    private var urlIsValid: Bool {
        let t = url.trimmingCharacters(in: .whitespaces).lowercased()
        return (t.hasPrefix("http://") || t.hasPrefix("https://")) && URL(string: t)?.host() != nil
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                PushedHeader(title: "Links", backID: "links-back", onBack: { dismiss() }) {
                    BubbleNameTag(bubble: session.currentBubble)
                }
                ConnectivityBanner().padding(.horizontal, -16)

                VStack(spacing: 10) {
                    TextField(text: $url, prompt: Text(verbatim: "https://…")) { Text("Link address") }
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                        .boolaaField()
                        .accessibilityIdentifier("link-url")
                    TextField("Title", text: $title).boolaaField()
                    TextField("Tags, comma-separated", text: $tags)
                        .textInputAutocapitalization(.never).boolaaField()
                    Button { Task { await add() } } label: {
                        if busy { ProgressView() } else { Text("Add link") }
                    }
                    .buttonStyle(PrimaryButtonStyle(hue: hue))
                    .disabled(!urlIsValid || busy)
                }
                .card()

                if !model.allTags.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            Button { tag = nil } label: { ChipView(title: String(localized: "All", comment: "Filter chip showing every item"), isActive: tag == nil, hue: hue) }
                                .buttonStyle(.squish)
                                .accessibilityAddTraits(tag == nil ? .isSelected : [])
                            ForEach(model.allTags, id: \.self) { t in
                                Button { tag = t } label: { ChipView(title: "#" + t, isActive: tag == t, hue: hue) }
                                    .buttonStyle(.squish)
                                    .accessibilityAddTraits(tag == t ? .isSelected : [])
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 6)
                    }
                    .padding(.horizontal, -16)
                    .sensoryFeedback(.selection, trigger: tag)
                }

                let visible = LinksModel.filter(model.links, tag: tag)
                LoadIssueView(failed: model.failed, hasContent: model.loaded) { await reload() }
                if !model.loaded && !model.failed { Delayed { SkeletonList(count: 2) } }
                if model.loaded && visible.isEmpty {
                    EmptyStateView(icon: "link", title: "No links yet", message: "Share recipes, playlists, anything useful.", hue: hue)
                }
                ForEach(Array(visible.enumerated()), id: \.element.id) { index, link in
                    LinkRow(link: link, isMine: link.userId == session.userID,
                            previewImageURL: session.api.linkPreviewImageURL(path: link.previewImagePath),
                            reactions: model.reactions.summary(for: link.id, me: session.userID),
                            onReact: { react(link, $0) },
                            onOpen: { if let u = URL(string: link.url) { openURL(u) } },
                            onDelete: { Task { await delete(link) } })
                        .safetyContextMenu(.link(link), react: { react(link, $0) })
                        .pushHighlightTarget(link.id)
                        .motionTransition(.scale(scale: 0.9).combined(with: .opacity))
                        .popIn(index)
                }
            }
            .padding(16)
            .animation(Motion.resolve(Motion.snappy, reduceMotion: reduceMotion), value: tag)
            .animation(Motion.resolve(Motion.bouncy, reduceMotion: reduceMotion), value: model.links.map(\.id))
        }
        .scrollDismissesKeyboard(.interactively)
        // A link opened from search (docs/boolaa-spec.md, "Search"): scrolled to and ringed briefly.
        .scrollsToPushHighlight(model.links.map(\.id))
        .background { ShellBackground(hue: Hue.forID(session.currentBubble?.id)) }
        .toolbar(.hidden, for: .navigationBar)
        .refreshFeedback { await reload() }
        .onChange(of: safety.contentVersion) { Task { await reload() } }
        // Keyed by bubble: resubscribes when it changes (this screen sits outside the rebuilt tab content).
        // Also after reconnecting or coming back to the foreground (Connectivity.refreshGeneration).
        .task(id: "\(session.currentBubble?.id.uuidString ?? "")-\(connectivity.refreshGeneration)") {
            await reload()
            if let id = session.currentBubble?.id { await model.listen(api: session.api, bubbleID: id) }
        }
        .autoRetry(failed: model.failed) { await reload() }
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

    private func react(_ link: SharedLink, _ kind: ReactionKind) {
        Task {
            if let e = await model.reactions.toggle(api: session.api, target: link.id, kind: kind, me: session.userID) { model.error = e }
        }
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
    var previewImageURL: URL? = nil
    var reactions: [ReactionSummary] = []
    var onReact: ((ReactionKind) -> Void)? = nil
    var onOpen: () -> Void
    var onDelete: () -> Void
    @State private var confirmDelete = false
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let hue = Feature.links.hue
        let large = typeSize.isAccessibilitySize
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                if !large { FeatureBadge(icon: Feature.links.icon, hue: hue) }
                VStack(alignment: .leading, spacing: 4) {
                    Text(verbatim: link.title?.nilIfEmpty ?? link.url).font(.rounded(.headline)).lineLimit(large ? 5 : 2)
                        .accessibilityAddTraits(.isHeader)
                    Text(verbatim: URL(string: link.url)?.host() ?? link.url).font(.caption).foregroundStyle(Theme.inkSecondary).lineLimit(large ? 3 : 1)
                    if !link.tags.isEmpty {
                        Text(verbatim: link.tags.map { "#" + $0 }.joined(separator: " ")).font(.rounded(.caption)).foregroundStyle(hue.text)
                    }
                    HStack(spacing: 6) {
                        AvatarView(user: link.user, size: 20).accessibilityHidden(true)
                        Text(verbatim: link.user?.displayName ?? "").font(.caption).foregroundStyle(Theme.inkSecondary)
                    }
                    .padding(.top, 2)
                }
                Spacer(minLength: 4)
                VStack(spacing: 8) {
                    Button(action: onOpen) { CircleIcon(systemName: "arrow.up.right", hue: hue, size: 38) }
                        .accessibilityLabel("Open link")
                    if isMine {
                        Button { confirmDelete = true } label: {
                            Image(systemName: "trash.fill").font(.system(size: 14, weight: .bold)).foregroundStyle(Theme.dangerText)
                                .frame(width: 38, height: 38).background(Circle().fill(Theme.danger.opacity(0.12))).minimumHitTarget()
                        }
                        .accessibilityLabel("Delete link")
                    }
                }
                .buttonStyle(.squishIcon)
            }
            switch link.previewState {
            case .ready:
                LinkPreviewCard(link: link, imageURL: previewImageURL, onOpen: onOpen)
            case .loading:
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Loading preview…", comment: "Shown while the server fetches a shared link's preview")
                }
                .font(.caption).foregroundStyle(Theme.inkSecondary)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("link-preview-loading")
            case .none:
                EmptyView()
            }
            if let onReact {
                ReactionBar(summaries: reactions, hue: hue, onToggle: onReact)
            }
        }
        .card()
        .contentShape(Rectangle())
        .onTapGesture(perform: onOpen)
        .confirmationDialog("Delete this link?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive, action: onDelete)
        }
    }
}

/// Open Graph card under a shared link (docs/boolaa-spec.md, "Link previews"). The image is the
/// server's re-encoded copy in our own Storage, never the third-party host; it is decorative for VoiceOver.
struct LinkPreviewCard: View {
    var link: SharedLink
    var imageURL: URL?
    var onOpen: () -> Void

    var body: some View {
        let domain = SharedLink.displayDomain(link.url)
        Button(action: onOpen) {
            VStack(alignment: .leading, spacing: 0) {
                if let imageURL {
                    Color.clear
                        .aspectRatio(1.91, contentMode: .fit)
                        .frame(maxWidth: .infinity)
                        .overlay { RemoteImage(url: imageURL.absoluteString, hue: Feature.links.hue) }
                        .clipped()
                        .accessibilityHidden(true)
                }
                VStack(alignment: .leading, spacing: 4) {
                    if let title = link.previewTitle?.nilIfEmpty {
                        Text(verbatim: title).font(.rounded(.subheadline, weight: .bold)).lineLimit(2)
                            .foregroundStyle(Color.primary)
                    }
                    if let description = link.previewDescription?.nilIfEmpty {
                        Text(verbatim: description).font(.footnote).foregroundStyle(Theme.inkSecondary).lineLimit(2)
                    }
                    let source = [domain, link.previewSiteName?.nilIfEmpty].compactMap { $0 }
                    if !source.isEmpty {
                        Text(verbatim: source.joined(separator: " · "))
                            .font(.caption).foregroundStyle(Feature.links.hue.text).lineLimit(1)
                    }
                }
                .multilineTextAlignment(.leading)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(Theme.field)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
        }
        .buttonStyle(.squish)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("link-preview-\(link.id.uuidString)")
    }
}

extension BoolaaAPI {
    /// Public-form URL naming a preview image in the private `link.previews` bucket; RemoteImage signs it (PhotoURLs).
    func linkPreviewImageURL(path: String?) -> URL? {
        guard let path, !path.isEmpty else { return nil }
        return try? client.storage.from("link.previews").getPublicURL(path: path)
    }
}
