import SwiftUI
import UIKit

@MainActor
@Observable
final class SettingsModel {
    var members: [BubbleMember] = []
    var requests: [JoinRequest] = []
    var loaded = false
    var error: String?
    @ObservationIgnored private let reloads = ReloadCoalescer()

    var memberIDs: Set<UUID> { Set(members.map(\.userId)) }

    /// Keeps members and pending requests live until the view disappears.
    func listen(api: BoolaaAPI, bubbleID: UUID) async {
        await LiveChanges.observe(
            api.client,
            topic: "settings:\(bubbleID.uuidString.lowercased())",
            watches: [
                .init(table: "bubble_members", column: "bubble_id", equals: bubbleID,
                      deleteMatches: { LiveChanges.record($0, "bubble_id", is: bubbleID) }),
                .init(table: "join_requests", column: "bubble_id", equals: bubbleID,
                      deleteMatches: { [weak self] old in
                          guard let id = LiveChanges.id(of: old) else { return false }
                          return await self?.requests.contains { $0.id == id } ?? false
                      }),
            ],
            onChange: { [weak self] in
                self?.reloads.schedule { [weak self] in await self?.load(api: api, bubbleID: bubbleID) }
            }
        )
    }

    func remove(api: BoolaaAPI, member: BubbleMember) async {
        do {
            try await api.removeMember(bubbleID: member.bubbleId, userID: member.userId)
            members.removeAll { $0.userId == member.userId }
        } catch { self.error = error.userMessage }
    }

    func load(api: BoolaaAPI, bubbleID: UUID) async {
        do {
            async let m = api.members(bubbleID: bubbleID)
            async let r = api.joinRequests(bubbleID: bubbleID)
            (members, requests) = try await (m, r)
        } catch { self.error = error.userMessage }
        loaded = true
    }
}

/// Settings for the current bubble (spec §11).
struct SettingsView: View {
    @Environment(SessionStore.self) private var session
    @Environment(SafetyStore.self) private var safety
    @Environment(ShellRouter.self) private var router
    @State private var model = SettingsModel()
    @State private var editingInfo = false
    @State private var name = ""
    @State private var description = ""
    @State private var confirmLeave = false
    @State private var copied = false
    @State private var memberToRemove: BubbleMember?

    private var isOwner: Bool { session.currentRole == .owner }

