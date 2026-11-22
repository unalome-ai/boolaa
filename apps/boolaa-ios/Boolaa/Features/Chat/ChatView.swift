import PhotosUI
import Supabase
import SwiftUI

@MainActor
@Observable
final class ChatModel {
    private(set) var messages: [ChatMessage] = []
    private(set) var loaded = false
    private(set) var loadingOlder = false
    /// The oldest page was shorter than a full page: nothing older to load.
    private(set) var reachedStart = false
    /// "New messages" divider: above this message until the chat closes.
    private(set) var dividerID: UUID?
    var error: String?
    let images = ChatImageURLs()
    let reactions = ReactionStore(.chatMessage)
    private var authors: [UUID: UserProfile] = [:]
    private var api: BoolaaAPI?
    private var bubbleID: UUID?

    private func withAuthor(_ message: ChatMessage) -> ChatMessage {
        var message = message
        if message.sender == nil { message.sender = authors[message.senderId] }
        if let sender = message.sender { authors[sender.id] = sender }
        return message
    }

    /// INSERT (realtime or our own insert, which may both deliver it): add or replace by id.
    func merge(_ message: ChatMessage) {
        messages = ChatTimeline.upsert(messages, withAuthor(message))
        signPhotos(of: [message])
    }

    /// UPDATE (a deletion): replace in place.
    func update(_ message: ChatMessage) {
        messages = ChatTimeline.applyUpdate(messages, withAuthor(message))
        if message.isDeleted { reactions.dropTarget(message.id) }
    }

    private func loadReactions(of rows: [ChatMessage]) async {
        guard let api, let bubbleID else { return }
        await reactions.load(api: api, bubbleID: bubbleID, targetIDs: rows.filter { !$0.isDeleted }.map(\.id))
    }

    func react(_ message: ChatMessage, _ kind: ReactionKind, me: UUID?) async {
        guard let api, !message.isDeleted else { return }
        if let e = await reactions.toggle(api: api, target: message.id, kind: kind, me: me) { error = e }
    }

    private func signPhotos(of messages: [ChatMessage]) {
        let paths = ChatTimeline.imagePaths(messages)
        guard !paths.isEmpty, let api else { return }
        Task { await images.sign(paths, api: api) }
    }

    /// The newest page; `lastReadAt` is the marker from before the chat was marked read (divider).
    func load(api: BoolaaAPI, bubbleID: UUID, me: UUID?, lastReadAt: @MainActor () async -> Date?) async {
        self.api = api
        self.bubbleID = bubbleID
        do {
            async let page = api.chatPage(bubbleID: bubbleID, beforeID: nil)
            async let members = api.members(bubbleID: bubbleID)
            let marker = await lastReadAt()
            for m in (try? await members) ?? [] { if let u = m.user { authors[u.id] = u } }
            let rows = (try await page).map(withAuthor)
            messages = rows
            reachedStart = ChatTimeline.reachedStart(pageCount: rows.count)
            dividerID = ChatTimeline.dividerID(rows, lastReadAt: marker, me: me)
            signPhotos(of: rows)
            await loadReactions(of: rows)
        } catch {
            self.error = error.userMessage
        }
        loaded = true
    }

    /// Loads the page before the oldest message. `onPrepended` runs in the same update as the
    /// prepend, with the previously-first message, so the view can keep it where it was.
    func loadOlder(onPrepended: (UUID) -> Void) async {
        guard loaded, !loadingOlder, !reachedStart, let api, let bubbleID, let anchor = messages.first?.id else { return }
        loadingOlder = true
        defer { loadingOlder = false }
        do {
            let page = try await api.chatPage(bubbleID: bubbleID, beforeID: anchor).map(withAuthor)
            reachedStart = ChatTimeline.reachedStart(pageCount: page.count)
            messages = ChatTimeline.prepend(messages, olderPage: page)
            onPrepended(anchor)
            signPhotos(of: page)
            await loadReactions(of: page)
        } catch {
            self.error = error.userMessage
        }
    }

