import Supabase
import SwiftUI

@MainActor
@Observable
final class ChatModel {
    private(set) var messages: [ChatMessage] = []
    private(set) var loaded = false
    var error: String?
    private var authors: [UUID: UserProfile] = [:]

    /// Inserts or replaces a message, keeping chronological order (realtime and our own insert may both deliver it).
    func merge(_ message: ChatMessage) {
        var message = message
        if message.sender == nil { message.sender = authors[message.senderId] }
        if let sender = message.sender { authors[sender.id] = sender }
        if let idx = messages.firstIndex(where: { $0.id == message.id }) {
            if messages[idx].sender == nil { messages[idx] = message }
            return
        }
        messages.append(message)
        if messages.count > 1, messages[messages.count - 2].createdAt > message.createdAt {
            messages.sort { $0.createdAt < $1.createdAt }
        }
    }

    func load(api: BoolaaAPI, bubbleID: UUID) async {
        do {
            async let msgs = api.chatMessages(bubbleID: bubbleID)
            async let members = api.members(bubbleID: bubbleID)
            for m in try await members { if let u = m.user { authors[u.id] = u } }
            messages = []
            for m in try await msgs { merge(m) }
        } catch {
            self.error = error.userMessage
        }
        loaded = true
    }

    /// Streams realtime INSERTs for this bubble until the task is cancelled.
    func listen(client: SupabaseClient, bubbleID: UUID) async {
        let channel = client.realtimeV2.channel("chat:\(bubbleID.uuidString.lowercased())")
        let inserts = channel.postgresChange(
            InsertAction.self,
            schema: "public",
            table: "chat_messages",
            filter: .eq("bubble_id", value: bubbleID)
        )
        do {
            try await channel.subscribeWithError()
        } catch {
            self.error = String(localized: "Live updates are unavailable right now. Reopen the chat to see new messages.")
        }
        for await action in inserts {
            if let message = try? action.decodeRecord(as: ChatMessage.self, decoder: BoolaaJSON.decoder) {
                merge(message)
            }
        }
        await client.realtimeV2.removeChannel(channel)
    }

    func send(api: BoolaaAPI, bubbleID: UUID, senderID: UUID, text: String) async -> Bool {
        do {
            let message = try await api.sendMessage(bubbleID: bubbleID, senderID: senderID, content: text)
            merge(message)
            return true
        } catch {
            self.error = error.userMessage
            return false
        }
    }
}

/// Bubble chat with realtime inserts and auto-scroll (spec §6).
struct ChatView: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var model = ChatModel()
    @State private var draft = ""
    @State private var sending = false
    @FocusState private var composerFocused: Bool

    private static let bottomID = "chat-bottom"

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 10) {
                        if model.loaded && model.messages.isEmpty {
                            EmptyStateView(icon: "bubble.left.and.bubble.right", title: "No messages yet",
                                           message: "Be the first to say something.")
                                .padding(.top, 40)
                        }
                        ForEach(Array(model.messages.enumerated()), id: \.element.id) { index, message in
                            let previous = index > 0 ? model.messages[index - 1] : nil
                            MessageRow(message: message,
                                       isMine: message.senderId == session.userID,
                                       showAuthor: previous?.senderId != message.senderId)
                        }
                        Color.clear.frame(height: 1).id(Self.bottomID)
                    }
                    .padding(.horizontal, 12)
                    .padding(.top, 8)
                }
                .scrollDismissesKeyboard(.interactively)
                .defaultScrollAnchor(.bottom)
                .onChange(of: model.messages.last?.id) { _, _ in
                    withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(Self.bottomID, anchor: .bottom) }
                }
                .onChange(of: composerFocused) { _, focused in
                    if focused { withAnimation { proxy.scrollTo(Self.bottomID, anchor: .bottom) } }
                }
            }
            composer
        }
        .background(Theme.background.ignoresSafeArea())
        .toolbar(.hidden, for: .navigationBar)
        .task(id: session.currentBubble?.id) {
            guard let id = session.currentBubble?.id else { return }
            await model.load(api: session.api, bubbleID: id)
            await model.listen(client: session.api.client, bubbleID: id)
        }
        .errorAlert($model.error)
    }

    private var header: some View {
        HStack(spacing: 12) {
            Button { dismiss() } label: {
                Image(systemName: "chevron.left").font(.system(size: 18, weight: .bold))
                    .foregroundStyle(Theme.brand)
                    .frame(width: 40, height: 40)
                    .background(Circle().fill(Theme.card))
                    .shadow(color: .black.opacity(0.08), radius: 6, y: 2)
            }
            .accessibilityLabel("Back")
            .accessibilityIdentifier("chat-back")
            VStack(alignment: .leading, spacing: 0) {
                Text("Chat").font(.system(size: 28, weight: .bold)).accessibilityIdentifier("screen-title")
                Text(verbatim: session.currentBubble?.name ?? "").font(.subheadline).foregroundStyle(Theme.brand)
            }
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 10) {
            TextField("Message", text: $draft, axis: .vertical)
                .lineLimit(1...5)
                .focused($composerFocused)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(Theme.card, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                .accessibilityIdentifier("chat-input")
            Button {
                Task { await send() }
            } label: {
                Image(systemName: "arrow.up")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(Theme.brand.opacity(canSend ? 1 : 0.4)))
            }
            .disabled(!canSend)
            .accessibilityLabel("Send")
            .accessibilityIdentifier("chat-send")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Theme.background)
    }

    private var canSend: Bool { !sending && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    private func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let bubbleID = session.currentBubble?.id, let me = session.userID, !text.isEmpty else { return }
        sending = true
        defer { sending = false }
        draft = ""
        if !(await model.send(api: session.api, bubbleID: bubbleID, senderID: me, text: String(text.prefix(4000)))) {
            draft = text
        }
    }
}

struct MessageRow: View {
    var message: ChatMessage
    var isMine: Bool
    var showAuthor: Bool

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            if isMine { Spacer(minLength: 48) }
            if !isMine {
                if showAuthor { AvatarView(user: message.sender, size: 32) } else { Color.clear.frame(width: 32, height: 1) }
            }
            VStack(alignment: isMine ? .trailing : .leading, spacing: 3) {
                if showAuthor {
                    Text(isMine ? String(localized: "You", comment: "Author label for your own chat messages") : (message.sender?.displayName ?? String(localized: "Someone")))
                        .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                }
                Text(verbatim: message.content)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .foregroundStyle(isMine ? Color.white : Color.primary)
                    .background(isMine ? Theme.brand : Theme.otherBubble,
                                in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                Text(message.createdAt.formatted(date: .omitted, time: .shortened))
                    .font(.caption2).foregroundStyle(.tertiary)
            }
            if isMine {
                if showAuthor { AvatarView(user: message.sender, size: 32) } else { Color.clear.frame(width: 32, height: 1) }
            }
            if !isMine { Spacer(minLength: 48) }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("message-\(message.id.uuidString)")
    }
}
