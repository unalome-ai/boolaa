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
    @State private var shakes = 0
    @State private var showForgot = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var canSubmit: Bool {
        !email.isEmpty && password.count >= 6
            && (!isRegistering || (!name.trimmingCharacters(in: .whitespaces).isEmpty && ageConfirmed))
    }

    var body: some View {
        if showForgot {
            ForgotPasswordView(email: email, onBack: { showForgot = false })
                .transition(.opacity)
        } else {
            form
        }
    }

    private var form: some View {
        let reduce = reduceMotion
        return ScrollView {
            VStack(spacing: 24) {
                VStack(spacing: 10) {
                    BoolaaLogo(size: 92)
                        .popIn(0)
                    Wordmark()
                    Text("Your private bubbles of flatmates, friends and clubs.")
                        .font(.rounded(.subheadline, weight: .medium))
                        .foregroundStyle(Theme.inkSecondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 12)
                        .popIn(6)
                }
                .padding(.top, 36)

                VStack(spacing: 16) {
                    SocialSignInButtons(error: $error)
                    OrDivider()
                    SegmentedPill(selection: $isRegistering, options: [
                        .init(value: false, label: "Sign in"),
                        .init(value: true, label: "Create account"),
                    ])

                    VStack(spacing: 12) {
                        if isRegistering {
                            TextField("Name", text: $name)
                                .textContentType(.name)
                                .boolaaField()
                                .accessibilityIdentifier("auth-name")
                                .transition(.opacity.combined(with: .scale(scale: 0.9, anchor: .top)))
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

                    if isRegistering {
                        legalConsent.transition(.opacity)
                    } else {
                        Button {
                            showForgot = true
                        } label: {
                            Text("Forgot password?").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.brandText)
                                .frame(maxWidth: .infinity, minHeight: 44, alignment: .trailing)
                        }
                        .accessibilityIdentifier("forgot-password")
                    }

                    if let info {
                        Text(verbatim: info).font(.footnote.weight(.medium)).foregroundStyle(Hue.mint.text).multilineTextAlignment(.center)
                            .padding(12)
                            .frame(maxWidth: .infinity)
                            .background(Hue.mint.wash, in: RoundedRectangle(cornerRadius: Theme.Radius.field, style: .continuous))
                    }

                    Button {
                        Task { await submit() }
                    } label: {
                        if busy { ProgressView() } else { Text(isRegistering ? LocalizedStringResource("Create account") : LocalizedStringResource("Sign in")) }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(!canSubmit || busy)
                    .accessibilityIdentifier("auth-submit")
                    .keyframeAnimator(initialValue: 0.0, trigger: shakes) { button, x in
                        button.offset(x: reduce ? 0 : x)
                    } keyframes: { _ in
                        KeyframeTrack {
                            CubicKeyframe(-10, duration: 0.07)
                            CubicKeyframe(9, duration: 0.09)
                            CubicKeyframe(-6, duration: 0.09)
                            CubicKeyframe(3, duration: 0.08)
                            SpringKeyframe(0, duration: 0.2)
                        }
                    }
                }
                .padding(18)
                .background(Theme.card.opacity(0.6), in: RoundedRectangle(cornerRadius: Theme.Radius.hero, style: .continuous))
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: Theme.Radius.hero, style: .continuous))
                .cardChrome(radius: Theme.Radius.hero)
                .popIn(7)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        }
        .scrollDismissesKeyboard(.interactively)
        .background { AuthBackdrop() }
        .sensoryFeedback(.error, trigger: shakes)
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
                .tint(Theme.brandText)
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
            shakes += 1
            self.error = error.userMessage
        }
    }
}

/// "Boolaa" set in heavy rounded type; the letters drop in one after another.
struct Wordmark: View {
    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array("Boolaa".enumerated()), id: \.offset) { index, letter in
                Text(verbatim: String(letter))
                    .font(.system(size: 46, weight: .heavy, design: .rounded))
                    .foregroundStyle(index == 1 || index == 2 ? Hue.grape.text : Theme.ink)
                    .popIn(index + 1)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: "Boolaa"))
        .accessibilityAddTraits(.isHeader)
    }
}

/// Joyful first impression: a soft sky gradient with bubbles floating up through it.
struct AuthBackdrop: View {
    var intensity = 1.0
    var body: some View {
        ZStack {
            LinearGradient(colors: [
                Color(light: Color(hex: 0xE9E0FF), dark: Color(hex: 0x241A45)),
                Theme.background,
                Color(light: Color(hex: 0xFFEDE3), dark: Color(hex: 0x1F1430)),
            ], startPoint: .top, endPoint: .bottom)
            BubbleBackdrop(intensity: intensity)
        }
        .ignoresSafeArea()
    }
}