    /// Streams realtime INSERTs and UPDATEs for this bubble until the task is cancelled.
    func listen(client: SupabaseClient, bubbleID: UUID) async {
        let channel = client.realtimeV2.channel("chat:\(bubbleID.uuidString.lowercased())")
        let filter = RealtimePostgresFilter.eq("bubble_id", value: bubbleID)
        let inserts = channel.postgresChange(InsertAction.self, schema: "public", table: "chat_messages", filter: filter)
        let updates = channel.postgresChange(UpdateAction.self, schema: "public", table: "chat_messages", filter: filter)
        let reactionStreams = reactions.streams(on: channel, bubbleID: bubbleID,
                                                holds: { [weak self] id in self?.messages.contains { $0.id == id } ?? false })
        do {
            try await channel.subscribeWithError()
            await catchUp()
        } catch {
            // A cancelled subscription (the view went away or reloaded) is not an error.
            if !Task.isCancelled {
                self.error = String(localized: "Live updates are unavailable right now. Reopen the chat to see new messages.")
            }
        }
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await reactionStreams() }
            group.addTask { [weak self] in
                for await action in inserts {
                    if let message = try? action.decodeRecord(as: ChatMessage.self, decoder: BoolaaJSON.decoder) {
                        await self?.merge(message)
                    }
                }
            }
            group.addTask { [weak self] in
                for await action in updates {
                    if let message = try? action.decodeRecord(as: ChatMessage.self, decoder: BoolaaJSON.decoder) {
                        await self?.update(message)
                    }
                }
            }
        }
        await client.realtimeV2.removeChannel(channel)
    }

    /// Whatever arrived or changed between the first page and the subscription.
    private func catchUp() async {
        guard let api, let bubbleID, let rows = try? await api.chatPage(bubbleID: bubbleID, beforeID: nil) else { return }
        for row in rows { merge(row) }
        await loadReactions(of: rows)
    }

    /// Sends text, a photo (`jpeg` from ImageCompression for `.chat`) or both. The photo is uploaded first;
    /// if the insert then fails, the uploaded object is removed again.
    func send(api: BoolaaAPI, bubbleID: UUID, senderID: UUID, text: String, photo: Data?) async -> Bool {
        do {
            var path: String?
            if let photo { path = try await api.uploadChatImage(photo, userID: senderID) }
            do {
                let message = try await api.sendMessage(bubbleID: bubbleID, senderID: senderID, content: text, imagePath: path)
                merge(message)
                return true
            } catch {
                await api.removeChatImage(path: path, userID: senderID)
                throw error
            }
        } catch {
            self.error = error.userMessage
            return false
        }
    }

    /// Soft-deletes one of our own messages, shows the placeholder at once, then removes its photo (best effort).
    func delete(_ message: ChatMessage, api: BoolaaAPI, userID: UUID) async {
        do {
            let path = try await api.deleteChatMessage(id: message.id)
            update(message.asDeleted())
            await api.removeChatImage(path: path, userID: userID)
        } catch {
            self.error = error.userMessage
        }
    }
}

/// A chat photo opened full screen.
private struct ViewedPhoto: Identifiable {
    let url: URL
    var id: URL { url }
}

/// Bubble chat (spec §6, "Chat"): pages of 50 loaded as you scroll up, realtime inserts and updates,
/// photos, deleting your own messages, unread marker and the "New messages" divider.
struct ChatView: View {
    @Environment(SessionStore.self) private var session
    @Environment(SafetyStore.self) private var safety
    @Environment(UnreadStore.self) private var unread
    @Environment(ShellRouter.self) private var router
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var model = ChatModel()
    @State private var draft = ""
    @State private var sending = false
    @State private var sentCount = 0
    /// Messages present after the first load; only ones that arrive later pop in.
    @State private var initialIDs: Set<UUID>?
    @State private var visible = false
    @State private var lastMarked: UUID?
    @State private var pendingDelete: ChatMessage?
    @State private var viewing: ViewedPhoto?
    // Composer photo
    @State private var photo: Data?
    @State private var photoItem: PhotosPickerItem?
    @State private var showPicker = false
    @State private var preparingPhoto = false
    @FocusState private var composerFocused: Bool

