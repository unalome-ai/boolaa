import SwiftUI
import UIKit

/// Boolaa visual language (spec "Visual language").
enum Theme {
    static let brand = Color(hex: 0x9D78BD)
    static let accent = Color(hex: 0x7B61FF)
    static let background = Color(light: Color(hex: 0xFAFAFA), dark: Color(hex: 0x18181B))
    static let card = Color(light: .white, dark: Color(hex: 0x23232B))
    static let chipInactive = Color(light: Color(hex: 0xEEEEEE), dark: Color(hex: 0x23232B))
    static let field = Color(light: Color(hex: 0xF1EEF5), dark: Color(hex: 0x2C2C36))
    static let otherBubble = Color(light: Color(hex: 0xF0ECF5), dark: Color(hex: 0x2C2C36))
    static let cornerRadius: CGFloat = 16
    /// Bottom inset that keeps scroll content clear of the floating tab bar.
    static let tabBarClearance: CGFloat = 170
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: opacity)
    }

    /// A colour that adapts to light and dark mode.
    init(light: Color, dark: Color) {
        self.init(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark ? UIColor(dark) : UIColor(light)
        })
    }
}

/// Rounded card with a soft shadow.
struct CardModifier: ViewModifier {
    var padding: CGFloat = 14
    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous))
            .shadow(color: .black.opacity(0.06), radius: 10, x: 0, y: 3)
    }
}

extension View {
    func card(padding: CGFloat = 14) -> some View { modifier(CardModifier(padding: padding)) }
}

struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 50)
            .background(Theme.brand.opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.45),
                        in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(Theme.brand)
            .frame(maxWidth: .infinity, minHeight: 50)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Theme.brand, lineWidth: 2))
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

/// Text field styling used across forms.
struct BoolaaFieldModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(.horizontal, 14)
            .frame(minHeight: 48)
            .background(Theme.field, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

extension View {
    func boolaaField() -> some View { modifier(BoolaaFieldModifier()) }
}
