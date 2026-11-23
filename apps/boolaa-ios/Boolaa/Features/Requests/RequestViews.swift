import SwiftUI

/// The item a request UI acts on (a food post or a marketplace item).
struct RequestTarget: Equatable, Identifiable {
    let kind: ItemKind
    let id: UUID
    let bubbleID: UUID
    let ownerID: UUID
    /// Market title, or the food description ("" for food without one).
    let title: String
    let ownerName: String
    var availability: MarketAvailability
    var requestCount: Int

    var hue: Hue { kind == .food ? Feature.food.hue : Feature.market.hue }

    /// What VoiceOver names the item in "I want it: …".
    var spokenTitle: String {
        title.isEmpty ? String(localized: "New food post") : title
    }
}

/// "3 requests" pill next to the availability badge, for everyone; the owner's opens the Requests sheet.
struct RequestCountPill: View {
    var count: Int
    var hue: Hue
    var onTap: (() -> Void)? = nil

    var body: some View {
        let label = Text("\(count) requests", comment: "Pill: number of open requests on a food post or market item")
        let pill = label
            .font(.rounded(.caption, weight: .heavy)).monospacedDigit()
            .foregroundStyle(hue.text)
            .lineLimit(1).fixedSize()
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(hue.wash, in: Capsule())
        if let onTap {
            Button(action: onTap) { pill.frame(minHeight: 44).contentShape(Rectangle()) }
                .buttonStyle(.squish)
                .accessibilityIdentifier("request-count")
        } else {
            pill.accessibilityIdentifier("request-count")
        }
    }
}

/// The availability badge as this viewer sees it: "Reserved for {name}" (owner), "Reserved for you" (the pick),
/// "It's yours" (market, handed to me), else the plain Reserved / Taken badge.
struct RequestAwareBadge: View {
    var availability: MarketAvailability
    var hue: Hue
    var isOwner: Bool
    var picked: ItemRequest?
    var mine: ItemRequest?

    var body: some View {
        if availability == .reserved, isOwner, let picked {
            filled(Text("Reserved for \(picked.requester?.displayName ?? "")", comment: "Owner's badge; the argument is the picked person's name"),
                   icon: "hourglass", id: "badge-reserved-for")
        } else if availability == .reserved, mine?.status == .picked {
            filled(Text("Reserved for you", comment: "Badge on an item the owner picked for me"), icon: "hourglass", id: "badge-reserved-for-you")
        } else if availability == .taken, mine?.status == .received {
            filled(Text("It's yours", comment: "Badge on an item handed over to me"), icon: "gift.fill", id: "badge-yours")
        } else {
            AvailabilityBadge(availability: availability)
        }
    }

    private func filled(_ text: Text, icon: String, id: String) -> some View {
        Label { text } icon: { Image(systemName: icon) }
            .labelStyle(.titleAndIcon)
            .font(.rounded(.caption, weight: .heavy))
            .foregroundStyle(hue.onFill)
            .lineLimit(1)
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(hue.gradient, in: Capsule())
            .overlay(Capsule().strokeBorder(.white.opacity(0.5), lineWidth: 1))
            .accessibilityIdentifier(id)
    }
}

/// Toasts and errors from the request actions, shared by the action row and the Requests sheet.
@MainActor
enum RequestFeedback {
    static func toast(_ text: String, hue: Hue) {
        CheerCenter.shared.show(text, hue: hue)
    }
}

/// The bottom action row of someone else's item: "I want it", "Requested" + "Withdraw request",
/// "Reserved for you" + "Withdraw request", "Someone else got it" (spec, "UI rules").
struct RequestActionRow: View {
    var target: RequestTarget
    var store: RequestStore
    var me: UUID?
    /// Shows an error; `reload` is true for itemGone / itemNotAvailable / requestGone.
    var onError: (UserFacingError) -> Void

    @State private var asking = false
    @State private var confirmWithdraw = false

    var body: some View {
        let mine = store.mine(for: target.id, me: me)
        let action = RequestAction.resolve(availability: target.availability, mine: mine)
        Group {
            switch action {
            case .iWantIt:
                Button { asking = true } label: {
                    Label { Text("I want it", comment: "Button asking the owner for a food post or market item") } icon: { Image(systemName: "hand.raised.fill") }
                }
                .buttonStyle(PrimaryButtonStyle(hue: target.hue))
                .accessibilityLabel(Text("I want it: \(target.spokenTitle)", comment: "Accessibility label; the argument is the item"))
                .accessibilityIdentifier("request-i-want-it")
            case .none:
                EmptyView()
            case .requested(let onList):
                HStack(spacing: 10) {
                    ChipView(title: onList ? String(localized: "Reserved · you're on the list", comment: "Chip: my request is pending while the item is reserved for someone else")
                                           : String(localized: "Requested", comment: "Chip: I asked for this item"),
                             isActive: false, systemImage: "checkmark", outlined: true, hue: target.hue)
                        .accessibilityIdentifier("request-requested")
                    Spacer(minLength: 0)
                    withdrawButton(mine, confirm: false)
                }
            case .reservedForYou:
                HStack(spacing: 10) {
                    Spacer(minLength: 0)
                    withdrawButton(mine, confirm: true)
                }
            case .yours:
                EmptyView() // the "It's yours" badge says it
            case .missed:
                Text("Someone else got it", comment: "Muted line: the owner gave the item to someone else")
                    .font(.subheadline).foregroundStyle(Theme.inkSecondary)
                    .accessibilityIdentifier("request-missed")
            }
        }
        .disabled(store.isBusy(target.id))
        .sheet(isPresented: $asking) {
            RequestNoteSheet(target: target) { note in
                asking = false
                Task { await send(note) }
            }
        }
        .confirmationDialog(Text("Withdraw your request?", comment: "Confirmation title before withdrawing a picked request"),
                            isPresented: $confirmWithdraw, titleVisibility: .visible) {
            Button(role: .destructive) {
                if let mine { Task { await withdraw(mine) } }
            } label: { Text("Withdraw", comment: "Confirmation button: withdraw my request") }
            .accessibilityIdentifier("request-withdraw-confirm")
        } message: {
            Text("\(target.ownerName) will be told you changed your mind.", comment: "Withdraw confirmation; the argument is the owner's name")
        }
    }