    private static let bottomID = "chat-bottom"

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 4) {
                        pagingHeader
                        if model.loaded && model.messages.isEmpty {
                            EmptyStateView(icon: "bubble.left.and.bubble.right.fill", title: "No messages yet",
                                           message: "Be the first to say something.")
                                .padding(.top, 40)
                        }
                        ForEach(Array(model.messages.enumerated()), id: \.element.id) { index, message in
                            let previous = index > 0 ? model.messages[index - 1] : nil
                            let next = index + 1 < model.messages.count ? model.messages[index + 1] : nil
                            let isMine = message.senderId == session.userID
                            VStack(spacing: 4) {
                                if message.id == model.dividerID { NewMessagesDivider() }
                                MessageRow(message: message,
                                           isMine: isMine,
                                           showAuthor: previous?.senderId != message.senderId || message.id == model.dividerID,
                                           endsGroup: next?.senderId != message.senderId,
                                           photoURL: model.images.url(for: message.imagePath),
                                           onPhotoTap: { url in viewing = ViewedPhoto(url: url) })
                                    .reactionAccessibilityActions(enabled: !message.isDeleted) { react(message, $0) }
                                    .modifier(ChatMessageMenu(message: message, isMine: isMine,
                                                              onReact: { react(message, $0) }) { pendingDelete = message })
                                    .modifier(MessagePop(enabled: initialIDs.map { !$0.contains(message.id) } ?? false,
                                                         anchor: isMine ? .bottomTrailing : .bottomLeading))
                                if !message.isDeleted {
                                    let chips = model.reactions.summary(for: message.id, me: session.userID)
                                    if !chips.isEmpty {
                                        ReactionBar(summaries: chips, hue: .grape, addOnlyWithChips: true) { react(message, $0) }
                                            .frame(maxWidth: .infinity, alignment: isMine ? .trailing : .leading)
                                            .padding(isMine ? .trailing : .leading, isMine ? 4 : 38)
                                    }
                                }
                            }
                        }
                        Color.clear.frame(height: 1).id(Self.bottomID)
                    }
                    .padding(.horizontal, 12)
                    .padding(.top, 8)
                }
                .scrollDismissesKeyboard(.interactively)
                .defaultScrollAnchor(.bottom)
                // Near the top: load the previous page and keep the previously-first message in place.
                .onScrollGeometryChange(for: Bool.self) { geo in
                    geo.contentSize.height > geo.containerSize.height && geo.contentOffset.y + geo.contentInsets.top < 240
                } action: { _, nearTop in
                    guard nearTop, initialIDs != nil else { return }
                    Task {
                        await model.loadOlder { anchor in proxy.scrollTo(anchor, anchor: .top) }
                    }
                }
                .onChange(of: model.messages.last?.id) { _, _ in
                    withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(Self.bottomID, anchor: .bottom) }
                    Task { await markRead() }
                }
                .onChange(of: composerFocused) { _, focused in
                    if focused { withAnimation { proxy.scrollTo(Self.bottomID, anchor: .bottom) } }
                }
            }
            composer
        }
        .background { ShellBackground(hue: Hue.forID(session.currentBubble?.id)) }
        .toolbar(.hidden, for: .navigationBar)
        // Reload (and resubscribe) after a block/unblock: RLS hides or shows the other person's messages.
        .task(id: "\(session.currentBubble?.id.uuidString ?? "")-\(safety.contentVersion)") {
            guard let id = session.currentBubble?.id else { return }
            initialIDs = nil
            lastMarked = nil
            model = ChatModel()
            let me = session.userID
            // The divider uses the marker from before this visit marks the chat read.
            await model.load(api: session.api, bubbleID: id, me: me) {
                await unread.refresh()
                return unread.lastReadAt[id]
            }
            initialIDs = Set(model.messages.map(\.id))
            await markRead()
            await model.listen(client: session.api.client, bubbleID: id)
        }
        .onAppear {
            visible = true
            if let pending = router.takeChatDraft() {
                draft = draft.isEmpty ? pending : draft + " " + pending
                composerFocused = true
            }
            Task { await markRead() }
        }
        .onDisappear { visible = false }
        // No banner for this chat's pushes while it's on screen; clear the ones already delivered.
        .reportsVisibleChat(session.currentBubble?.id)
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await markRead() } }
        }
        .alert("Delete this message?", isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
               presenting: pendingDelete) { message in
            Button("Delete", role: .destructive) {
                Task { await delete(message) }
            }
            .accessibilityIdentifier("chat-delete-confirm")
            Button("Cancel", role: .cancel) {}
        } message: { _ in
            Text("It disappears for everyone in the bubble.")
        }
        .fullScreenCover(item: $viewing) { photo in PhotoViewer(url: photo.url) }
        .photosPicker(isPresented: $showPicker, selection: $photoItem, matching: .images)
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            Task { await preparePhoto(item) }
        }
        .sensoryFeedback(.impact(weight: .light), trigger: sentCount)
        .errorAlert($model.error)
    }

    private var header: some View {
        PushedHeader(title: "Chat", backID: "chat-back", onBack: { dismiss() }) {
            BubbleNameTag(bubble: session.currentBubble)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    @ViewBuilder
    private var pagingHeader: some View {
        if model.loadingOlder {
            HStack(spacing: 8) {
                ProgressView()
                Text("Loading older messages…")
            }
            .font(.footnote).foregroundStyle(.secondary)
            .padding(.vertical, 10)
            .accessibilityIdentifier("chat-loading-older")
        } else if model.reachedStart && !model.messages.isEmpty {
            Text("That's the start of the chat")
                .font(.rounded(.footnote)).foregroundStyle(.secondary)
                .padding(.horizontal, 14).padding(.vertical, 6)
                .background(Theme.card.opacity(0.7), in: Capsule())
                .padding(.vertical, 10)
                .accessibilityIdentifier("chat-start")
        }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            if photo != nil || preparingPhoto { photoPreview }
            HStack(alignment: .bottom, spacing: 8) {
                Button { showPicker = true } label: {
                    Image(systemName: "photo.on.rectangle.angled")
                        .font(.system(size: 19, weight: .bold))
                        .foregroundStyle(Hue.grape.text)
                        .frame(width: 48, height: 48)
                        .background(Circle().fill(Theme.field))
                }
                .buttonStyle(.squishIcon)
                .disabled(sending || preparingPhoto)
                .accessibilityLabel(Text("Add a photo"))
                .accessibilityIdentifier("chat-photo")
                TextField("Message", text: $draft, axis: .vertical)
                    .lineLimit(1...5)
                    .focused($composerFocused)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 13)
                    .background(Theme.card, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .strokeBorder(composerFocused ? Theme.brand : Theme.hairline, lineWidth: composerFocused ? 2 : 1))
                    .animation(Motion.fade, value: composerFocused)
                    .accessibilityIdentifier("chat-input")
                Button {
                    Task { await send() }
                } label: {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 19, weight: .heavy))
                        .symbolEffect(.bounce, value: sentCount)
                        .foregroundStyle(canSend ? Color.white : Theme.inkSecondary)
                        .frame(width: 48, height: 48)
                        .background {
                            if canSend {
                                Circle().fill(Hue.grape.gradient).shadow(color: Hue.grape.fill.opacity(0.4), radius: 8, y: 4)
                            } else {
                                Circle().fill(Theme.field)
                            }
                        }
                        .scaleEffect(canSend || reduceMotion ? 1 : 0.88)
                        .animation(Motion.resolve(Motion.bouncy, reduceMotion: reduceMotion), value: canSend)
                }
                .buttonStyle(.squishIcon)
                .disabled(!canSend)
                .accessibilityLabel("Send")
                .accessibilityIdentifier("chat-send")
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.regularMaterial)
    }

    private var photoPreview: some View {
        HStack(spacing: 12) {
            ZStack {
                if let photo, let image = UIImage(data: photo) {
                    Image(uiImage: image).resizable().scaledToFill()
                } else {
                    Theme.field
                    ProgressView()
                }
            }
            .frame(width: 72, height: 72)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .accessibilityIdentifier("chat-photo-preview")
            Button(role: .destructive) {
                withAnimation(Motion.snappy) { photo = nil; photoItem = nil }
            } label: {
                Label("Remove photo", systemImage: "xmark.circle.fill")
                    .font(.rounded(.subheadline))
            }
            .disabled(sending || preparingPhoto)
            .accessibilityIdentifier("chat-photo-remove")
            Spacer()
        }
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    private var canSend: Bool {
        !sending && !preparingPhoto && (photo != nil || !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    private func preparePhoto(_ item: PhotosPickerItem) async {
        preparingPhoto = true
        defer { preparingPhoto = false }
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else { throw ImageCompression.Failure.unsupported }
            let jpeg = try await Task.detached(priority: .userInitiated) {
                try ImageCompression.jpeg(from: data, for: .chat)
            }.value
            withAnimation(Motion.snappy) { photo = jpeg }
        } catch {
            photoItem = nil
            model.error = error.userMessage
        }
    }

    private func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let picked = photo
        guard let bubbleID = session.currentBubble?.id, let me = session.userID, !text.isEmpty || picked != nil else { return }
        sending = true
        defer { sending = false }
        draft = ""
        photo = nil
        sentCount += 1
        if await model.send(api: session.api, bubbleID: bubbleID, senderID: me, text: String(text.prefix(4000)), photo: picked) {
            photoItem = nil
        } else {
            draft = text
            photo = picked
        }
    }

    private func react(_ message: ChatMessage, _ kind: ReactionKind) {
        Task { await model.react(message, kind, me: session.userID) }
    }

    private func delete(_ message: ChatMessage) async {
        guard let me = session.userID else { return }
        await model.delete(message, api: session.api, userID: me)
    }

    /// Moves the read marker to the newest message shown, only while the chat is on screen and the app is active.
    private func markRead() async {
        guard visible, scenePhase == .active, initialIDs != nil,
              let bubbleID = session.currentBubble?.id, let newest = model.messages.last?.id, newest != lastMarked
        else { return }
        lastMarked = newest
        await unread.markRead(bubbleID: bubbleID, messageID: newest)
    }
}

