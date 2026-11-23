import PhotosUI
import SwiftUI

/// Avatar, name, email, safety, legal and account actions (spec §12, Safety and account).
struct ProfileSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(SessionStore.self) private var session
    @State private var name = ""
    @State private var photo: PhotosPickerItem?
    @State private var busy = false
    @State private var showPicker = false
    @State private var error: String?
    @State private var path: [ProfileDestination] = []
    @State private var legalPage: LegalPage?
    @State private var showDeleteAccount = false
    @State private var showExportData = false

    enum ProfileDestination: Hashable { case blocked, security, notifications }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(spacing: 20) {
                    avatarPicker
                    .accessibilityIdentifier("avatar-picker")
                    .padding(.top, 12)

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Name").font(.rounded(.caption)).foregroundStyle(Theme.inkSecondary).padding(.leading, 4)
                        TextField("Your name", text: $name).boolaaField().accessibilityIdentifier("profile-name")
                        Text("Email").font(.rounded(.caption)).foregroundStyle(Theme.inkSecondary).padding(.top, 6).padding(.leading, 4)
                        Text(verbatim: session.email ?? "").foregroundStyle(Theme.inkSecondary)
                            .frame(maxWidth: .infinity, alignment: .leading).boolaaField()
                    }

                    Button("Save") {
                        Task {
                            busy = true; defer { busy = false }
                            do { try await session.updateProfile(name: name.trimmingCharacters(in: .whitespaces)) }
                            catch { self.error = error.userMessage }
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty || name == session.profile?.name)

                    VStack(spacing: 10) {
                        NavigationLink(value: ProfileDestination.security) {
                            ProfileRow(title: "Sign-in & security", icon: "lock.fill", trailing: "chevron.right", hue: .indigo)
                        }
                        .buttonStyle(.squish)
                        .accessibilityIdentifier("security-row")
                        NavigationLink(value: ProfileDestination.notifications) {
                            ProfileRow(title: LocalizedStringResource("Notifications", comment: "Screen title"),
                                       icon: "bell.fill", trailing: "chevron.right", hue: .grape)
                        }
                        .buttonStyle(.squish)
                        .accessibilityIdentifier("notifications-row")
                        LanguageRow()
                        NavigationLink(value: ProfileDestination.blocked) {
                            ProfileRow(title: "Blocked users", icon: "hand.raised.fill", trailing: "chevron.right", hue: .coral)
                        }
                        .buttonStyle(.squish)
                        .accessibilityIdentifier("blocked-users-row")
                        Button { legalPage = .privacy } label: {
                            ProfileRow(title: LegalPage.privacy.title, icon: "lock.shield.fill", trailing: "arrow.up.forward", hue: .mint)
                        }
                        .buttonStyle(.squish)
                        .accessibilityIdentifier("privacy-row")
                        Button { legalPage = .terms } label: {
                            ProfileRow(title: LegalPage.terms.title, icon: "doc.text.fill", trailing: "arrow.up.forward", hue: .sunny)
                        }
                        .buttonStyle(.squish)
                        .accessibilityIdentifier("terms-row")
                    }

                    Button("Sign out") {
                        Task { dismiss(); await session.signOut() }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .accessibilityIdentifier("sign-out")

                    Button { showExportData = true } label: {
                        Label { Text("Download my data") } icon: { Image(systemName: "arrow.down.doc") }
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Theme.brandText)
                            .frame(minHeight: 44)
                    }
                    .padding(.top, 4)
                    .accessibilityIdentifier("export-data")

                    Button(role: .destructive) { showDeleteAccount = true } label: {
                        Label { Text("Delete account") } icon: { Image(systemName: "trash") }
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Theme.dangerText)
                            .frame(minHeight: 44)
                    }
                    .padding(.top, 4)
                    .accessibilityIdentifier("delete-account")
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .navigationDestination(for: ProfileDestination.self) { destination in
                switch destination {
                case .blocked: BlockedUsersView().calmSurface()
                case .security: SecurityView()
                case .notifications: NotificationsView()
                }
            }
            .legalPageSheet($legalPage)
            .sheet(isPresented: $showExportData) {
                ExportDataSheet().boolaaSheet()
            }
            .sheet(isPresented: $showDeleteAccount) {
                DeleteAccountSheet(onDeleted: { showDeleteAccount = false; dismiss() }).calmSurface().boolaaSheet()
            }
            .onAppear {
                name = session.profile?.name ?? ""
                switch DebugHooks.consumeProfileOpen() {
                case "blocked": path = [.blocked]
                case "security": path = [.security]
                case "notifications": path = [.notifications]
                case "deleteAccount": showDeleteAccount = true
                case "exportData": showExportData = true
                default: break
                }
            }
            .onChange(of: photo) { _, item in
                guard let item else { return }
                Task { await uploadAvatar(item) }
            }
            .errorAlert($error)
        }
    }

    private var avatarPicker: some View {
        Button { showPicker = true } label: { avatarLabel }
            .buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text("Change profile photo", comment: "Accessibility label of the avatar button in the profile sheet"))
            .accessibilityAddTraits(.isButton)
            .photosPicker(isPresented: $showPicker, selection: $photo, matching: .images)
    }

    // Built here (main actor) because PhotosPicker's label closure is nonisolated.
    private var avatarLabel: some View {
        ZStack(alignment: .bottomTrailing) {
            AvatarView(user: session.profile, size: 112)
                .padding(5)
                .background(Circle().strokeBorder(
                    AngularGradient(colors: [Hue.grape.fill, Hue.pink.fill, Hue.sunny.fill, Hue.mint.fill, Hue.sky.fill, Hue.grape.fill], center: .center),
                    lineWidth: 3))
            Image(systemName: "camera.fill").font(.subheadline.weight(.bold)).foregroundStyle(.white)
                .frame(width: 38, height: 38).background(Circle().fill(Hue.grape.gradient))
                .overlay(Circle().strokeBorder(Theme.background, lineWidth: 3))
        }
        .overlay { if busy { ProgressView() } }
    }

    private func uploadAvatar(_ item: PhotosPickerItem) async {
        guard let me = session.userID else { return }
        busy = true; defer { busy = false }
        do {
            guard let raw = try await item.loadTransferable(type: Data.self) else { throw ImageCompression.Failure.unsupported }
            let jpeg = try await Task.detached(priority: .userInitiated) {
                try ImageCompression.jpeg(from: raw, for: .avatars)
            }.value
            let url = try await session.api.uploadImage(jpeg, bucket: .avatars, userID: me)
            try await session.updateProfile(avatar: url)
        } catch { self.error = error.userMessage }
    }
}

