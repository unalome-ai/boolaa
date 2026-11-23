import SwiftUI
import UIKit

/// The Soft pop auth look shared by the code, age, password-reset and suspended screens: the floating-bubble
/// backdrop, the logo, a title, and a frosted panel. `calm` drops the motion and the colour for the suspended screen.
struct AuthScaffold<Content: View, Footer: View>: View {
    var title: LocalizedStringResource
    var subtitle: Text?
    var calm = false
    var screenID: String
    @ViewBuilder var content: Content
    @ViewBuilder var footer: Footer

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                BoolaaLogo(size: calm ? 56 : 72, animated: !calm)
                    .popIn(0)
                    .padding(.top, 28)
                VStack(spacing: 8) {
                    Text(title)
                        .font(.rounded(.title2, weight: .heavy))
                        .multilineTextAlignment(.center)
                        .accessibilityAddTraits(.isHeader)
                        .accessibilityIdentifier("auth-screen-title")
                    if let subtitle {
                        subtitle
                            .font(.rounded(.subheadline, weight: .medium))
                            .foregroundStyle(Theme.inkSecondary)
                            .multilineTextAlignment(.center)
                    }
                }
                .padding(.horizontal, 8)
                .popIn(1)

                VStack(spacing: 16) { content }
                    .padding(18)
                    .background(Theme.card.opacity(calm ? 1 : 0.6), in: RoundedRectangle(cornerRadius: Theme.Radius.hero, style: .continuous))
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: Theme.Radius.hero, style: .continuous))
                    .cardChrome(radius: Theme.Radius.hero)
                    .popIn(2)

                footer.popIn(3)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background {
            if calm { Theme.background.ignoresSafeArea() } else { AuthBackdrop() }
        }
        .accessibilityIdentifier(screenID)
    }
}

extension AuthScaffold where Footer == EmptyView {
    init(title: LocalizedStringResource, subtitle: Text? = nil, calm: Bool = false, screenID: String, @ViewBuilder content: () -> Content) {
        self.init(title: title, subtitle: subtitle, calm: calm, screenID: screenID, content: content, footer: { EmptyView() })
    }
}

/// Six boxes that behave as one field. A single (invisible) text field carries the input, so one-time-code
/// autofill (Mail suggests the code above the keyboard), paste and VoiceOver all work on one element.
/// `onComplete` fires once all six digits are in.
struct CodeInput: View {
    @Binding var code: String
    var isInvalid = false
    var isDisabled = false
    var onComplete: (String) -> Void
    @FocusState private var focused: Bool
    @ScaledMetric(relativeTo: .title) private var boxHeight: CGFloat = 58
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    nonisolated static let length = 6

    /// Digits only, at most six (autofill and paste can bring spaces or dashes).
    nonisolated static func sanitize(_ raw: String) -> String {
        String(raw.filter { $0.isASCII && $0.isNumber }.prefix(length))
    }

    var body: some View {
        ZStack {
            HStack(spacing: 8) {
                ForEach(0..<Self.length, id: \.self) { box($0) }
            }
            .accessibilityHidden(true)

            TextField(text: Binding(get: { code }, set: { code = Self.sanitize($0) }), prompt: Text(verbatim: "")) { Text("6-digit code") }
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .focused($focused)
                .foregroundStyle(.clear)
                .tint(.clear)
                .disabled(isDisabled)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityLabel(Text("6-digit code"))
                .accessibilityValue(Text(verbatim: code.map(String.init).joined(separator: " ")))
                .accessibilityIdentifier("code-input")
        }
        .frame(height: min(boxHeight, 86))
        .contentShape(Rectangle())
        .onTapGesture { focused = true }
        .onChange(of: code) { old, new in
            if new.count == Self.length, old != new { onComplete(new) }
        }
        .onChange(of: isDisabled) { _, disabled in if !disabled { focused = true } }
        .task {
            // Let the screen's entrance settle before the keyboard comes up.
            try? await Task.sleep(for: .milliseconds(350))
            if !isDisabled { focused = true }
        }
    }