/// Long press: Delete on your own messages; Report / Block on someone else's. Nothing on deleted ones.
private struct ChatMessageMenu: ViewModifier {
    var message: ChatMessage
    var isMine: Bool
    var onReact: (ReactionKind) -> Void
    var onDelete: () -> Void

    func body(content: Content) -> some View {
        if message.isDeleted {
            content
        } else if isMine {
            content.contextMenu {
                ReactSubmenu(onPick: onReact)
                Button(role: .destructive, action: onDelete) {
                    Label("Delete message", systemImage: "trash")
                }
                .accessibilityIdentifier("chat-delete")
            }
        } else {
            content.safetyContextMenu(.message(message), react: onReact)
        }
    }
}

/// "New messages": above the first message from someone else since the last visit.
struct NewMessagesDivider: View {
    var body: some View {
        HStack(spacing: 10) {
            Capsule().fill(Hue.coral.fill.opacity(0.5)).frame(height: 1.5)
            Text("New messages")
                .font(.rounded(.caption, weight: .heavy))
                .foregroundStyle(Hue.coral.text)
                .textCase(.uppercase)
                .fixedSize()
            Capsule().fill(Hue.coral.fill.opacity(0.5)).frame(height: 1.5)
        }
        .padding(.vertical, 8)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("chat-new-messages")
    }
}

