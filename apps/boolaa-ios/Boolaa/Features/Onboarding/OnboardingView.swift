import SwiftUI

/// Shown to signed-in users with no approved bubble: create, join, or wait for approval (spec §3).
struct OnboardingView: View {
    @Environment(SessionStore.self) private var session
    @State private var mode: Mode = DebugHooks.string("UITestOnboarding").flatMap(Mode.init(rawValue:)) ?? .join
    @State private var error: String?
    /// Profile (security, delete account, legal) must be reachable before joining a bubble too.
    @State private var showProfile = false

    enum Mode: String, CaseIterable {
        case join, create
        static var options: [SegmentedPill<Mode>.Option] {
            [.init(value: .join, label: "Join a bubble"), .init(value: .create, label: "Create a bubble")]
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        DisplayTitle(title: session.pendingRequests.isEmpty ? LocalizedStringResource("Welcome") : LocalizedStringResource("Pending approval"))
                            .accessibilityAddTraits(.isHeader)
                        Text(session.pendingRequests.isEmpty
                             ? LocalizedStringResource("Start a bubble or join one with an invite code.")
                             : LocalizedStringResource("The members of these bubbles are voting on your request."))
                            .font(.subheadline).foregroundStyle(Theme.inkSecondary)
                    }
                    Spacer()
                    Menu {
                        Button { showProfile = true } label: { Label("Profile", systemImage: "person.crop.circle") }
                            .accessibilityIdentifier("onboarding-open-profile")
                        Button("Sign out", role: .destructive) { Task { await session.signOut() } }
                    } label: {
                        AvatarView(user: session.profile, size: 44)
                    }
                    .accessibilityLabel(Text("Profile"))
                    .accessibilityIdentifier("onboarding-profile")
                }

                if !session.pendingRequests.isEmpty {
                    PendingRequestsList(error: $error)
                }

                VStack(alignment: .leading, spacing: 14) {
                    SegmentedPill(selection: $mode, options: Mode.options)
                    if mode == .join {
                        JoinBubbleForm()
                    } else {
                        CreateBubbleForm()
                    }
                }
                .padding(18)
                .background(Theme.card.opacity(0.6), in: RoundedRectangle(cornerRadius: Theme.Radius.hero, style: .continuous))
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: Theme.Radius.hero, style: .continuous))
                .cardChrome(radius: Theme.Radius.hero)
                .popIn(2)
            }
            .padding(20)
        }
        .refreshable { await session.reload() }
        .background { AuthBackdrop(intensity: 0.7) }
        .errorAlert($error)
        .sheet(isPresented: $showProfile) { ProfileSheet().boolaaSheet() }
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
                    ZStack(alignment: .bottomTrailing) {
                        BubbleLogo(id: request.bubbleId, name: request.bubble?.name ?? "", logo: request.bubble?.logo, size: 50)
                        Image(systemName: "hourglass").font(.system(size: 11, weight: .bold))
                            .foregroundStyle(Hue.forID(request.bubbleId).onFill)
                            .symbolEffect(.pulse, options: .repeat(3))
                            .frame(width: 22, height: 22)
                            .background(Circle().fill(Hue.forID(request.bubbleId).gradient))
                            .overlay(Circle().strokeBorder(Theme.card, lineWidth: 2))
                            .offset(x: 4, y: 4)
                            .accessibilityHidden(true)
                    }
                    .frame(width: 50, height: 50)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(verbatim: request.bubble?.name ?? "").font(.rounded(.headline))
                        Text("\(request.approverIds.count) approvals so far", comment: "Approvals a pending join request has received")
                            .font(.subheadline).foregroundStyle(Theme.inkSecondary)
                        Text("Requested \(request.createdAt.relativeShort)", comment: "When a join request was sent; the argument is a relative time like “5 min ago”")
                            .font(.caption).foregroundStyle(Theme.inkSecondary)
                    }
                    Spacer()
                    Button("Cancel", role: .destructive) {
                        Task {
                            do { try await session.cancelRequest(request) } catch { self.error = error.userMessage }
                        }
                    }
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
                    .tint(Theme.dangerText)
                    .accessibilityIdentifier("cancel-request")
                }
                .card()
                .popIn(1)
            }
        }
        .accessibilityIdentifier("pending-requests")
    }
}
