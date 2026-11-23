import SwiftUI

/// Suspended or banned account (docs/moderation.md "Clients"). Calm and still on purpose: no orbs, no confetti.
/// Shows the end date and the reason when there is a session to read them with, the appeal address, sign out
/// and delete account. After a `user_banned` sign-in there is no session, so it only explains and goes back.
struct SuspendedView: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.scenePhase) private var scenePhase
    @State private var showDelete = false

    static let appealAddress = "privacy@boolaa.ro"

    private var suspension: Suspension { session.suspension ?? Suspension(kind: .signInBlocked) }

    private var title: LocalizedStringResource {
        suspension.kind == .banned ? "Your account is banned" : "Your account is suspended"
    }

    var body: some View {
        AuthScaffold(title: title, calm: true, screenID: "suspended") {
            VStack(alignment: .leading, spacing: 10) {
                switch suspension.kind {
                case .suspended:
                    if let until = suspension.until {
                        Text("You can use Boolaa again from \(until.formatted(date: .long, time: .shortened)).")
                            .font(.body.weight(.semibold))
                            .accessibilityIdentifier("suspended-until")
                    }
                    Text("Until then you can't see your bubbles or post anything.").foregroundStyle(Theme.inkSecondary)
                case .banned:
                    Text("You can't use Boolaa with this account anymore.")
                case .signInBlocked:
                    Text("This account can't sign in right now: it's suspended or banned.")
                }
                if let reason = suspension.reason {
                    Text("Reason: \(String(localized: reason.label))")
                        .accessibilityIdentifier("suspended-reason")
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Text("Think this is a mistake? Write to [privacy@boolaa.ro](mailto:privacy@boolaa.ro) and tell us why.",
                 comment: "Keep the Markdown link and its mailto: URL unchanged")
                .font(.subheadline)
                .tint(Theme.brandText)
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.field, in: RoundedRectangle(cornerRadius: Theme.Radius.field, style: .continuous))
                .accessibilityIdentifier("suspended-appeal")

            if suspension.kind == .signInBlocked {
                Button("Back to sign in") { session.dismissSignInBlocked() }
                    .buttonStyle(PrimaryButtonStyle(calm: true))
                    .accessibilityIdentifier("suspended-back")
            } else {
                Button {
                    Task { await session.signOut() }
                } label: {
                    Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                }
                .buttonStyle(PrimaryButtonStyle(calm: true))
                .accessibilityIdentifier("suspended-sign-out")
            }
        } footer: {
            if suspension.kind != .signInBlocked {
                AuthTextLink(title: "Delete account", icon: "trash", id: "suspended-delete", hue: .coral) { showDelete = true }
            }
        }
        .sheet(isPresented: $showDelete) { DeleteAccountSheet(onDeleted: { showDelete = false }).calmSurface().boolaaSheet() }
        .onChange(of: scenePhase) { _, phase in
            // A suspension ends by itself: check again when the app comes back to the front.
            if phase == .active, suspension.kind != .signInBlocked { Task { await session.continueAfterVerification() } }
        }
    }
}
