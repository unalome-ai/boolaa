import SwiftUI

/// Login and register (spec §1).
struct AuthView: View {
    @Environment(SessionStore.self) private var session
    @State private var isRegistering = DebugHooks.startOnRegister
    @State private var ageConfirmed = false
    @State private var legalPage: LegalPage?
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?
    @State private var info: String?

    private var canSubmit: Bool {
        !email.isEmpty && password.count >= 6
            && (!isRegistering || (!name.trimmingCharacters(in: .whitespaces).isEmpty && ageConfirmed))
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 28) {
                VStack(spacing: 12) {
                    BoolaaLogo(size: 84)
                    Text(verbatim: "Boolaa").font(.system(size: 40, weight: .heavy, design: .rounded))
                    Text("Your private bubbles of flatmates, friends and clubs.")
                        .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
                .padding(.top, 48)

                Picker("Mode", selection: $isRegistering.animation()) {
                    Text("Sign in").tag(false)
                    Text("Create account").tag(true)
                }
                .pickerStyle(.segmented)

                VStack(spacing: 12) {
                    if isRegistering {
                        TextField("Name", text: $name)
                            .textContentType(.name)
                            .boolaaField()
                            .accessibilityIdentifier("auth-name")
                    }
                    TextField("Email", text: $email)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .boolaaField()
                        .accessibilityIdentifier("auth-email")
                    SecureField("Password", text: $password)
                        .textContentType(isRegistering ? .newPassword : .password)
                        .boolaaField()
                        .accessibilityIdentifier("auth-password")
                }

                if isRegistering { legalConsent }

                if let info {
                    Text(verbatim: info).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }

                Button {
                    Task { await submit() }
                } label: {
                    if busy { ProgressView().tint(.white) } else { Text(isRegistering ? LocalizedStringResource("Create account") : LocalizedStringResource("Sign in")) }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!canSubmit || busy)
                .accessibilityIdentifier("auth-submit")
            }
            .padding(24)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Theme.background.ignoresSafeArea())
        .errorAlert($error)
        .legalPageSheet($legalPage)
    }

    /// Terms/Privacy links and the 16+ confirmation required before Create account.
    private var legalConsent: some View {
        VStack(alignment: .leading, spacing: 12) {
            Toggle(isOn: $ageConfirmed) {
                Text("I confirm I'm 16 or older").font(.subheadline.weight(.medium))
            }
            .tint(Theme.brand)
            .accessibilityIdentifier("auth-age")
            Text("By creating an account you agree to the [Terms](boolaa-legal://terms) and [Privacy Policy](boolaa-legal://privacy).",
                 comment: "Keep the two Markdown links and their boolaa-legal:// URLs unchanged; translate only the link text")
                .font(.footnote).foregroundStyle(.secondary)
                .tint(Theme.brand)
                .environment(\.openURL, OpenURLAction { url in
                    if let page = LegalPage(link: url) { legalPage = page; return .handled }
                    return .systemAction
                })
                .accessibilityIdentifier("auth-legal")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func submit() async {
        busy = true
        defer { busy = false }
        do {
            if isRegistering {
                let signedIn = try await session.signUp(name: name, email: email, password: password)
                if !signedIn { info = String(localized: "Check your inbox to confirm your email, then sign in."); isRegistering = false }
            } else {
                try await session.signIn(email: email, password: password)
            }
        } catch {
            self.error = error.userMessage
        }
    }
}
