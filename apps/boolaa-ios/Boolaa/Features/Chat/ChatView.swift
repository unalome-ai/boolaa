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
    @Environment(SafetyStore.self) private var safety
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var model = ChatModel()
    @State private var draft = ""
    @State private var sending = false
    @State private var sentCount = 0
    /// Messages present after the first load; only ones that arrive later pop in.
    @State private var initialIDs: Set<UUID>?
    @FocusState private var composerFocused: Bool

    private static let bottomID = "chat-bottom"

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 4) {
                        if model.loaded && model.messages.isEmpty {
                            EmptyStateView(icon: "bubble.left.and.bubble.right.fill", title: "No messages yet",
                                           message: "Be the first to say something.")
                                .padding(.top, 40)
                        }
                        ForEach(Array(model.messages.enumerated()), id: \.element.id) { index, message in
                            let previous = index > 0 ? model.messages[index - 1] : nil
                            let next = index + 1 < model.messages.count ? model.messages[index + 1] : nil
                            let isMine = message.senderId == session.userID
                            MessageRow(message: message,
                                       isMine: isMine,
                                       showAuthor: previous?.senderId != message.senderId,
                                       endsGroup: next?.senderId != message.senderId)
                                .safetyContextMenu(.message(message))
                                .modifier(MessagePop(enabled: initialIDs.map { !$0.contains(message.id) } ?? false,
                                                     anchor: isMine ? .bottomTrailing : .bottomLeading))
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
        .background { ShellBackground(hue: Hue.forID(session.currentBubble?.id)) }
        .toolbar(.hidden, for: .navigationBar)
        // Reload (and resubscribe) after a block/unblock: RLS hides or shows the other person's messages.
        .task(id: "\(session.currentBubble?.id.uuidString ?? "")-\(safety.contentVersion)") {
            guard let id = session.currentBubble?.id else { return }
            initialIDs = nil
            await model.load(api: session.api, bubbleID: id)
            initialIDs = Set(model.messages.map(\.id))
            await model.listen(client: session.api.client, bubbleID: id)
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

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 8) {
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
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.regularMaterial)
    }

    private var canSend: Bool { !sending && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    private func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let bubbleID = session.currentBubble?.id, let me = session.userID, !text.isEmpty else { return }
        sending = true
        defer { sending = false }
        draft = ""
        sentCount += 1
        if !(await model.send(api: session.api, bubbleID: bubbleID, senderID: me, text: String(text.prefix(4000)))) {
            draft = text
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
                Text(verbatim: message.content)
                    .padding(.horizontal, 15)
                    .padding(.vertical, 10)
                    .foregroundStyle(isMine ? Color.white : Color.primary)
                    .background {
                        let shape = UnevenRoundedRectangle(
                            topLeadingRadius: 21, bottomLeadingRadius: !isMine && endsGroup ? 6 : 21,
                            bottomTrailingRadius: isMine && endsGroup ? 6 : 21, topTrailingRadius: 21, style: .continuous)
                        if isMine {
                            shape.fill(Hue.grape.gradient)
                        } else {
                            shape.fill(Theme.otherBubble).overlay(shape.strokeBorder(Theme.hairline, lineWidth: 1))
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
}
