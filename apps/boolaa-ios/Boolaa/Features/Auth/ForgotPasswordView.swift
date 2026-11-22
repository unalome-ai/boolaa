import SwiftUI

/// Whether the forgot-password flow is waiting for its code, so an emailed reset link that opens the app
/// lands on the new-password screen too.
@MainActor
enum PasswordResetFlow {
    static var isWaitingForCode = false
}

/// "Forgot password?" (docs/auth-security.md §2): email → 6-digit recovery code (`verifyOTP` type `.recovery`) →
/// new password (`NewPasswordView`, shown by the routing gate once the code signs in) → signed in.
struct ForgotPasswordView: View {
    @Environment(SessionStore.self) private var session
    @State var email: String
    var onBack: () -> Void

    private enum Step { case email, code }
    @State private var step: Step = .email
    @State private var code = ""
    @State private var sentAt: Date?
    @State private var busy = false
    @State private var error: String?
    @State private var notice: String?
    @State private var shakes = 0

    private var trimmedEmail: String { email.trimmingCharacters(in: .whitespaces) }

    var body: some View {
        Group {
            switch step {
            case .email: emailStep
            case .code: codeStep
            }
        }
        .sensoryFeedback(.error, trigger: shakes)
        .onChange(of: step) { _, new in PasswordResetFlow.isWaitingForCode = new == .code }
        .onDisappear { PasswordResetFlow.isWaitingForCode = false }
    }

    private var emailStep: some View {
        AuthScaffold(title: "Reset your password", subtitle: Text("Enter your email and we'll send you a 6-digit code."), screenID: "reset-email") {
            TextField("Email", text: $email)
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .boolaaField()
                .accessibilityIdentifier("reset-email-field")
                .onSubmit { Task { await sendCode() } }
            if let error { FormMessage(text: error) }
            Button {
                Task { await sendCode() }
            } label: {
                if busy { ProgressView() } else { Text("Send code") }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(busy || !trimmedEmail.contains("@"))
            .shake(shakes)
            .accessibilityIdentifier("reset-send-code")
        } footer: {
            backToSignIn
        }
    }

    private var codeStep: some View {
        AuthScaffold(
            title: "Check your email",
            subtitle: Text("If an account exists for \(trimmedEmail), we've sent it a 6-digit code. It's valid for 10 minutes."),
            screenID: "reset-code"
        ) {
            CodeInput(code: $code, isInvalid: error != nil, isDisabled: busy) { value in Task { await verify(value) } }
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
            .accessibilityIdentifier("reset-verify")
            ViewThatFits(in: .horizontal) {
                HStack {
                    ResendCodeButton(sentAt: sentAt, busy: busy) { Task { await sendCode() } }
                    Spacer(minLength: 8)
                    PasteCodeButton(code: $code)
                }
                VStack(spacing: 4) {
                    ResendCodeButton(sentAt: sentAt, busy: busy) { Task { await sendCode() } }
                    PasteCodeButton(code: $code)
                }
            }
        } footer: {
            VStack(spacing: 0) {
                AuthTextLink(title: "Use another email", icon: "envelope", id: "reset-other-email") {
                    error = nil; notice = nil; code = ""; step = .email
                }
                backToSignIn
            }
        }
    }

    private var backToSignIn: some View {
        AuthTextLink(title: "Back to sign in", icon: "chevron.left", id: "reset-back", action: onBack)
    }

    private func sendCode() async {
        guard !busy, trimmedEmail.contains("@") else { return }
        busy = true; defer { busy = false }
        error = nil; notice = nil
        do {
            try await session.sendPasswordReset(email: trimmedEmail)
            sentAt = .now
            if step == .code { notice = String(localized: "We've sent you a new code.") }
            code = ""
            step = .code
        } catch {
            shakes += 1
            self.error = error.userMessage
        }
    }

    private func verify(_ value: String) async {
        guard !busy else { return }
        guard value.count == CodeInput.length else {
            error = String(localized: UserFacingError.codeFormat.message); shakes += 1; return
        }
        busy = true; defer { busy = false }
        error = nil; notice = nil
        do {
            // On success the session store routes to the new-password screen.
            try await session.verifyPasswordReset(email: trimmedEmail, code: value)
            Haptics.success()
        } catch {
            code = ""
            shakes += 1
            self.error = error.userMessage
        }
    }
}