    var body: some View {
        ScrollView {
            if let bubble = session.currentBubble {
                VStack(alignment: .leading, spacing: 14) {
                    infoCard(bubble)
                    inviteCard(bubble)

                    Button { router.open(.links) } label: {
                        HStack {
                            Label("Shared links", systemImage: "link").font(.headline)
                            Spacer()
                            Image(systemName: "chevron.right").foregroundStyle(.secondary)
                        }
                        .card()
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("settings-links")

                    SectionHeader(title: "Members", count: model.members.count)
                    VStack(spacing: 0) {
                        ForEach(model.members) { member in
                            HStack(spacing: 12) {
                                AvatarView(user: member.user, size: 36)
                                Text(verbatim: member.user?.displayName ?? String(localized: "Member", comment: "Placeholder for a member without a name")).font(.body.weight(.medium)).lineLimit(1)
                                if member.userId == session.userID { Text("(you)", comment: "Suffix after your own name in the member list").foregroundStyle(.secondary).lineLimit(1) }
                                Spacer()
                                if safety.isBlocked(member.userId) {
                                    Text("Blocked", comment: "Badge on a member you blocked").font(.caption.weight(.bold)).foregroundStyle(.secondary).lineLimit(1)
                                        .padding(.horizontal, 10).padding(.vertical, 4)
                                        .background(Capsule().stroke(Color.secondary.opacity(0.5)))
                                }
                                if member.role == .owner {
                                    Text("Owner", comment: "Badge for the bubble owner").font(.caption.weight(.bold)).foregroundStyle(.white).lineLimit(1)
                                        .padding(.horizontal, 10).padding(.vertical, 4)
                                        .background(Capsule().fill(Theme.brand))
                                }
                                if member.userId != session.userID {
                                    Menu {
                                        memberActions(member)
                                    } label: {
                                        Image(systemName: "ellipsis").foregroundStyle(.secondary).frame(width: 32, height: 32)
                                    }
                                    .accessibilityLabel(Text("More actions"))
                                    .accessibilityIdentifier("member-menu-\(member.user?.name ?? "")")
                                }
                            }
                            .padding(.vertical, 8)
                            .contentShape(Rectangle())
                            .contextMenu {
                                if member.userId != session.userID { memberActions(member) }
                            }
                            if member.id != model.members.last?.id { Divider() }
                        }
                    }
                    .card()

                    SectionHeader(title: "Pending join requests", count: model.requests.count)
                    if model.loaded && model.requests.isEmpty {
                        Text("No one is waiting to join.").font(.subheadline).foregroundStyle(.secondary).card()
                    }
                    ForEach(model.requests) { request in requestRow(request) }

                    Button(role: .destructive) { confirmLeave = true } label: {
                        Text("Leave bubble").font(.headline).foregroundStyle(.red)
                            .frame(maxWidth: .infinity, minHeight: 50)
                            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(.red, lineWidth: 2))
                    }
                    .padding(.top, 8)
                    .accessibilityIdentifier("leave-bubble")
                }
                .padding(.horizontal, 16)
                .padding(.bottom, Theme.tabBarClearance)
            }
        }
        .refreshable { await reload() }
        .task {
            await reload()
            if let id = session.currentBubble?.id { await model.listen(api: session.api, bubbleID: id) }
        }
        .confirmationDialog(
            Text("Remove “\(memberToRemove?.user?.displayName ?? "")” from the bubble?", comment: "Confirmation title; the argument is a member's name"),
            isPresented: Binding(get: { memberToRemove != nil }, set: { if !$0 { memberToRemove = nil } }),
            titleVisibility: .visible,
            presenting: memberToRemove
        ) { member in
            Button("Remove member", role: .destructive) {
                Task { await model.remove(api: session.api, member: member) }
            }
        } message: { _ in
            Text("They can ask to join again with the invite code.")
        }
        .confirmationDialog(Text("Leave “\(session.currentBubble?.name ?? "")”?", comment: "Confirmation title; the argument is the bubble name"), isPresented: $confirmLeave, titleVisibility: .visible) {
            Button("Leave bubble", role: .destructive) {
                Task {
                    do { try await session.leaveCurrentBubble() } catch { model.error = error.userMessage }
                }
            }
        } message: {
            Text("You'll need a new invite and the members' approval to come back.")
        }
        .errorAlert($model.error)
    }

    private func infoCard(_ bubble: Bubble) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if editingInfo {
                TextField("Name", text: $name).boolaaField()
                TextField("Description", text: $description, axis: .vertical).lineLimit(2...4).padding(.vertical, 12).boolaaField()
                HStack {
                    Button("Cancel") { editingInfo = false }.buttonStyle(SecondaryButtonStyle())
                    Button("Save") {
                        Task {
                            do {
                                try await session.updateCurrentBubble(
                                    name: name.trimmingCharacters(in: .whitespaces),
                                    description: description.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty)
                                editingInfo = false
                            } catch { model.error = error.userMessage }
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            } else {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(verbatim: bubble.name).font(.title2.bold())
                        if let d = bubble.description?.nilIfEmpty {
                            Text(verbatim: d).foregroundStyle(.secondary)
                        } else {
                            Text("No description").foregroundStyle(.secondary)
                        }
                        Text("\(model.members.count) of \(bubble.maxSize) members", comment: "Bubble size: current members of maximum")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if isOwner {
                        Button {
                            name = bubble.name; description = bubble.description ?? ""; editingInfo = true
                        } label: {
                            Image(systemName: "pencil").font(.headline).foregroundStyle(Theme.brand)
                                .frame(width: 36, height: 36).background(Circle().fill(Theme.brand.opacity(0.12)))
                        }
                        .accessibilityLabel("Edit bubble")
                        .accessibilityIdentifier("edit-bubble")
                    }
                }
            }
        }
        .card()
    }

