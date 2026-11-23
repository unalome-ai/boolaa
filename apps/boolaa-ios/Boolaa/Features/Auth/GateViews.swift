import SwiftUI

/// "Check your email" (docs/auth-security.md §8): this device needs the code we email. Sends once on entry
/// (not again within 60 s), takes 6 digits (autofill, paste, auto-submit), resends after a cooldown.
struct DeviceCodeView: View {
    @Environment(SessionStore.self) private var session
    @State private var code = ""
    @State private var busy = false
    @State private var sending = false
    @State private var error: String?
    @State private var notice: String?
    @State private var shakes = 0
    @State private var retrying = false

    var body: some View {
        if session.deviceGate == .failed {
            AuthScaffold(title: "Check your email", subtitle: Text("We couldn't check this device."), screenID: "device-check-failed") {
                if let message = session.gateError { FormMessage(text: message) }
                Button {
                    Task { retrying = true; await session.continueAfterVerification(); retrying = false }
                } label: {
                    if retrying { ProgressView() } else { Text("Try again") }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(retrying)
                .accessibilityIdentifier("device-retry")
            } footer: {
                useAnotherAccount
            }
        } else {
            AuthScaffold(
                title: "Check your email",
                subtitle: Text("You're signing in on a new device. Enter the 6-digit code we sent to \(session.email ?? "")."),
                screenID: "device-code"
            ) {
                CodeInput(code: $code, isInvalid: error != nil, isDisabled: busy) { value in
                    Task { await verify(value) }
                }
                .shake(shakes)
                if let error { FormMessage(text: error) } else if let notice { FormMessage(text: notice, kind: .notice) }
                Button {
                    Task { await verify(code) }
                } label: {
                    if busy { ProgressView() } else { Text("Verify") }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(busy || code.count != CodeInput.length)
                .shake(shakes)
                .accessibilityIdentifier("device-verify")
                resendRow
            } footer: {
                useAnotherAccount
            }
            .sensoryFeedback(.error, trigger: shakes)
            .task {
                if RouteGate.shouldAutoSend(lastSentAt: session.deviceCodeSentAt) { await send(manual: false) }
            }
        }
    }

    private var resendRow: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 6) {
                Text("Didn't get it?").font(.subheadline).foregroundStyle(Theme.inkSecondary)
                ResendCodeButton(sentAt: session.deviceCodeSentAt, busy: sending) { Task { await send(manual: true) } }
                Spacer(minLength: 8)
                PasteCodeButton(code: $code)
            }
            VStack(spacing: 4) {
                Text("Didn't get it?").font(.subheadline).foregroundStyle(Theme.inkSecondary)
                ResendCodeButton(sentAt: session.deviceCodeSentAt, busy: sending) { Task { await send(manual: true) } }
                PasteCodeButton(code: $code)
            }
        }
    }

    private var useAnotherAccount: some View {
        AuthTextLink(title: "Use another account", icon: "rectangle.portrait.and.arrow.right", id: "use-another-account") {
            Task { await session.signOut() }
        }
    }

    private func send(manual: Bool) async {
        sending = true; defer { sending = false }
        error = nil; notice = nil
        do {
            try await session.sendDeviceCode()
            if manual { notice = String(localized: "We've sent you a new code.") }
        } catch {
            await handle(error)
        }
    }

    private func verify(_ value: String) async {
        guard !busy else { return }
        guard value.count == CodeInput.length else {
            error = String(localized: UserFacingError.codeFormat.message); shakes += 1; return
        }
        busy = true
        error = nil; notice = nil
        do {
            try await session.verifyDeviceCode(value)
            Haptics.success()
            await session.continueAfterVerification()
        } catch {
            code = ""
            shakes += 1
            await handle(error)
        }
        busy = false
    }

    /// A second 401 after the refresh-and-retry means the session is gone: sign out.
    private func handle(_ error: any Error) async {
        if UserFacingError.classify(error) == .notAuthenticated {
            await session.signOut()
            return
        }
        self.error = error.userMessage
    }
}

