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
    /// A message opened from search: the view scrolls to it once, then rings it for a few seconds.
    var jumpTarget: UUID?
    var highlighted: UUID?
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

    /// The signed-in user, so live messages from others can be announced to VoiceOver.
    private var me: UUID?

    /// A realtime INSERT: merged, and announced politely when it is someone else's new message.
    func mergeLive(_ message: ChatMessage) {
        let isNew = !messages.contains { $0.id == message.id }
        merge(message)
        if isNew, message.senderId != me, !message.isDeleted {
            let name = messages.first { $0.id == message.id }?.sender?.displayName ?? String(localized: "Someone")
            A11y.announce(A11y.join([A11y.newMessageFrom(name), message.content]))
        }
    }

    /// INSERT (realtime or our own insert, which may both deliver it): add or replace by id.
    func merge(_ message: ChatMessage) {
        messages = ChatTimeline.upsert(messages, withAuthor(message))
        signPhotos(of: [message])
        scheduleCacheSave()
    }

    /// UPDATE (a deletion): replace in place.
    func update(_ message: ChatMessage) {
        messages = ChatTimeline.applyUpdate(messages, withAuthor(message))
        if message.isDeleted { reactions.dropTarget(message.id) }
        scheduleCacheSave()
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

    /// The last load failed (inline error, or the stale notice over the cached page).
    private(set) var failed = false
    private var cacheSave: Task<Void, Never>?
    var currentBubbleID: UUID? { bubbleID }

    /// The newest page; `lastReadAt` is the marker from before the chat was marked read (divider).
    /// The cached newest page shows first (offline / slow network).
    func load(api: BoolaaAPI, bubbleID: UUID, me: UUID?, lastReadAt: @MainActor () async -> Date?) async {
        self.api = api
        self.bubbleID = bubbleID
        self.me = me
        if !loaded, let cached = OfflineCache.shared.read([ChatMessage].self, key: OfflineCache.Key.chat(bubbleID)) {
            messages = cached.map(withAuthor)
            reachedStart = ChatTimeline.reachedStart(pageCount: cached.count)
            loaded = true
        }
        do {
            async let page = api.chatPage(bubbleID: bubbleID, beforeID: nil)
            async let members = api.members(bubbleID: bubbleID)
            let marker = await lastReadAt()
            for m in (try? await members) ?? [] { if let u = m.user { authors[u.id] = u } }
            let rows = (try await page).map(withAuthor)
            messages = rows
            reachedStart = ChatTimeline.reachedStart(pageCount: rows.count)
            dividerID = ChatTimeline.dividerID(rows, lastReadAt: marker, me: me)
            loaded = true
            failed = false
            Connectivity.shared.reportSuccess()
            OfflineCache.shared.save(rows, key: OfflineCache.Key.chat(bubbleID))
            signPhotos(of: rows)
            await loadReactions(of: rows)
        } catch {
            noteFailure(error)
        }
    }

    /// Back online / in the foreground / Try again: fetch the newest page and merge it, keeping the scroll
    /// position. If more than a page was missed (no overlap), the newest page replaces the list.
    func refresh() async {
        guard let api, let bubbleID else { return }
        guard loaded else {
            await load(api: api, bubbleID: bubbleID, me: me) { nil }
            return
        }
        do {
            let rows = try await api.chatPage(bubbleID: bubbleID, beforeID: nil).map(withAuthor)
            let held = Set(messages.map(\.id))
            if rows.count >= BoolaaAPI.chatPageSize, !rows.contains(where: { held.contains($0.id) }) {
                messages = rows
                reachedStart = false
            } else {
                for row in rows { messages = ChatTimeline.upsert(messages, row) }
            }
            failed = false
            Connectivity.shared.reportSuccess()
            scheduleCacheSave()
            signPhotos(of: rows)
            await loadReactions(of: rows)
        } catch {
            noteFailure(error)
        }
    }

    private func noteFailure(_ error: any Error) {
        guard !Task.isCancelled else { return }
        failed = true
        Connectivity.shared.report(error)
        _ = UserFacingError.classify(error) // "session not verified" / "account suspended" re-run the gate
    }

    /// Keeps the cached newest page current as messages arrive (debounced).
    private func scheduleCacheSave() {
        guard let bubbleID else { return }
        cacheSave?.cancel()
        cacheSave = Task {
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { return }
            OfflineCache.shared.save(Array(messages.suffix(BoolaaAPI.chatPageSize)), key: OfflineCache.Key.chat(bubbleID))
        }
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
            // Offline: no alert per scroll; the banner explains and scrolling up again retries.
            if Connectivity.isNetworkError(error) { Connectivity.shared.report(error) } else { self.error = error.userMessage }
        }
    }

    /// Loads the window from `id` to the newest message (`chat_messages_around`, contiguous with what is
    /// loaded, so live messages and older pages keep working) and asks the view to scroll to it.
    func jump(to id: UUID) async {
        guard let api, let bubbleID else { return }
        do {
            let rows = try await api.chatAround(bubbleID: bubbleID, messageID: id).map(withAuthor)
            let window = ChatJump.window(rows, target: id)
            guard window.found else {
                error = String(localized: "We couldn't find that message in the chat.")
                return
            }
            if window.reachedStart { reachedStart = true }
            messages = ChatJump.merge(messages, window: rows)
            signPhotos(of: rows)
            jumpTarget = id
            await loadReactions(of: rows)
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
            // A cancelled subscription (the view went away or reloaded) is not an error, and offline the
            // banner already explains it (the chat resubscribes on reconnect).
            if !Task.isCancelled, Connectivity.shared.status == .online {
                self.error = String(localized: "Live updates are unavailable right now. Reopen the chat to see new messages.")
            }
        }
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await reactionStreams() }
            group.addTask { [weak self] in
                for await action in inserts {
                    if let message = try? action.decodeRecord(as: ChatMessage.self, decoder: BoolaaJSON.decoder) {
                        await self?.mergeLive(message)
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
    @Environment(Connectivity.self) private var connectivity
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var model = ChatModel()
    /// The load (bubble + block state) the model holds; a reconnect with the same key only refreshes.
    @State private var activeLoadKey: String?
    private var outbox: ChatOutbox { ChatOutbox.shared }
    /// Messages written here that the server hasn't confirmed ("Sending…" / "Not sent — tap to retry").
    private var pending: [PendingMessage] {
        guard let id = session.currentBubble?.id else { return [] }
        return outbox.pending(in: id, excluding: Set(model.messages.map(\.id)))
    }
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
    /// The load (bubble + block state) whose first page has landed at the bottom: only then may
    /// scrolling near the top page in older messages.
    @State private var pagingArmedFor: String?

    private static let bottomID = "chat-bottom"

    /// One load of the chat: the current bubble plus the block/unblock version (RLS changes what is visible).
    private var loadKey: String { ChatScroll.loadKey(bubbleID: session.currentBubble?.id, contentVersion: safety.contentVersion) }

    var body: some View {
        VStack(spacing: 0) {
            header
            ConnectivityBanner()
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 4) {
                        pagingHeader
                        LoadIssueView(failed: model.failed, hasContent: model.loaded) { await model.refresh() }
                            .padding(.vertical, 8)
                        if !model.loaded && !model.failed {
                            Delayed { ProgressView().padding(.top, 40).accessibilityLabel(Text("Loading")) }
                        }
                        if model.loaded && model.messages.isEmpty && pending.isEmpty {
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
                                           onPhotoTap: { url in viewing = ViewedPhoto(url: url) },
                                           reactions: message.isDeleted ? [] : model.reactions.summary(for: message.id, me: session.userID))
                                    .reactionAccessibilityActions(enabled: !message.isDeleted) { react(message, $0) }
                                    .accessibilityActions {
                                        if !message.isDeleted {
                                            if isMine {
                                                Button { pendingDelete = message } label: { Text("Delete message") }
                                            } else {
                                                Button { safety.reportTarget = .message(message) } label: { Text(ReportTarget.message(message).type.reportTitle) }
                                            }
                                        }
                                    }
                                    .modifier(ChatMessageMenu(message: message, isMine: isMine,
                                                              onReact: { react(message, $0) }) { pendingDelete = message })
                                    .modifier(MessagePop(enabled: initialIDs.map { !$0.contains(message.id) } ?? false,
                                                         anchor: isMine ? .bottomTrailing : .bottomLeading))
                                    .overlay {
                                        if model.highlighted == message.id {
                                            RoundedRectangle(cornerRadius: 22, style: .continuous)
                                                .strokeBorder(Theme.brandText, lineWidth: 3)
                                                .padding(-3)
                                                .allowsHitTesting(false)
                                                .transition(.opacity)
                                                .accessibilityIdentifier("chat-highlight")
                                        }
                                    }
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
                        // Own identity space: a sent message keeps its client id, and the same id in both
                        // ForEach blocks of one LazyVStack left the stale "Sending…" row on screen.
                        ForEach(pending, id: \.pendingRowID) { message in
                            PendingMessageRow(message: message,
                                              onRetry: { Task { await outbox.retry(message.id) } },
                                              onDiscard: { discard(message) })
                                .transition(.opacity)
                        }
                        Color.clear.frame(height: 1).id(Self.bottomID)
                    }
                    .padding(.horizontal, 12)
                    .padding(.top, 8)
                }
                .scrollDismissesKeyboard(.interactively)
                .defaultScrollAnchor(.bottom)
                // A new scroll view per load: after a bubble switch (e.g. a tapped push for another bubble
                // while the chat is open) it starts at the newest message like a fresh open, instead of
                // keeping the old offset, landing at the top and paging in older messages.
                .id(loadKey)
                // Near the top: load the previous page and keep the previously-first message in place.
                .onScrollGeometryChange(for: Bool.self) { geo in
                    geo.contentSize.height > geo.containerSize.height && geo.contentOffset.y + geo.contentInsets.top < 240
                } action: { _, nearTop in
                    guard ChatScroll.mayLoadOlder(nearTop: nearTop, initialLoaded: initialIDs != nil,
                                                  armedFor: pagingArmedFor, current: loadKey) else { return }
                    Task {
                        await model.loadOlder { anchor in proxy.scrollTo(anchor, anchor: .top) }
                    }
                }
                .onChange(of: model.messages.last?.id) { _, _ in
                    withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(Self.bottomID, anchor: .bottom) }
                    Task { await markRead() }
                }
                .onChange(of: pending.map(\.id)) { old, new in
                    guard new.count > old.count else { return }
                    withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(Self.bottomID, anchor: .bottom) }
                }
                // A message opened from search: centre it, ring it for 4 s.
                .onChange(of: model.jumpTarget) { _, target in
                    guard let target else { return }
                    model.jumpTarget = nil
                    Task {
                        try? await Task.sleep(for: .milliseconds(150))
                        withAnimation(Motion.resolve(Motion.gentle, reduceMotion: reduceMotion)) { proxy.scrollTo(target, anchor: .center) }
                        model.highlighted = target
                        try? await Task.sleep(for: .seconds(4))
                        if model.highlighted == target { withAnimation(Motion.gentle) { model.highlighted = nil } }
                    }
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
        // Back online or in the foreground (Connectivity.refreshGeneration): the same load only fetches what
        // was missed and resubscribes, keeping the scroll position.
        .task(id: "\(loadKey)#\(connectivity.refreshGeneration)") {
            guard let id = session.currentBubble?.id else { return }
            let key = loadKey
            if activeLoadKey == key {
                await model.refresh()
                await markRead()
                await model.listen(client: session.api.client, bubbleID: id)
                return
            }
            activeLoadKey = key
            pagingArmedFor = nil
            initialIDs = nil
            lastMarked = nil
            model = ChatModel()
            let model = model
            outbox.onSent = { [weak model] row in
                if row.bubbleId == model?.currentBubbleID { model?.merge(row) }
            }
            let me = session.userID
            // The divider uses the marker from before this visit marks the chat read.
            await model.load(api: session.api, bubbleID: id, me: me) {
                await unread.refresh()
                return unread.lastReadAt[id]
            }
            initialIDs = Set(model.messages.map(\.id))
            if let target = router.takeChatJump() {
                await model.jump(to: target)
                initialIDs = Set(model.messages.map(\.id)) // the window doesn't pop in
            }
            // Let the first page settle at the bottom before scrolling up may page in older messages.
            Task {
                try? await Task.sleep(for: .milliseconds(400))
                if loadKey == key { pagingArmedFor = key }
            }
            await markRead()
            await model.listen(client: session.api.client, bubbleID: id)
        }
        .autoRetry(failed: model.failed) { await model.refresh() }
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
            .font(.footnote).foregroundStyle(Theme.inkSecondary)
            .padding(.vertical, 10)
            .accessibilityIdentifier("chat-loading-older")
        } else if model.reachedStart && !model.messages.isEmpty {
            Text("That's the start of the chat")
                .font(.rounded(.footnote)).foregroundStyle(Theme.inkSecondary)
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
                        .strokeBorder(composerFocused ? Theme.focusRing : Theme.fieldBorder, lineWidth: composerFocused ? 2 : 1))
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
        .motionTransition(.move(edge: .bottom).combined(with: .opacity))
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
        // The outbox now holds the message ("Sending…", then sent or "Not sent — tap to retry"), so the
        // composer clears without losing anything. Offline it waits and is sent when the app is back online.
        draft = ""
        photo = nil
        photoItem = nil
        sentCount += 1
        await outbox.enqueue(bubbleID: bubbleID, senderID: me, text: String(text.prefix(4000)), photo: picked,
                             online: connectivity.status == .online)
    }

    /// "Don't send": drops a pending message and its photo, if it was uploaded already.
    private func discard(_ message: PendingMessage) {
        guard let removed = outbox.discard(message.id), let me = session.userID else { return }
        if let path = removed.photoPath {
            let api = session.api
            Task { await api.removeChatImage(path: path, userID: me) }
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

/// Tap and VoiceOver activation that only exist while `enabled`, so the element has the button trait only then.
private struct RetryOnTap: ViewModifier {
    var enabled: Bool
    var action: () -> Void
    func body(content: Content) -> some View {
        if enabled {
            content
                .onTapGesture(perform: action)
                .accessibilityAddTraits(.isButton)
                .accessibilityAction(.default, action)
        } else {
            content.accessibilityRemoveTraits(.isButton)
        }
    }
}

/// A message the server hasn't confirmed: dimmed own bubble with "Sending…", or "Not sent — tap to retry"
/// (tap retries; long press offers Try again / Don't send).
struct PendingMessageRow: View {
    var message: PendingMessage
    var onRetry: () -> Void
    var onDiscard: () -> Void

    private var failed: Bool { message.state == .failed }
    private var bubbleShape: UnevenRoundedRectangle {
        UnevenRoundedRectangle(topLeadingRadius: 21, bottomLeadingRadius: 21, bottomTrailingRadius: 6,
                               topTrailingRadius: 21, style: .continuous)
    }

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            Spacer(minLength: 56)
            VStack(alignment: .trailing, spacing: 3) {
                if let photo = message.photo, let image = UIImage(data: photo) {
                    Image(uiImage: image).resizable().scaledToFill()
                        .frame(width: 220, height: 220)
                        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .accessibilityLabel(Text("Photo"))
                        .opacity(failed ? 1 : 0.6)
                }
                if !message.content.isEmpty {
                    Text(verbatim: message.content)
                        .padding(.horizontal, 15).padding(.vertical, 10)
                        .foregroundStyle(Color.white)
                        .background(bubbleShape.fill(Hue.grape.gradient))
                        .opacity(failed ? 1 : 0.6)
                }
                // Full opacity so the status keeps its contrast (spec "Accessibility").
                status
            }
        }
        .contentShape(Rectangle())
        .contextMenu {
            if failed {
                Button(action: onRetry) { Label { Text("Try again") } icon: { Image(systemName: "arrow.clockwise") } }
            }
            Button(role: .destructive, action: onDiscard) {
                Label { Text("Don't send", comment: "Discards a chat message that wasn't sent") } icon: { Image(systemName: "trash") }
            }
        }
        .accessibilityElement(children: .combine)
        // Only a failed message is a button (tap or VoiceOver double tap retries); "Sending…" is plain text.
        // "Try again" / "Don't send" are in the actions rotor.
        .modifier(RetryOnTap(enabled: failed, action: onRetry))
        .accessibilityActions {
            if failed { Button(action: onRetry) { Text("Try again") } }
            Button(action: onDiscard) { Text("Don't send", comment: "Discards a chat message that wasn't sent") }
        }
        .accessibilityIdentifier(failed ? "chat-not-sent" : "chat-sending")
        .onChange(of: failed) { _, now in
            if now { A11y.announce(String(localized: "Not sent — tap to retry", comment: "Under a chat message that failed to send")) }
        }
    }

    @ViewBuilder private var status: some View {
        if failed {
            Label { Text("Not sent — tap to retry", comment: "Under a chat message that failed to send") }
                icon: { Image(systemName: "exclamationmark.circle.fill") }
                .font(.caption2.weight(.semibold))
                .foregroundStyle(Theme.dangerText)
                .padding(.horizontal, 6)
        } else {
            Label { Text("Sending…", comment: "Under a chat message while it is being sent") }
                icon: { Image(systemName: "clock") }
                .font(.caption2).foregroundStyle(Theme.inkSecondary)
                .padding(.horizontal, 6)
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
    /// Reaction chips under the message, read as part of the message.
    var reactions: [ReactionSummary] = []
    @Environment(\.openURL) private var openURL
    @ScaledMetric(relativeTo: .body) private var photoSide: CGFloat = 220

    /// What VoiceOver reads for the whole row (sender, text or photo, time, reactions).
    var accessibilityText: String {
        A11y.chatMessage(sender: message.sender?.displayName ?? String(localized: "Someone"), isMine: isMine,
                         text: message.content, hasPhoto: message.imagePath != nil, deleted: message.isDeleted,
                         time: message.createdAt.formatted(date: .omitted, time: .shortened), reactions: reactions)
    }

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
                        .foregroundStyle(Theme.inkSecondary)
                        .padding(.horizontal, 15)
                        .padding(.vertical, 10)
                        .overlay(bubbleShape.strokeBorder(Theme.hairline, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
                        .accessibilityIdentifier("chat-deleted")
                } else {
                    if message.imagePath != nil { photo }
                    if !message.content.isEmpty {
                        // Links are tappable and open in the browser (no previews in chat).
                        Text(Linkify.attributed(message.content))
                            .tint(isMine ? Color.white : Hue.grape.text)
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
                        .font(.caption2).foregroundStyle(Theme.inkSecondary)
                        .padding(.horizontal, 6)
                }
            }
            if !isMine { Spacer(minLength: 56) }
        }
        .padding(.top, showAuthor ? 8 : 0)
        // One element per message; the photo and the links inside stay reachable as actions.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityText))
        .accessibilityActions {
            if let photoURL, !message.isDeleted {
                Button { onPhotoTap(photoURL) } label: { Text("Open photo", comment: "VoiceOver action on a chat message with a photo") }
            }
            ForEach(message.isDeleted ? [] : Linkify.urls(in: message.content), id: \.self) { url in
                Button { openURL(url) } label: { Text(verbatim: url.host() ?? url.absoluteString) }
            }
        }
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
                .frame(width: min(photoSide, 300), height: min(photoSide, 300))
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
        }
        .buttonStyle(.squish)
        .accessibilityLabel(isMine ? Text("Photo") : Text(verbatim: A11y.photoFrom(message.sender?.displayName ?? "")))
        .accessibilityIdentifier("chat-photo-\(message.id.uuidString)")
    }
}