    private func box(_ index: Int) -> some View {
        let chars = Array(code)
        let digit = index < chars.count ? String(chars[index]) : ""
        let active = focused && index == min(chars.count, Self.length - 1)
        let shape = RoundedRectangle(cornerRadius: Theme.Radius.field, style: .continuous)
        let border: Color = isInvalid ? Theme.danger : active ? Theme.brand : digit.isEmpty ? .clear : Theme.brand.opacity(0.45)
        return Text(verbatim: digit)
            .font(.rounded(.title, weight: .heavy))
            .monospacedDigit()
            .minimumScaleFactor(0.5)
            .lineLimit(1)
            .foregroundStyle(Theme.ink)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(active ? Theme.card : Theme.field, in: shape)
            .overlay(shape.strokeBorder(border, lineWidth: active ? 2 : 1.5))
            .opacity(isDisabled ? 0.6 : 1)
            .animation(Motion.resolve(Motion.snappy, reduceMotion: reduceMotion), value: digit)
            .animation(Motion.fade, value: active)
    }
}

/// "Resend code", disabled with a countdown for 60 s after a send.
struct ResendCodeButton: View {
    var sentAt: Date?
    var busy = false
    var action: () -> Void

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let left = RouteGate.resendSecondsLeft(lastSentAt: sentAt, now: context.date)
            Button(action: action) {
                Group {
                    if left > 0 { Text("Resend code in \(left) s") } else { Text("Resend code") }
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(left > 0 || busy ? Theme.inkSecondary : Theme.brandText)
                .monospacedDigit()
                .frame(minHeight: 44)
            }
            .disabled(left > 0 || busy)
            .accessibilityIdentifier("resend-code")
        }
    }
}

/// Fills the code from the clipboard, without the paste-permission prompt.
struct PasteCodeButton: View {
    @Binding var code: String
    var body: some View {
        PasteButton(payloadType: String.self) { strings in
            let value = CodeInput.sanitize(strings.first ?? "")
            Task { @MainActor in if !value.isEmpty { code = value } }
        }
        .labelStyle(.titleAndIcon)
        .buttonBorderShape(.capsule)
        .tint(Theme.brand)
        .accessibilityIdentifier("paste-code")
    }
}

/// An inline error (danger ink) or notice (mint) under a form; VoiceOver reads it as soon as it appears.
struct FormMessage: View {
    enum Kind { case error, notice }
    var text: String
    var kind: Kind = .error

    var body: some View {
        Label {
            Text(verbatim: text).multilineTextAlignment(.leading)
        } icon: {
            Image(systemName: kind == .error ? "exclamationmark.circle.fill" : "checkmark.circle.fill")
        }
        .font(.footnote.weight(.semibold))
        .foregroundStyle(kind == .error ? Theme.dangerText : Hue.mint.text)
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background((kind == .error ? Theme.danger.opacity(0.1) : Hue.mint.wash),
                    in: RoundedRectangle(cornerRadius: Theme.Radius.field, style: .continuous))
        .accessibilityIdentifier(kind == .error ? "form-error" : "form-notice")
        .onAppear { A11y.announce(text) }
        .onChange(of: text) { _, new in A11y.announce(new) }
        .transition(.opacity)
    }
}

/// Small text link under an auth panel ("Use another account", "Back to sign in").
struct AuthTextLink: View {
    var title: LocalizedStringResource
    var icon: String?
    var id: String
    var hue: Hue = .grape
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Label {
                Text(title)
            } icon: {
                if let icon { Image(systemName: icon) }
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(hue.text)
            .frame(minHeight: 44)
        }
        .accessibilityIdentifier(id)
    }
}

/// Horizontal shake on `trigger` changes (a wrong code, a failed submit). Still under Reduce Motion.
struct ShakeModifier: ViewModifier {
    var trigger: Int
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        let reduce = reduceMotion
        content.keyframeAnimator(initialValue: 0.0, trigger: trigger) { view, x in
            view.offset(x: reduce ? 0 : x)
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
}

extension View {
    func shake(_ trigger: Int) -> some View { modifier(ShakeModifier(trigger: trigger)) }
}

/// Haptics that must fire even if the screen is about to be replaced (success right before a route change).
@MainActor
enum Haptics {
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
}