/// One-time "I'm 16 or older" + "I accept the Terms" (docs/auth-security.md §6) → `confirm_age`.
/// Delete account stays available here.
struct AgeConfirmationView: View {
    @Environment(SessionStore.self) private var session
    @State private var adult = false
    @State private var terms = false
    @State private var busy = false
    @State private var error: String?
    @State private var shakes = 0
    @State private var legalPage: LegalPage?
    @State private var showDelete = false

    var body: some View {
        AuthScaffold(title: "One last thing", subtitle: Text("Confirm these two things and you're in."), screenID: "age-screen") {
            VStack(alignment: .leading, spacing: 12) {
                Toggle(isOn: $adult) {
                    Text("I'm 16 or older").font(.body.weight(.medium))
                }
                .accessibilityIdentifier("age-16")
                Toggle(isOn: $terms) {
                    Text("I accept the [Terms of Use](boolaa-legal://terms) and I've read the [Privacy Policy](boolaa-legal://privacy).",
                         comment: "Keep the two Markdown links and their boolaa-legal:// URLs unchanged; translate only the link text")
                        .font(.subheadline)
                }
                .accessibilityIdentifier("age-terms")
            }
            .tint(Theme.brand)
            .padding(14)
            .background(Theme.field.opacity(0.6), in: RoundedRectangle(cornerRadius: Theme.Radius.field, style: .continuous))
            .environment(\.openURL, OpenURLAction { url in
                if let page = LegalPage(link: url) { legalPage = page; return .handled }
                return .systemAction
            })
            if let error { FormMessage(text: error) }
            Button {
                Task { await submit() }
            } label: {
                if busy { ProgressView() } else { Text("Continue") }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(busy || !adult || !terms)
            .shake(shakes)
            .accessibilityIdentifier("age-continue")
        } footer: {
            VStack(spacing: 0) {
                AuthTextLink(title: "Delete account", icon: "trash", id: "age-delete", hue: .coral) { showDelete = true }
                AuthTextLink(title: "Use another account", icon: "rectangle.portrait.and.arrow.right", id: "use-another-account") {
                    Task { await session.signOut() }
                }
            }
        }
        .sensoryFeedback(.error, trigger: shakes)
        .legalPageSheet($legalPage)
        .sheet(isPresented: $showDelete) { DeleteAccountSheet(onDeleted: { showDelete = false }).calmSurface().boolaaSheet() }
    }

    private func submit() async {
        busy = true; defer { busy = false }
        error = nil
        do {
            try await session.confirmAge()
            Haptics.success()
        } catch {
            shakes += 1
            self.error = error.userMessage
        }
    }
}

/// After a reset code: choose the new password, then the gate continues as for any sign-in.
struct NewPasswordView: View {
    @Environment(SessionStore.self) private var session
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?
    @State private var shakes = 0

    var body: some View {
        AuthScaffold(title: "Choose a new password", subtitle: Text("You're almost back in."), screenID: "reset-password") {
            VStack(alignment: .leading, spacing: 6) {
                SecureField("New password", text: $password)
                    .textContentType(.newPassword)
                    .boolaaField()
                    .accessibilityIdentifier("new-password")
                Text("At least 8 characters is best.").font(.footnote).foregroundStyle(Theme.inkSecondary).padding(.leading, 4)
            }
            if let error { FormMessage(text: error) }
            Button {
                Task { await save() }
            } label: {
                if busy { ProgressView() } else { Text("Save password") }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(busy || password.count < 6)
            .shake(shakes)
            .accessibilityIdentifier("save-password")
        } footer: {
            AuthTextLink(title: "Use another account", icon: "rectangle.portrait.and.arrow.right", id: "use-another-account") {
                Task { await session.signOut() }
            }
        }
        .sensoryFeedback(.error, trigger: shakes)
    }

    private func save() async {
        busy = true; defer { busy = false }
        error = nil
        do {
            try await session.finishPasswordReset(newPassword: password)
            Haptics.success()
        } catch {
            shakes += 1
            self.error = error.userMessage
        }
    }
}