    @ViewBuilder
    private func withdrawButton(_ mine: ItemRequest?, confirm: Bool) -> some View {
        if let mine {
            Button {
                if confirm { confirmWithdraw = true } else { Task { await withdraw(mine) } }
            } label: {
                Text("Withdraw request", comment: "Text button: take back my request").font(.rounded(.subheadline))
                    .frame(minHeight: 44).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(target.hue.text)
            .accessibilityLabel(Text("Withdraw request: \(target.spokenTitle)", comment: "Accessibility label; the argument is the item"))
            .accessibilityIdentifier("request-withdraw")
        }
    }

    private func send(_ note: String?) async {
        guard let me else { return }
        if let error = await store.request(api: sessionAPI, item: target.id, bubbleID: target.bubbleID, ownerID: target.ownerID, me: me, note: note) {
            onError(error)
        } else {
            RequestFeedback.toast(String(localized: "Request sent. \(target.ownerName) will see it.", comment: "Toast; the argument is the owner's name"), hue: target.hue)
        }
    }

    private func withdraw(_ r: ItemRequest) async {
        if let error = await store.withdraw(api: sessionAPI, r) { onError(error) }
    }

    @Environment(SessionStore.self) private var session
    private var sessionAPI: BoolaaAPI { session.api }
}

/// "I want it" with an optional note (≤ 200 characters, live counter).
struct RequestNoteSheet: View {
    var target: RequestTarget
    var onSend: (String?) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var note = ""
    @FocusState private var focused: Bool
    static let maxNote = 200

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 10) {
                TextField(String(localized: "Add a note (optional)", comment: "Placeholder of the note sent with a request"),
                          text: $note, axis: .vertical)
                    .lineLimit(3...6)
                    .focused($focused)
                    .padding(.vertical, 12)
                    .boolaaField()
                    .onChange(of: note) { _, value in
                        if value.count > Self.maxNote { note = String(value.prefix(Self.maxNote)) }
                    }
                    .accessibilityIdentifier("request-note")
                Text(verbatim: "\(note.count)/\(Self.maxNote)")
                    .font(.caption).monospacedDigit().foregroundStyle(Theme.inkSecondary)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                Spacer(minLength: 0)
            }
            .padding(20)
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle(Text("I want it", comment: "Button asking the owner for a food post or market item"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        let trimmed = note.split(whereSeparator: \.isWhitespace).joined(separator: " ")
                        onSend(trimmed.isEmpty ? nil : trimmed)
                    } label: { Text("Send request", comment: "Sends an \"I want it\" request") }
                    .accessibilityIdentifier("request-send")
                }
            }
            .onAppear { focused = true }
        }
        .presentationDetents([.medium])
        .boolaaSheet()
    }
}

/// The owner's "Requests · 3" button, or the muted "No requests yet." line.
struct OwnerRequestsButton: View {
    var count: Int
    var hue: Hue
    var onOpen: () -> Void

    var body: some View {
        if count > 0 {
            Button(action: onOpen) {
                Label { Text("Requests · \(count)", comment: "Owner's button opening the requests; the argument is the number") }
                    icon: { Image(systemName: "hand.raised.fill") }
            }
            .buttonStyle(SecondaryButtonStyle(hue: hue))
            .accessibilityIdentifier("owner-requests")
        } else {
            Text("No requests yet.", comment: "Owner's item with no requests").font(.subheadline).foregroundStyle(Theme.inkSecondary)
                .accessibilityIdentifier("owner-no-requests")
        }
    }
}

/// The owner's Requests sheet: oldest first, the pick pinned on top with "Mark as handed over" and "Undo pick".
struct RequestsSheet: View {
    var target: RequestTarget
    var store: RequestStore
    /// The item's availability after a pick / undo / hand-over, applied to the list at once.
    var onAvailability: (MarketAvailability) -> Void
    /// Called after the sheet showed the error itself (the parent reloads the list when it went stale).
    var onError: (UserFacingError) -> Void

    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var confirmHandOver = false
    @State private var error: String?

