import SwiftUI

/// The people you blocked, with Unblock (profile sheet).
struct BlockedUsersView: View {
    @Environment(SafetyStore.self) private var safety

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("Blocked people can't see your messages, events, posts or links, and you won't see theirs.")
                    .font(.subheadline).foregroundStyle(.secondary)
                if safety.loaded && safety.blocked.isEmpty {
                    CalmEmptyState(icon: "hand.raised", title: "No blocked users",
                                   message: "Long-press a message, post or member to block someone.")
                }
                VStack(spacing: 0) {
                    ForEach(safety.blocked) { row in
                        HStack(spacing: 12) {
                            AvatarView(user: row.user, size: 40)
                            Text(verbatim: row.user?.displayName ?? String(localized: "Someone", comment: "Placeholder for a user without a name"))
                                .font(.body.weight(.medium)).lineLimit(1)
                            Spacer()
                            Button("Unblock") { Task { await safety.unblock(row.blockedId) } }
                                .buttonStyle(.bordered).buttonBorderShape(.capsule).tint(Theme.brandText)
                                .accessibilityIdentifier("unblock-\(row.user?.name ?? "")")
                        }
                        .padding(.vertical, 8)
                        if row.id != safety.blocked.last?.id { Divider() }
                    }
                }
                .padding(.horizontal, safety.blocked.isEmpty ? 0 : 16)
                .background(safety.blocked.isEmpty ? Color.clear : Theme.card,
                            in: RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
            }
            .padding(20)
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle("Blocked users")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await safety.load() }
        .task { await safety.load() }
        .errorAlert(Binding(get: { safety.error }, set: { safety.error = $0 }))
    }
}

/// Empty state for safety screens: no floating bubbles, no bounce.
struct CalmEmptyState: View {
    var icon: String
    var title: LocalizedStringResource
    var message: LocalizedStringResource
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 32, weight: .semibold)).foregroundStyle(.secondary)
                .padding(.bottom, 4)
            Text(title).font(.rounded(.headline)).multilineTextAlignment(.center)
            Text(message).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(24)
        .card(padding: 0)
        .accessibilityElement(children: .combine)
    }
}
