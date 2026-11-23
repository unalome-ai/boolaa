import PhotosUI
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

    /// Owner only: promote/demote. Returns true on success.
    func setRole(api: BoolaaAPI, member: BubbleMember, role: MemberRole) async -> Bool {
        do {
            try await api.setMemberRole(bubbleID: member.bubbleId, userID: member.userId, role: role)
            if let i = members.firstIndex(where: { $0.userId == member.userId }) { members[i].role = role }
            return true
        } catch { self.error = error.userMessage; return false }
    }

    /// Owner only: hand the bubble to `member`; the caller becomes an admin.
    func transfer(api: BoolaaAPI, to member: BubbleMember, me: UUID?) async -> Bool {
        do {
            try await api.transferOwnership(bubbleID: member.bubbleId, newOwnerID: member.userId)
            for i in members.indices {
                if members[i].userId == member.userId { members[i].role = .owner }
                else if members[i].userId == me { members[i].role = .admin }
            }
            return true
        } catch { self.error = error.userMessage; return false }
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
    @State private var linkCopied = false
    @State private var showInviteQR = false
    @State private var confirmRotate = false
    @State private var rotating = false
    @State private var memberToRemove: BubbleMember?
    @State private var memberToTransfer: BubbleMember?
    @State private var notice: String?
    @State private var photoItem: PhotosPickerItem?
    @State private var showPhotoPicker = false
    @State private var photoBusy = false

    /// My role, read from the live members list (roles change on transfer, promotion and hand-over),
    /// falling back to my membership row. docs/boolaa-spec.md, "Roles"; the server enforces the same rules.
    private var myRole: MemberRole? {
        model.members.first(where: { $0.userId == session.userID })?.role ?? session.currentRole
    }
    private var isOwner: Bool { myRole?.canChangeRoles ?? false }
    private var canManage: Bool { myRole?.canManage ?? false }

    var body: some View {
        ScrollViewReader { proxy in
            content
                .onChange(of: model.loaded) {
                    // Debug hook for screenshots: jump to the pending join requests.
                    if DebugHooks.string("UITestScrollTo") == "requests" { proxy.scrollTo("requests", anchor: .top) }
                    // A join-request notification was tapped.
                    if router.scrollToRequests {
                        router.scrollToRequests = false
                        withAnimation(Motion.gentle) { proxy.scrollTo("requests", anchor: .top) }
                    }
                }
        }
    }

    private var content: some View {
        ScrollView {
            if let bubble = session.currentBubble {
                VStack(alignment: .leading, spacing: 14) {
                    if let notice {
                        Text(verbatim: notice)
                            .font(.rounded(.subheadline, weight: .bold)).foregroundStyle(Hue.mint.text)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 14).padding(.vertical, 10)
                            .background(Hue.mint.wash, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                            .transition(.opacity)
                            .accessibilityIdentifier("settings-notice")
                    }
                    infoCard(bubble)
                    inviteCard(bubble)

                    Button { router.open(.links) } label: {
                        HStack(spacing: 12) {
                            FeatureBadge(icon: Feature.links.icon, hue: Feature.links.hue, size: 38)
                            Text("Shared links").font(.rounded(.headline)).foregroundStyle(.primary)
                            Spacer()
                            Image(systemName: "chevron.right").font(.subheadline.weight(.bold)).foregroundStyle(.secondary)
                        }
                        .card(padding: 14)
                    }
                    .buttonStyle(.squish)
                    .accessibilityIdentifier("settings-links")

                    BubbleMuteCard(bubbleID: bubble.id)

                    SectionHeader(title: "Members", count: model.members.count)
                    VStack(spacing: 0) {
                        ForEach(model.members) { member in
                            HStack(spacing: 12) {
                                AvatarView(user: member.user, size: 40)
                                Text(verbatim: member.user?.displayName ?? String(localized: "Member", comment: "Placeholder for a member without a name")).font(.body.weight(.medium)).lineLimit(1)
                                if member.userId == session.userID { Text("(you)", comment: "Suffix after your own name in the member list").foregroundStyle(.secondary).lineLimit(1) }
                                Spacer()
                                if safety.isBlocked(member.userId) {
                                    Text("Blocked", comment: "Badge on a member you blocked").font(.caption.weight(.bold)).foregroundStyle(.secondary).lineLimit(1)
                                        .padding(.horizontal, 10).padding(.vertical, 4)
                                        .background(Capsule().stroke(Color.secondary.opacity(0.5)))
                                }
                                if member.role == .owner {
                                    Label { Text("Owner", comment: "Badge for the bubble owner") } icon: { Image(systemName: "crown.fill") }
                                        .font(.rounded(.caption, weight: .heavy)).foregroundStyle(Hue.sunny.onFill).lineLimit(1)
                                        .padding(.horizontal, 10).padding(.vertical, 5)
                                        .background(Hue.sunny.gradient, in: Capsule())
                                        .fixedSize() // the name truncates first, never the role ("Proprie…" in ro)
                                        .accessibilityIdentifier("owner-badge")
                                } else if member.role == .admin {
                                    Label { Text("Admin", comment: "Badge for a bubble admin") } icon: { Image(systemName: "shield.fill") }
                                        .font(.rounded(.caption, weight: .heavy)).foregroundStyle(Hue.sky.text).lineLimit(1)
                                        .padding(.horizontal, 10).padding(.vertical, 5)
                                        .background(Hue.sky.wash, in: Capsule())
                                        .fixedSize() // the name truncates first, never the role ("Proprie…" in ro)
                                        .accessibilityIdentifier("admin-badge")
                                }
                                if member.userId != session.userID {
                                    Menu {
                                        memberActions(member)
                                    } label: {
                                        Image(systemName: "ellipsis").font(.body.weight(.bold)).foregroundStyle(.secondary).frame(width: 36, height: 36)
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

                    SectionHeader(title: "Pending join requests", count: model.requests.count).id("requests")
                    if model.loaded && model.requests.isEmpty {
                        Label { Text("No one is waiting to join.") } icon: { Image(systemName: "checkmark.circle.fill").foregroundStyle(Hue.mint.text) }
                            .font(.subheadline).foregroundStyle(.secondary).card(padding: 14)
                    }
                    ForEach(model.requests) { request in
                        requestRow(request).transition(.scale(scale: 0.9).combined(with: .opacity))
                    }

                    Button(role: .destructive) { confirmLeave = true } label: {
                        Label("Leave bubble", systemImage: "rectangle.portrait.and.arrow.right")
                            .font(.rounded(.headline)).foregroundStyle(Theme.dangerText)
                            .frame(maxWidth: .infinity, minHeight: 54)
                            .background(Theme.danger.opacity(0.1), in: RoundedRectangle(cornerRadius: 27, style: .continuous))
                    }
                    .buttonStyle(.squish)
                    .padding(.top, 8)
                    .accessibilityIdentifier("leave-bubble")
                }
                .padding(.horizontal, 16)
                .padding(.top, 4)
                .padding(.bottom, Theme.tabBarClearance)
                .animation(Motion.gentle, value: model.requests.map(\.id))
                .animation(Motion.gentle, value: model.members.map(\.id))
                .animation(Motion.gentle, value: editingInfo)
            }
        }
        .refreshFeedback { await reload() }
        .sensoryFeedback(.success, trigger: copied) { _, now in now }
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
        .confirmationDialog(
            Text("Transfer ownership?", comment: "Confirmation title before handing the bubble to another member"),
            isPresented: Binding(get: { memberToTransfer != nil }, set: { if !$0 { memberToTransfer = nil } }),
            titleVisibility: .visible,
            presenting: memberToTransfer
        ) { member in
            Button("Transfer ownership", role: .destructive) {
                Task {
                    if await model.transfer(api: session.api, to: member, me: session.userID) {
                        show(String(localized: "\(member.user?.displayName ?? "") is now the owner.", comment: "Notice after transferring ownership; the argument is the new owner's name"))
                        await session.reload()
                    }
                }
            }
            .accessibilityIdentifier("transfer-confirm")
        } message: { member in
            let name = member.user?.displayName ?? ""
            Text("\(name) becomes the owner of \(session.currentBubble?.name ?? ""). You'll lose your owner rights and become an admin: you won't be able to change roles, remove admins or take ownership back unless \(name) gives it back.",
                 comment: "Transfer confirmation; arguments: new owner's name, bubble name, new owner's name")
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
        // Invite links (docs/boolaa-spec.md): owner-only rotation kills the old code, link and QR code.
        .confirmationDialog(Text("Change the invite code?"), isPresented: $confirmRotate, titleVisibility: .visible) {
            Button("Change code", role: .destructive) {
                guard let id = session.currentBubble?.id else { return }
                Task {
                    rotating = true; defer { rotating = false }
                    do { try await session.rotateInviteCode(bubbleID: id) } catch { model.error = error.userMessage }
                }
            }
        } message: {
            Text("The old code, link and QR code stop working right away. Requests already sent stay.")
        }
        .sheet(isPresented: $showInviteQR) {
            if let bubble = session.currentBubble {
                InviteQRSheet(bubbleName: bubble.name, url: InviteLink.url(for: bubble.inviteCode)).boolaaSheet()
            }
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
                let hue = Hue.forID(bubble.id)
                HStack(alignment: .top, spacing: 14) {
                    BubbleLogo(bubble: bubble, size: 64)
                        .overlay { if photoBusy { ProgressView().tint(.white) } }
                        .shadow(color: hue.fill.opacity(0.4), radius: 8, y: 4)
                        .floating(amplitude: 3, period: 5)
                        .accessibilityIdentifier("bubble-logo")
                    VStack(alignment: .leading, spacing: 4) {
                        Text(verbatim: bubble.name).font(.rounded(.title2, weight: .heavy))
                        if let d = bubble.description?.nilIfEmpty {
                            Text(verbatim: d).font(.subheadline).foregroundStyle(.secondary)
                        } else {
                            Text("No description").font(.subheadline).foregroundStyle(.secondary)
                        }
                        Text("\(model.members.count) of \(bubble.maxSize) members", comment: "Bubble size: current members of maximum")
                            .font(.rounded(.caption)).monospacedDigit()
                            .foregroundStyle(hue.text)
                            .padding(.horizontal, 10).padding(.vertical, 4)
                            .background(hue.wash, in: Capsule())
                            .contentTransition(.numericText(value: Double(model.members.count)))
                            .padding(.top, 4)
                    }
                    Spacer(minLength: 0)
                    if canManage {
                        Button {
                            name = bubble.name; description = bubble.description ?? ""; editingInfo = true
                        } label: {
                            CircleIcon(systemName: "pencil", size: 40)
                        }
                        .buttonStyle(.squishIcon)
                        .accessibilityLabel("Edit bubble")
                        .accessibilityIdentifier("edit-bubble")
                    }
                }
                if canManage { photoControls(bubble) }
            }
        }
        .card()
        .photosPicker(isPresented: $showPhotoPicker, selection: $photoItem, matching: .images)
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            photoItem = nil
            Task { await uploadPhoto(item) }
        }
    }

    /// Owner and admins (can_manage_bubble): add, change or remove the bubble's photo.
    private func photoControls(_ bubble: Bubble) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Bubble photo", comment: "Settings: heading of the bubble photo controls")
                .font(.rounded(.caption, weight: .heavy)).foregroundStyle(.secondary).textCase(.uppercase)
            HStack(spacing: 10) {
                Button { showPhotoPicker = true } label: {
                    Label {
                        Text(bubble.logo == nil ? LocalizedStringResource("Add a photo", comment: "Settings: pick a photo for the bubble")
                             : LocalizedStringResource("Change photo", comment: "Settings: replace the bubble's photo"))
                    } icon: { Image(systemName: "camera.fill") }
                }
                .buttonStyle(SecondaryButtonStyle())
                .accessibilityIdentifier("bubble-photo-pick")
                if bubble.logo != nil {
                    Button(role: .destructive) { Task { await removePhoto() } } label: {
                        Label { Text("Remove photo", comment: "Settings: remove the bubble's photo") } icon: { Image(systemName: "trash") }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .accessibilityIdentifier("bubble-photo-remove")
                }
            }
            .disabled(photoBusy)
            Text("Everyone in the bubble sees it. Square photos look best.", comment: "Settings: hint under the bubble photo buttons")
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding(.top, 6)
    }

    private func uploadPhoto(_ item: PhotosPickerItem) async {
        photoBusy = true; defer { photoBusy = false }
        do {
            guard let raw = try await item.loadTransferable(type: Data.self) else { throw ImageCompression.Failure.unsupported }
            let jpeg = try await Task.detached(priority: .userInitiated) {
                try ImageCompression.jpeg(from: raw, for: .bubbles)
            }.value
            try await session.setCurrentBubbleLogo(jpeg)
        } catch { model.error = error.userMessage }
    }

    private func removePhoto() async {
        photoBusy = true; defer { photoBusy = false }
        do { try await session.setCurrentBubbleLogo(nil) } catch { model.error = error.userMessage }
    }

    private func inviteCard(_ bubble: Bubble) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Invite code").font(.rounded(.caption, weight: .heavy)).foregroundStyle(.secondary).textCase(.uppercase)
            HStack(spacing: 10) {
                Text(verbatim: bubble.inviteCode)
                    .font(.system(.title, design: .rounded, weight: .heavy))
                    .tracking(3)
                    .lineLimit(1).minimumScaleFactor(0.6)
                    .foregroundStyle(Theme.brandText)
                    .accessibilityIdentifier("invite-code")
                Spacer(minLength: 0)
                Button {
                    UIPasteboard.general.string = bubble.inviteCode
                    copied = true
                    Task { try? await Task.sleep(for: .seconds(1.5)); copied = false }
                } label: {
                    Image(systemName: copied ? "checkmark" : "doc.on.doc.fill")
                        .contentTransition(.symbolEffect(.replace))
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(copied ? Hue.mint.onFill : Hue.grape.text)
                        .frame(width: 44, height: 44)
                        .background(Circle().fill(copied ? Hue.mint.fill : Hue.grape.fill.opacity(0.16)))
                        .animation(Motion.bouncy, value: copied)
                }
                .buttonStyle(.squishIcon)
                .accessibilityLabel("Copy invite code")
                ShareLink(item: String(localized: "Join my bubble “\(bubble.name)” on Boolaa with the invite code \(bubble.inviteCode)", comment: "Share sheet text; arguments are the bubble name and invite code")) {
                    CircleIcon(systemName: "square.and.arrow.up", size: 44, filled: true)
                }
                .buttonStyle(.squishIcon)
                .accessibilityLabel("Share invite code")
            }
            inviteLinkRow(bubble)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Hue.grape.wash, in: RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
            .strokeBorder(Theme.brandText.opacity(0.45), style: StrokeStyle(lineWidth: 1.5, dash: [7, 6])))
    }

    /// The invite link `https://boolaa.ro/join/<CODE>`: copy, share, QR code for every member; a new code for the owner and admins.
    @ViewBuilder
    private func inviteLinkRow(_ bubble: Bubble) -> some View {
        let url = InviteLink.url(for: bubble.inviteCode)
        Divider().padding(.vertical, 2)
        Text("Invite link").font(.rounded(.caption, weight: .heavy)).foregroundStyle(.secondary).textCase(.uppercase)
        Text(verbatim: url.absoluteString)
            .font(.footnote.monospaced()).foregroundStyle(Theme.brandText)
            .lineLimit(1).truncationMode(.middle)
            .textSelection(.enabled)
            .accessibilityIdentifier("invite-link")
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
            Button {
                UIPasteboard.general.url = url
                linkCopied = true
                Task { try? await Task.sleep(for: .seconds(1.5)); linkCopied = false }
            } label: {
                Label("Copy link", systemImage: linkCopied ? "checkmark" : "link")
                    .contentTransition(.symbolEffect(.replace))
                    .frame(maxWidth: .infinity)
            }
            .accessibilityIdentifier("invite-copy-link")
            ShareLink(item: String(localized: "Join my bubble “\(bubble.name)” on Boolaa: \(url.absoluteString)",
                                   comment: "Share sheet text for the invite link; arguments are the bubble name and the link")) {
                Label("Share link", systemImage: "square.and.arrow.up").frame(maxWidth: .infinity)
            }
            .accessibilityIdentifier("invite-share-link")
            Button { showInviteQR = true } label: {
                Label("QR code", systemImage: "qrcode").frame(maxWidth: .infinity)
            }
            .accessibilityIdentifier("invite-qr-button")
            if canManage {
                Button { confirmRotate = true } label: {
                    Label("New code", systemImage: "arrow.triangle.2.circlepath").frame(maxWidth: .infinity)
                }
                .disabled(rotating)
                .accessibilityIdentifier("invite-rotate")
            }
        }
        .font(.rounded(.subheadline, weight: .bold))
        .lineLimit(1).minimumScaleFactor(0.8)
        .buttonStyle(.bordered)
        .buttonBorderShape(.capsule)
        .tint(Hue.grape.text)
        .sensoryFeedback(.success, trigger: linkCopied) { _, now in now }
    }

    @ViewBuilder
    private func memberActions(_ member: BubbleMember) -> some View {
        SafetyMenuItems(target: .member(member))
        if isOwner && member.userId != session.userID && member.role != .owner {
            Divider()
            if member.role == .admin {
                Button("Remove admin", systemImage: "shield.slash") { Task { await setRole(member, .member) } }
                    .accessibilityIdentifier("remove-admin")
            } else {
                Button("Make admin", systemImage: "shield") { Task { await setRole(member, .admin) } }
                    .accessibilityIdentifier("make-admin")
            }
            Button("Transfer ownership", systemImage: "crown") { memberToTransfer = member }
                .accessibilityIdentifier("transfer-ownership")
        }
        if canRemove(member) {
            Divider()
            Button("Remove member", systemImage: "person.badge.minus", role: .destructive) { memberToRemove = member }
        }
    }

    private func canRemove(_ member: BubbleMember) -> Bool {
        member.userId != session.userID && (myRole?.canRemove(member.role) ?? false)
    }

    private func setRole(_ member: BubbleMember, _ role: MemberRole) async {
        guard await model.setRole(api: session.api, member: member, role: role) else { return }
        let name = member.user?.displayName ?? ""
        show(role == .admin
             ? String(localized: "\(name) is now an admin.", comment: "Notice after making a member an admin")
             : String(localized: "\(name) is no longer an admin.", comment: "Notice after removing a member's admin role"))
    }

    private func show(_ text: String) {
        withAnimation(Motion.gentle) { notice = text }
        Task {
            try? await Task.sleep(for: .seconds(2.5))
            if notice == text { withAnimation(Motion.gentle) { notice = nil } }
        }
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
                Text(verbatim: request.user?.displayName ?? String(localized: "Someone")).font(.rounded(.headline)).lineLimit(1)
                if waitingForSeat {
                    Text("Approved, waiting for a free spot", comment: "Join request has a majority but the bubble is full")
                        .font(.subheadline).foregroundStyle(Theme.brandText).lineLimit(2)
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
                    CircleIcon(systemName: "checkmark", hue: .mint, size: 42, filled: true)
                }
                .buttonStyle(.squishIcon)
                .accessibilityLabel("Approve")
                .accessibilityIdentifier("approve-request")
            } else {
                Text("Approved", comment: "Shown instead of the approve button when you already approved").font(.rounded(.caption)).foregroundStyle(Hue.mint.text).lineLimit(1)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(Hue.mint.wash, in: Capsule())
            }
            Button {
                Task {
                    do {
                        try await session.api.rejectJoinRequest(id: request.id)
                        await reload()
                    } catch { model.error = error.userMessage }
                }
            } label: {
                Image(systemName: "xmark").font(.system(size: 16, weight: .bold)).foregroundStyle(Theme.dangerText)
                    .frame(width: 42, height: 42).background(Circle().fill(Theme.danger.opacity(0.12)))
            }
            .buttonStyle(.squishIcon)
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