    var body: some View {
        let rows = store.open(for: target.id)
        let pick = rows.first { $0.status == .picked }
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if rows.isEmpty {
                        EmptyStateView(title: LocalizedStringResource("No requests yet.", comment: "Owner's item with no requests"),
                                       message: LocalizedStringResource("Members can tap “I want it” on your post.", comment: "Requests sheet empty state hint"),
                                       hue: target.hue)
                            .accessibilityIdentifier("requests-empty")
                    }
                    ForEach(rows) { r in
                        row(r, pick: pick)
                            .motionTransition(.opacity)
                    }
                }
                .padding(20)
                .animation(Motion.resolve(Motion.snappy, reduceMotion: reduceMotion), value: rows.map { "\($0.id)\($0.status.rawValue)" })
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle(Text("Requests", comment: "Title of the owner's requests sheet"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .confirmationDialog(Text("Mark as handed over?", comment: "Confirmation title before handing an item over"),
                                isPresented: $confirmHandOver, titleVisibility: .visible, presenting: pick) { p in
                Button { Task { await handOver() } } label: { Text("Mark as handed over", comment: "Button: the owner gave the item to the picked person") }
                    .accessibilityIdentifier("requests-hand-over-confirm")
            } message: { p in
                Text(Self.handOverMessage(kind: target.kind, name: p.requester?.displayName ?? "", title: target.title))
            }
        }
        .errorAlert($error)
        .presentationDetents([.medium, .large])
        .boolaaSheet()
    }

    private func fail(_ e: UserFacingError) {
        error = String(localized: e.message)
        onError(e)
    }

    static func handOverMessage(kind: ItemKind, name: String, title: String) -> String {
        kind == .market
            ? String(localized: "\(name) gets “\(title)”. Everyone else who asked will hear that someone else got it.",
                     comment: "Hand-over confirmation (market); arguments: the picked person's name, the item title")
            : String(localized: "\(name) gets your food. The post disappears from the Food Circle, and everyone else who asked will hear that someone else got it.",
                     comment: "Hand-over confirmation (food); the argument is the picked person's name")
    }

    private func row(_ r: ItemRequest, pick: ItemRequest?) -> some View {
        let name = r.requester?.displayName ?? ""
        let isPick = r.status == .picked
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                AvatarView(user: r.requester, size: 40).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(verbatim: name).font(.rounded(.body, weight: .bold))
                        if isPick {
                            Text("Your pick", comment: "Badge on the request the owner picked")
                                .font(.rounded(.caption, weight: .heavy)).foregroundStyle(target.hue.onFill)
                                .padding(.horizontal, 8).padding(.vertical, 3)
                                .background(target.hue.gradient, in: Capsule())
                        }
                    }
                    if let note = r.note?.nilIfEmpty { Text(verbatim: note).font(.subheadline) }
                    Text(verbatim: r.createdAt.relativeShort).font(.caption).foregroundStyle(Theme.inkSecondary)
                }
                Spacer(minLength: 0)
            }
            .accessibilityElement(children: .combine)
            if isPick {
                HStack(spacing: 10) {
                    Button { confirmHandOver = true } label: { Text("Mark as handed over", comment: "Button: the owner gave the item to the picked person") }
                        .buttonStyle(PrimaryButtonStyle(hue: target.hue))
                        .accessibilityIdentifier("requests-hand-over")
                    Button { Task { await unpick() } } label: { Text("Undo pick", comment: "Button: clear the owner's pick") }
                        .buttonStyle(SecondaryButtonStyle(hue: target.hue))
                        .accessibilityIdentifier("requests-undo-pick")
                }
            } else {
                Button { Task { await pickRow(r) } } label: {
                    pick == nil ? Text("Pick", comment: "Button: give the item to this requester")
                                : Text("Pick instead", comment: "Button: give the item to this requester instead of the current pick")
                }
                .buttonStyle(SecondaryButtonStyle(hue: target.hue))
                .accessibilityLabel(Text("Pick: \(name)", comment: "Accessibility label of Pick; the argument is the requester's name"))
                .accessibilityIdentifier("requests-pick")
            }
        }
        .padding(14)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
        .cardChrome()
        .disabled(store.isBusy(target.id))
    }

    private func pickRow(_ r: ItemRequest) async {
        if let error = await store.pick(api: session.api, r) { fail(error); return }
        onAvailability(.reserved)
        let text = String(localized: "Reserved for \(r.requester?.displayName ?? ""). Sort out the pick-up in the chat.",
                          comment: "Toast after picking; the argument is the picked person's name")
        RequestFeedback.toast(text, hue: target.hue)
    }

    private func unpick() async {
        if let error = await store.unpick(api: session.api, item: target.id) { fail(error); return }
        onAvailability(.available)
        A11y.announce(String(localized: MarketAvailability.available.label))
    }

    private func handOver() async {
        if let error = await store.handOver(api: session.api, item: target.id) { fail(error); return }
        onAvailability(.taken)
        A11y.announce(String(localized: MarketAvailability.taken.label))
        dismiss()
    }
}
