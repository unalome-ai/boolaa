import PhotosUI
import SwiftUI

/// Avatar, name, email and sign out (spec §12).
struct ProfileSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(SessionStore.self) private var session
    @State private var name = ""
    @State private var photo: PhotosPickerItem?
    @State private var busy = false
    @State private var showPicker = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    avatarPicker
                    .accessibilityIdentifier("avatar-picker")
                    .padding(.top, 12)

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Name").font(.caption.weight(.bold)).foregroundStyle(.secondary)
                        TextField("Your name", text: $name).boolaaField().accessibilityIdentifier("profile-name")
                        Text("Email").font(.caption.weight(.bold)).foregroundStyle(.secondary).padding(.top, 6)
                        Text(verbatim: session.email ?? "").foregroundStyle(.secondary)
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

                    LanguageRow()

                    Button("Sign out") {
                        Task { dismiss(); await session.signOut() }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .accessibilityIdentifier("sign-out")
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .onAppear { name = session.profile?.name ?? "" }
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
            .photosPicker(isPresented: $showPicker, selection: $photo, matching: .images)
    }

    // Built here (main actor) because PhotosPicker's label closure is nonisolated.
    private var avatarLabel: some View {
        ZStack(alignment: .bottomTrailing) {
            AvatarView(user: session.profile, size: 110)
            Image(systemName: "camera.fill").font(.subheadline).foregroundStyle(.white)
                .frame(width: 34, height: 34).background(Circle().fill(Theme.brand))
                .overlay(Circle().stroke(Theme.card, lineWidth: 3))
        }
        .overlay { if busy { ProgressView() } }
    }

    private func uploadAvatar(_ item: PhotosPickerItem) async {
        guard let me = session.userID else { return }
        busy = true; defer { busy = false }
        do {
            guard let raw = try await item.loadTransferable(type: Data.self),
                  let jpeg = ImageCompression.jpeg(from: raw, maxDimension: 512, quality: 0.8) else { return }
            let url = try await session.api.uploadImage(jpeg, bucket: .avatars, userID: me)
            try await session.updateProfile(avatar: url)
        } catch { self.error = error.userMessage }
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
            HStack {
                Label { Text("Language") } icon: { Image(systemName: "globe") }
                    .foregroundStyle(.primary)
                Spacer()
                Text(verbatim: AppLanguage.current.nativeName).foregroundStyle(.secondary)
                Image(systemName: "arrow.up.forward.app").foregroundStyle(Theme.brand)
            }
            .font(.body.weight(.medium))
            .boolaaField()
        }
        .buttonStyle(.plain)
        .accessibilityHint(Text("Opens Settings, where you can choose the app language."))
        .accessibilityIdentifier("language-row")
    }
}
