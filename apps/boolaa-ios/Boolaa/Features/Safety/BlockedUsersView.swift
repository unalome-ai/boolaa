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
                    EmptyStateView(icon: "hand.raised", title: "No blocked users",
                                   message: "Long-press a message, post or member to block someone.")
                }
                VStack(spacing: 0) {
                    ForEach(safety.blocked) { row in
                        HStack(spacing: 12) {
                            AvatarView(user: row.user, size: 36)
                            Text(verbatim: row.user?.displayName ?? String(localized: "Someone", comment: "Placeholder for a user without a name"))
                                .font(.body.weight(.medium)).lineLimit(1)
                            Spacer()
                            Button("Unblock") { Task { await safety.unblock(row.blockedId) } }
                                .buttonStyle(.bordered).tint(Theme.brand)
                                .accessibilityIdentifier("unblock-\(row.user?.name ?? "")")
                        }
                        .padding(.vertical, 8)
                        if row.id != safety.blocked.last?.id { Divider() }
                    }
                }
                .padding(.horizontal, safety.blocked.isEmpty ? 0 : 16)
                .background(safety.blocked.isEmpty ? Color.clear : Theme.card,
                            in: RoundedRectangle(cornerRadius: 16, style: .continuous))
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