/// A tappable row styled like the other profile fields.
struct ProfileRow: View {
    var title: LocalizedStringResource
    var icon: String
    var trailing: String
    var hue: Hue = .grape

    var body: some View {
        HStack(spacing: 12) {
            FeatureBadge(icon: icon, hue: hue, size: 34)
            Text(title).foregroundStyle(.primary)
            Spacer()
            Image(systemName: trailing).font(.subheadline.weight(.bold)).foregroundStyle(Theme.inkSecondary)
        }
        .font(.body.weight(.medium))
        .padding(.horizontal, 12)
        .frame(minHeight: 56)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.Radius.row, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.row, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
        .contentShape(Rectangle())
    }
}

/// Shows the app's current language in its own language; tapping opens the app's page in Settings,
/// where iOS offers the per-app language picker. There is deliberately no in-app override.
struct LanguageRow: View {
    @Environment(\.openURL) private var openURL

    var body: some View {
        Button {
            if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
        } label: {
            HStack(spacing: 12) {
                FeatureBadge(icon: "globe", hue: .sky, size: 34)
                Text("Language").foregroundStyle(.primary)
                Spacer()
                Text(verbatim: AppLanguage.current.nativeName).foregroundStyle(Theme.inkSecondary)
                Image(systemName: "arrow.up.forward").font(.subheadline.weight(.bold)).foregroundStyle(Theme.inkSecondary)
            }
            .font(.body.weight(.medium))
            .padding(.horizontal, 12)
            .frame(minHeight: 56)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.Radius.row, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.row, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.squish)
        .accessibilityHint(Text("Opens Settings, where you can choose the app language."))
        .accessibilityIdentifier("language-row")
    }
}
