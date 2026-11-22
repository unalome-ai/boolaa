import SwiftUI

/// Permanent account deletion (App Store guideline 5.1.1(v), docs/auth-security.md §2 "Flow: delete account"):
/// warning + typed confirmation word, then an emailed `delete_account` code (always, even before enforcement),
/// then the user's files, `delete_my_account()` in the same session, and a local sign-out.
struct DeleteAccountSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(SessionStore.self) private var session
    @State private var typed = ""
    @State private var busy = false
    @State private var error: String?
    @State private var step: Step = .warn
    @State private var code = ""
    @State private var sentAt: Date?
    @State private var shakes = 0

    private enum Step { case warn, code }
    /// Callback for the sheet that presented us (the profile sheet closes too).
    var onDeleted: () -> Void = {}

    /// The word to type, in the app's language.
    nonisolated static var confirmWord: String { String(localized: "DELETE", comment: "Word the user types to confirm deleting their account; keep it short and in capitals") }

    nonisolated static func matches(_ input: String, word: String = confirmWord) -> Bool {
        input.trimmingCharacters(in: .whitespacesAndNewlines)
            .compare(word, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 44)).foregroundStyle(Theme.dangerText)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 12)
                    Text("Delete your account?").font(.rounded(.title2)).frame(maxWidth: .infinity)
                        .multilineTextAlignment(.center)
                    Text("This can't be undone. Your profile, photos, messages, events, food posts, items and links will be permanently deleted, and you'll leave all your bubbles.")
                        .foregroundStyle(.secondary)
                    Text("Bubbles you own pass to the longest-standing member. Bubbles with no one left are deleted.")
                        .font(.subheadline).foregroundStyle(.secondary)
                    if step == .warn {
                        Text("To confirm, type \(Self.confirmWord) below.", comment: "The argument is the confirmation word, e.g. DELETE")
                            .font(.subheadline.weight(.semibold))
                            .padding(.top, 4)
                        TextField(Self.confirmWord, text: $typed)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                            .boolaaField()
                            .accessibilityIdentifier("delete-confirm-field")
                        Text("To make sure it's you, we'll email you a 6-digit code first.")
                            .font(.subheadline).foregroundStyle(.secondary)
                        if let error { FormMessage(text: error) }
                        Button(role: .destructive) {
                            Task { await sendCode() }
                        } label: {
                            if busy { ProgressView() } else { Text("Delete account permanently") }
                        }
                        .buttonStyle(DestructiveButtonStyle())
                        .disabled(!Self.matches(typed) || busy)
                        .accessibilityIdentifier("delete-account-confirm")
                    } else {
                        Text("Enter the 6-digit code we just emailed you. Your account will be deleted right after.")
                            .font(.subheadline.weight(.semibold))
                            .padding(.top, 4)
                            .accessibilityIdentifier("delete-code-sent")
                        CodeInput(code: $code, isInvalid: error != nil, isDisabled: busy) { value in Task { await verifyAndDelete(value) } }
                            .shake(shakes)
                        if let error { FormMessage(text: error) }
                        ResendCodeButton(sentAt: sentAt, busy: busy) { Task { await sendCode() } }
                        Button(role: .destructive) {
                            Task { await verifyAndDelete(code) }
                        } label: {
                            if busy { ProgressView() } else { Text("Delete my account") }
                        }
                        .buttonStyle(DestructiveButtonStyle())
                        .disabled(code.count != CodeInput.length || busy)
                        .accessibilityIdentifier("delete-final")
                    }
                }
                .padding(20)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Delete account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(busy) } }
            .interactiveDismissDisabled(busy)
            .sensoryFeedback(.error, trigger: shakes)
        }
    }

    private func sendCode() async {
        busy = true; defer { busy = false }
        error = nil
        do {
            try await session.sendSensitiveActionCode(.deleteAccount)
            sentAt = .now; code = ""; step = .code
        } catch { shakes += 1; self.error = error.userMessage }
    }

    private func verifyAndDelete(_ value: String) async {
        guard !busy else { return }
        busy = true; defer { busy = false }
        error = nil
        do {
            try await session.verifySensitiveActionCode(value)
        } catch {
            code = ""; shakes += 1; self.error = error.userMessage
            return
        }
        do {
            try await session.deleteAccount()
            onDeleted()
        } catch { shakes += 1; self.error = error.userMessage }
    }
}

/// Full-width red button for irreversible actions. Calm on purpose: flat, no bounce, no glow.
struct DestructiveButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        let shape = RoundedRectangle(cornerRadius: Theme.Radius.field, style: .continuous)
        configuration.label
            .font(.rounded(.headline))
            .foregroundStyle(Color.white.opacity(isEnabled ? 1 : 0.85))
            .tint(.white)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 20)
            .frame(maxWidth: .infinity, minHeight: 54)
            .background(Theme.danger.opacity(isEnabled ? 1 : 0.35), in: shape)
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}
