import AuthenticationServices
import CryptoKit
import GoogleSignIn
import SwiftUI
import UIKit

/// Nonces for id_token sign-in: the provider signs sha256(raw) into the token, Supabase checks it against raw.
enum OAuthNonce {
    static func random() -> String {
        DeviceIdentity.generateID()
    }

    static func sha256(_ raw: String) -> String {
        DeviceIdentity.sha256Hex(raw)
    }
}

/// "Continue with Apple" and "Continue with Google" (docs/auth-security.md §7), native id_token flows.
/// Branding: Apple's own button (black in light mode, white in dark), and Google's white button with the
/// unaltered "G" (dark: #131314 fill, #8E918F stroke), same height and shape so neither dominates.
struct SocialSignInButtons: View {
    @Environment(SessionStore.self) private var session
    @Environment(\.colorScheme) private var colorScheme
    @Binding var error: String?
    @State private var appleNonce: String?
    @State private var busy = false

    var body: some View {
        VStack(spacing: 12) {
            SignInWithAppleButton(.continue) { request in
                let raw = OAuthNonce.random()
                appleNonce = raw
                request.requestedScopes = [.fullName, .email]
                request.nonce = OAuthNonce.sha256(raw)
            } onCompletion: { result in
                Task { await completeApple(result) }
            }
            .signInWithAppleButtonStyle(colorScheme == .dark ? .white : .black)
            .frame(height: 52)
            .clipShape(Capsule())
            .disabled(busy)
            .accessibilityIdentifier("oauth-apple")

            Button {
                Task { await signInWithGoogle() }
            } label: {
                HStack(spacing: 12) {
                    Image("GoogleG").resizable().frame(width: 20, height: 20).accessibilityHidden(true)
                    Text("Continue with Google").font(.system(.body, weight: .medium)).lineLimit(2).minimumScaleFactor(0.8)
                }
                .foregroundStyle(colorScheme == .dark ? Color(hex: 0xE3E3E3) : Color(hex: 0x1F1F1F))
                .frame(maxWidth: .infinity, minHeight: 52)
                .background(colorScheme == .dark ? Color(hex: 0x131314) : .white, in: Capsule())
                .overlay(Capsule().strokeBorder(colorScheme == .dark ? Color(hex: 0x8E918F) : Color(hex: 0x747775), lineWidth: 1))
                .contentShape(Capsule())
            }
            .buttonStyle(.squish)
            .disabled(busy)
            .accessibilityIdentifier("oauth-google")
        }
        .overlay { if busy { ProgressView().controlSize(.large) } }
    }

    private func completeApple(_ result: Result<ASAuthorization, any Error>) async {
        switch result {
        case .failure(let failure):
            if (failure as? ASAuthorizationError)?.code == .canceled { return }
            error = String(localized: UserFacingError.oauthFailed.message)
        case .success(let authorization):
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let tokenData = credential.identityToken, let idToken = String(data: tokenData, encoding: .utf8),
                  let nonce = appleNonce else {
                error = String(localized: UserFacingError.oauthFailed.message)
                return
            }
            // Apple sends the name only on the first authorization.
            let name = credential.fullName.map { PersonNameComponentsFormatter.localizedString(from: $0, style: .default) }
            busy = true; defer { busy = false }
            do {
                try await session.signInWithApple(idToken: idToken, rawNonce: nonce, fullName: name)
            } catch {
                self.error = Self.message(for: error)
            }
        }
    }

    private func signInWithGoogle() async {
        guard let presenter = UIApplication.shared.topViewController else { return }
        busy = true; defer { busy = false }
        let raw = OAuthNonce.random()
        do {
            let result = try await GIDSignIn.sharedInstance.signIn(
                withPresenting: presenter, hint: nil, additionalScopes: nil, nonce: OAuthNonce.sha256(raw))
            guard let idToken = result.user.idToken?.tokenString else {
                error = String(localized: UserFacingError.oauthFailed.message)
                return
            }
            try await session.signInWithGoogle(idToken: idToken, accessToken: result.user.accessToken.tokenString, rawNonce: raw)
        } catch {
            let ns = error as NSError
            if ns.domain == kGIDSignInErrorDomain, ns.code == GIDSignInError.canceled.rawValue { return }
            self.error = Self.message(for: error)
        }
    }

    /// Provider failures read as "Couldn't sign you in with that account"; network and ban keep their own text.
    private static func message(for error: any Error) -> String {
        switch UserFacingError.classify(error) {
        case .network, .userBanned: error.userMessage
        default: String(localized: UserFacingError.oauthFailed.message)
        }
    }
}

/// "or" rule between the provider buttons and the email form.
struct OrDivider: View {
    var body: some View {
        HStack(spacing: 12) {
            Rectangle().fill(Theme.hairline).frame(height: 1)
            Text("or", comment: "Between Continue with Apple/Google and the email form")
                .font(.rounded(.caption, weight: .bold))
                .textCase(.uppercase)
                .foregroundStyle(Theme.inkSecondary)
            Rectangle().fill(Theme.hairline).frame(height: 1)
        }
        .accessibilityHidden(true)
    }
}

extension UIApplication {
    /// The view controller to present Google's sign-in sheet from.
    var topViewController: UIViewController? {
        let scene = connectedScenes.compactMap { $0 as? UIWindowScene }.first { $0.activationState == .foregroundActive }
            ?? connectedScenes.compactMap { $0 as? UIWindowScene }.first
        var top = scene?.keyWindow?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }
}
