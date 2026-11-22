import SwiftUI

/// Shown to signed-in users with no approved bubble: create, join, or wait for approval (spec §3).
struct OnboardingView: View {
    @Environment(SessionStore.self) private var session
    @State private var mode: Mode = .join
    @State private var error: String?

    enum Mode: String, CaseIterable { case join, create }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(session.pendingRequests.isEmpty ? LocalizedStringResource("Welcome") : LocalizedStringResource("Pending approval"))
                            .font(.system(size: 32, weight: .bold))
                            .lineLimit(2).minimumScaleFactor(0.75)
                        Text(session.pendingRequests.isEmpty
                             ? LocalizedStringResource("Start a bubble or join one with an invite code.")
                             : LocalizedStringResource("The members of these bubbles are voting on your request."))
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Menu {
                        Button("Sign out", role: .destructive) { Task { await session.signOut() } }
                    } label: {
                        AvatarView(user: session.profile, size: 40)
                    }
                    .accessibilityLabel(Text("Profile"))
                    .accessibilityIdentifier("onboarding-profile")
                }

                if !session.pendingRequests.isEmpty {
                    PendingRequestsList(error: $error)
                }

                VStack(alignment: .leading, spacing: 14) {
                    Picker("Mode", selection: $mode) {
                        ForEach(Mode.allCases, id: \.self) { Text($0 == .join ? LocalizedStringResource("Join a bubble") : LocalizedStringResource("Create a bubble")).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    if mode == .join {
                        JoinBubbleForm()
                    } else {
                        CreateBubbleForm()
                    }
                }
                .card(padding: 16)
            }
            .padding(20)
        }
        .refreshable { await session.reload() }
        .background(Theme.background.ignoresSafeArea())
        .errorAlert($error)
    }
}

/// The user's own pending requests with approvals so far and a cancel button.
struct PendingRequestsList: View {
    @Environment(SessionStore.self) private var session
    @Binding var error: String?

    var body: some View {
        VStack(spacing: 12) {
            ForEach(session.pendingRequests) { request in
                HStack(spacing: 14) {
                    ZStack {
                        Circle().fill(Theme.brand.opacity(0.15)).frame(width: 48, height: 48)
                        Image(systemName: "hourglass").foregroundStyle(Theme.brand).font(.title3)
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text(verbatim: request.bubble?.name ?? "").font(.headline)
                        Text("\(request.approverIds.count) approvals so far", comment: "Approvals a pending join request has received")
                            .font(.subheadline).foregroundStyle(.secondary)
                        Text("Requested \(request.createdAt.relativeShort)", comment: "When a join request was sent; the argument is a relative time like “5 min ago”")
                            .font(.caption).foregroundStyle(.tertiary)
                    }
                    Spacer()
                    Button("Cancel", role: .destructive) {
                        Task {
                            do { try await session.cancelRequest(request) } catch { self.error = error.userMessage }
                        }
                    }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("cancel-request")
                }
                .card()
            }
        }
        .accessibilityIdentifier("pending-requests")
    }
}