/// A chat photo full screen, pinch to zoom.
private struct PhotoViewer: View {
    var url: URL
    @Environment(\.dismiss) private var dismiss
    @State private var scale: CGFloat = 1

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image): image.resizable().scaledToFit()
                case .failure: Image(systemName: "photo").font(.largeTitle).foregroundStyle(.white.opacity(0.6))
                default: ProgressView().tint(.white)
                }
            }
            .scaleEffect(scale)
            .gesture(MagnifyGesture()
                .onChanged { scale = max(1, min(4, $0.magnification)) }
                .onEnded { _ in withAnimation(Motion.snappy) { scale = 1 } })
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityLabel(Text("Photo"))
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(.white.opacity(0.18), in: Circle())
            }
            .padding(16)
            .accessibilityLabel(Text("Close"))
            .accessibilityIdentifier("photo-viewer-close")
        }
    }
}

/// A new chat bubble pops in from its tail corner with a bouncy spring (a plain fade under Reduce Motion).
struct MessagePop: ViewModifier {
    var anchor: UnitPoint
    @State private var shown: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(enabled: Bool, anchor: UnitPoint) {
        self.anchor = anchor
        _shown = State(initialValue: !enabled)
    }

    func body(content: Content) -> some View {
        content
            .scaleEffect(shown || reduceMotion ? 1 : 0.4, anchor: anchor)
            .opacity(shown ? 1 : 0)
            .onAppear {
                guard !shown else { return }
                withAnimation(Motion.resolve(Motion.bouncy, reduceMotion: reduceMotion)) { shown = true }
            }
    }
}

