import SwiftUI
import UIKit

/// Identifiable wrapper so an invite code can drive `.sheet(item:)`.
struct PendingInvite: Identifiable, Hashable {
    let code: String
    var id: String { code }
}

/// The join preview for an opened invite link (docs/boolaa-spec.md, "Invite links"): name, cover, size and the
/// caller's status. "Request to join" goes through `request_to_join` and the members' vote, like a typed code.
struct JoinInviteSheet: View {
    let code: String
    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var phase: Phase = .loading
    @State private var busy = false
    @State private var error: String?

    enum Phase: Equatable {
        case loading
        case loaded(InvitePreview)
        case invalid
        case failed(String)
        case sent(InvitePreview)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    content
                }
                .padding(24)
                .frame(maxWidth: .infinity)
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }.accessibilityIdentifier("invite-close")
                }
            }
        }
        .task(id: code) { await load() }
        .errorAlert($error)
        .accessibilityIdentifier("invite-sheet")
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .loading:
            ProgressView().padding(.top, 60)
        case .invalid:
            Image(systemName: "link.badge.plus").font(.system(size: 44, weight: .bold)).foregroundStyle(.secondary)
            Text("This invite isn't valid").font(.rounded(.title2, weight: .heavy)).multilineTextAlignment(.center)
                .accessibilityIdentifier("invite-invalid")
            Text("The link may be old or the code was changed. Ask a member for a new one.")
                .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
        case .failed(let message):
            Text(verbatim: message).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
            Button("Try again") { Task { await load() } }.buttonStyle(SecondaryButtonStyle())
        case .loaded(let preview):
            header(preview)
            actions(preview)
        case .sent(let preview):
            header(preview)
            Label { Text("Request sent") } icon: { Image(systemName: "checkmark.circle.fill").foregroundStyle(Hue.mint.text) }
                .font(.rounded(.headline))
                .accessibilityIdentifier("invite-sent")
            Text("The members vote on your request. You're in once most of them say yes.")
                .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
            Button("Done") { dismiss() }.buttonStyle(PrimaryButtonStyle())
        }
    }

    private func header(_ preview: InvitePreview) -> some View {
        let hue = Hue.forID(preview.bubbleId) // grape for non-members (no id)
        return VStack(spacing: 12) {
            Text("You've got an invite").font(.rounded(.subheadline, weight: .heavy)).foregroundStyle(.secondary)
                .textCase(.uppercase)
            Group {
                if let logo = preview.logo, !logo.isEmpty {
                    // Private bucket: the preview granted this caller the cover for an hour (get_invite_preview).
                    StoredImage(stored: logo) { phase in
                        if let image = phase.image { image.resizable().scaledToFill() } else { BubbleOrb(hue: hue) }
                    }
                    .clipShape(Circle())
                } else {
                    BubbleOrb(hue: hue)
                }
            }
            .frame(width: 96, height: 96)
            .shadow(color: hue.fill.opacity(0.35), radius: 12, y: 6)
            Text(verbatim: preview.name).font(.rounded(.title, weight: .heavy)).multilineTextAlignment(.center)
                .accessibilityIdentifier("invite-name")
            Text("\(preview.memberCount) of \(preview.maxSize) members", comment: "Bubble size: current members of maximum")
                .font(.rounded(.subheadline)).monospacedDigit().foregroundStyle(hue.text)
                .padding(.horizontal, 12).padding(.vertical, 5)
                .background(hue.wash, in: Capsule())
        }
    }

    @ViewBuilder
    private func actions(_ preview: InvitePreview) -> some View {
        switch preview.status {
        case .open:
            Text("The members vote on your request. You're in once most of them say yes.")
                .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
            Button {
                Task { await request(preview) }
            } label: {
                if busy { ProgressView() } else { Text("Request to join") }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(busy)
            .accessibilityIdentifier("invite-request")
        case .pending:
            Label { Text("You've already asked to join. Waiting for the members to approve.") } icon: { Image(systemName: "hourglass") }
                .font(.subheadline).foregroundStyle(.secondary)
                .accessibilityIdentifier("invite-pending")
            Button("Done") { dismiss() }.buttonStyle(SecondaryButtonStyle())
        case .member:
            Text("You're already in this bubble.").font(.subheadline).foregroundStyle(.secondary)
                .accessibilityIdentifier("invite-member")
            Button("Open bubble") {
                if let id = preview.bubbleId { session.selectBubble(id) }
                dismiss()
            }
            .buttonStyle(PrimaryButtonStyle())
        case .full:
            Text(UserFacingError.bubbleFull.message).font(.subheadline).foregroundStyle(Theme.dangerText)
                .accessibilityIdentifier("invite-full")
            Button("Done") { dismiss() }.buttonStyle(SecondaryButtonStyle())
        }
    }

    private func load() async {
        phase = .loading
        do {
            if let preview = try await session.invitePreview(code: code) { phase = .loaded(preview) } else { phase = .invalid }
        } catch {
            phase = .failed(error.userMessage)
        }
    }

    private func request(_ preview: InvitePreview) async {
        busy = true; defer { busy = false }
        do {
            _ = try await session.requestToJoin(code: code)
            phase = .sent(preview)
        } catch {
            switch UserFacingError.classify(error) {
            case .invalidInviteCode: phase = .invalid
            default: self.error = error.userMessage
            }
        }
    }
}

/// Full-screen-ish QR code of a bubble's invite link, for a friend to scan with the Camera app.
struct InviteQRSheet: View {
    let bubbleName: String
    let url: URL
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                if let image = InviteLink.qrImage(for: url.absoluteString) {
                    Image(uiImage: image)
                        .interpolation(.none)
                        .resizable()
                        .scaledToFit()
                        .padding(18)
                        .background(.white, in: RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
                        .frame(maxWidth: 300)
                        .accessibilityLabel(Text("QR code"))
                        .accessibilityIdentifier("invite-qr")
                }
                Text("Let a friend scan this to ask to join \(bubbleName).", comment: "Under the invite QR code; the argument is the bubble name")
                    .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                Text(verbatim: url.absoluteString).font(.footnote.monospaced()).foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .navigationTitle(Text("QR code"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
    }
}