    private func inviteCard(_ bubble: Bubble) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Invite code").font(.caption.weight(.bold)).foregroundStyle(.secondary).textCase(.uppercase)
            HStack {
                Text(verbatim: bubble.inviteCode)
                    .font(.system(size: 26, weight: .bold, design: .monospaced))
                    .foregroundStyle(Theme.brand)
                    .accessibilityIdentifier("invite-code")
                Spacer()
                Button {
                    UIPasteboard.general.string = bubble.inviteCode
                    copied = true
                    Task { try? await Task.sleep(for: .seconds(1.5)); copied = false }
                } label: {
                    Image(systemName: copied ? "checkmark" : "doc.on.doc").font(.headline)
                        .frame(width: 40, height: 40).background(Circle().fill(Theme.brand.opacity(0.12)))
                }
                .accessibilityLabel("Copy invite code")
                ShareLink(item: String(localized: "Join my bubble “\(bubble.name)” on Boolaa with the invite code \(bubble.inviteCode)", comment: "Share sheet text; arguments are the bubble name and invite code")) {
                    Image(systemName: "square.and.arrow.up").font(.headline)
                        .frame(width: 40, height: 40).background(Circle().fill(Theme.brand.opacity(0.12)))
                }
                .accessibilityLabel("Share invite code")
            }
            .foregroundStyle(Theme.brand)
        }
        .card()
    }

    @ViewBuilder
    private func memberActions(_ member: BubbleMember) -> some View {
        SafetyMenuItems(target: .member(member))
        if canRemove(member) {
            Divider()
            Button("Remove member", systemImage: "person.badge.minus", role: .destructive) { memberToRemove = member }
        }
    }

    private func canRemove(_ member: BubbleMember) -> Bool {
        isOwner && member.role != .owner && member.userId != session.userID
    }

    private func requestRow(_ request: JoinRequest) -> some View {
        let memberCount = model.members.count
        let needed = JoinRequest.approvalsNeeded(memberCount: memberCount)
        let approvals = request.countedApprovals(memberIDs: model.memberIDs)
        let waitingForSeat = JoinRequest.isWaitingForSeat(
            approvals: approvals, memberCount: memberCount, maxSize: session.currentBubble?.maxSize ?? .max)
        let alreadyApproved = session.userID.map(request.approverIds.contains) ?? false
        return HStack(spacing: 12) {
            AvatarView(user: request.user, size: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: request.user?.displayName ?? String(localized: "Someone")).font(.headline).lineLimit(1)
                if waitingForSeat {
                    Text("Approved, waiting for a free spot", comment: "Join request has a majority but the bubble is full")
                        .font(.subheadline).foregroundStyle(Theme.brand).lineLimit(2)
                } else {
                    Text("\(approvals) of \(needed) approvals", comment: "Join request progress: approvals so far of approvals needed")
                        .font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                }
            }
            Spacer()
            if !alreadyApproved {
                Button {
                    Task {
                        do {
                            _ = try await session.api.approveJoinRequest(id: request.id)
                            await reload()
                        } catch { model.error = error.userMessage }
                    }
                } label: {
                    Image(systemName: "checkmark").font(.headline).foregroundStyle(.white)
                        .frame(width: 38, height: 38).background(Circle().fill(Theme.brand))
                }
                .accessibilityLabel("Approve")
                .accessibilityIdentifier("approve-request")
            } else {
                Text("Approved", comment: "Shown instead of the approve button when you already approved").font(.caption.weight(.semibold)).foregroundStyle(Theme.brand).lineLimit(1)
            }
            Button {
                Task {
                    do {
                        try await session.api.rejectJoinRequest(id: request.id)
                        await reload()
                    } catch { model.error = error.userMessage }
                }
            } label: {
                Image(systemName: "xmark").font(.headline).foregroundStyle(.red)
                    .frame(width: 38, height: 38).background(Circle().fill(Color.red.opacity(0.12)))
            }
            .accessibilityLabel("Reject")
            .accessibilityIdentifier("reject-request")
        }
        .card()
    }

    private func reload() async {
        guard let id = session.currentBubble?.id else { return }
        await model.load(api: session.api, bubbleID: id)
    }
}