struct MessageRow: View {
    var message: ChatMessage
    var isMine: Bool
    var showAuthor: Bool
    /// Last message of a run from the same sender: gets the "tail" corner and the timestamp.
    var endsGroup = true
    /// Signed URL of the photo (nil while it is being signed).
    var photoURL: URL? = nil
    var onPhotoTap: (URL) -> Void = { _ in }

    var body: some View {
        let hue = Hue.forID(message.senderId)
        HStack(alignment: .bottom, spacing: 8) {
            if isMine { Spacer(minLength: 56) }
            if !isMine {
                if endsGroup { AvatarView(user: message.sender, size: 30) } else { Color.clear.frame(width: 30, height: 1) }
            }
            VStack(alignment: isMine ? .trailing : .leading, spacing: 3) {
                if showAuthor {
                    Text(isMine ? String(localized: "You", comment: "Author label for your own chat messages") : (message.sender?.displayName ?? String(localized: "Someone")))
                        .font(.rounded(.caption))
                        .foregroundStyle(isMine ? Theme.inkSecondary : hue.text)
                        .padding(.horizontal, 6)
                }
                if message.isDeleted {
                    Label("This message was deleted", systemImage: "nosign")
                        .font(.subheadline.italic())
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 15)
                        .padding(.vertical, 10)
                        .overlay(bubbleShape.strokeBorder(Theme.hairline, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
                        .accessibilityIdentifier("chat-deleted")
                } else {
                    if message.imagePath != nil { photo }
                    if !message.content.isEmpty {
                        Text(verbatim: message.content)
                            .padding(.horizontal, 15)
                            .padding(.vertical, 10)
                            .foregroundStyle(isMine ? Color.white : Color.primary)
                            .background {
                                if isMine {
                                    bubbleShape.fill(Hue.grape.gradient)
                                } else {
                                    bubbleShape.fill(Theme.otherBubble).overlay(bubbleShape.strokeBorder(Theme.hairline, lineWidth: 1))
                                }
                            }
                    }
                }
                if endsGroup {
                    Text(message.createdAt.formatted(date: .omitted, time: .shortened))
                        .font(.caption2).foregroundStyle(.secondary)
                        .padding(.horizontal, 6)
                }
            }
            if !isMine { Spacer(minLength: 56) }
        }
        .padding(.top, showAuthor ? 8 : 0)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("message-\(message.id.uuidString)")
    }

    private var bubbleShape: UnevenRoundedRectangle {
        UnevenRoundedRectangle(
            topLeadingRadius: 21, bottomLeadingRadius: !isMine && endsGroup ? 6 : 21,
            bottomTrailingRadius: isMine && endsGroup ? 6 : 21, topTrailingRadius: 21, style: .continuous)
    }

    private var photo: some View {
        Button {
            if let photoURL { onPhotoTap(photoURL) }
        } label: {
            RemoteImage(url: photoURL?.absoluteString, hue: isMine ? .grape : Hue.forID(message.senderId))
                .frame(width: 220, height: 220)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
        }
        .buttonStyle(.squish)
        .accessibilityLabel(Text("Photo"))
        .accessibilityIdentifier("chat-photo-\(message.id.uuidString)")
    }
}
