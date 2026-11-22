import SwiftUI
import UIKit

// Boolaa design system tokens. The platform-neutral source of truth is docs/design-system.md;
// keep the two in step.

/// One colour family: a vivid fill, the content colour that sits on it, an adaptive text shade and a soft wash.
struct Hue: Hashable, Sendable {
    let name: String
    /// Vivid fill, the same in light and dark mode.
    let fill: Color
    /// Lighter companion of `fill`, used for gradients and glossy highlights.
    let glow: Color
    /// Darker companion of `fill`, used for the bottom of gradients under white content.
    let deep: Color
    /// Text and icons placed on `fill` (AA 4.5:1): white on grape and indigo, ink on the bright hues.
    let onFill: Color
    /// Text in this hue on backgrounds, cards and washes (AA 4.5:1 in both modes).
    let text: Color

    /// Soft tinted surface for badges and chips.
    var wash: Color { Color(light: fill.opacity(0.14), dark: fill.opacity(0.24)) }

    /// Top-to-bottom fill gradient that keeps `onFill` readable across its whole height.
    var gradient: LinearGradient {
        let light = onFill == .white
        return LinearGradient(colors: light ? [fill, deep] : [glow, fill], startPoint: .top, endPoint: .bottom)
    }

    private init(_ name: String, fill: UInt32, glow: UInt32, deep: UInt32, whiteOnFill: Bool, textLight: UInt32, textDark: UInt32) {
        self.name = name
        self.fill = Color(hex: fill)
        self.glow = Color(hex: glow)
        self.deep = Color(hex: deep)
        self.onFill = whiteOnFill ? .white : Theme.inkOnColor
        self.text = Color(light: Color(hex: textLight), dark: Color(hex: textDark))
    }

    static let grape = Hue("grape", fill: 0x7357F6, glow: 0x9B86FF, deep: 0x5B3FD9, whiteOnFill: true, textLight: 0x5B3FD9, textDark: 0xB7A6FF)
    static let coral = Hue("coral", fill: 0xFF6B5C, glow: 0xFF9A82, deep: 0xE8503F, whiteOnFill: false, textLight: 0xC0392B, textDark: 0xFF9A8F)
    static let mint = Hue("mint", fill: 0x1EC8A0, glow: 0x6BE6C6, deep: 0x12A683, whiteOnFill: false, textLight: 0x0B7A60, textDark: 0x5FE3C2)
    static let sunny = Hue("sunny", fill: 0xFFC93C, glow: 0xFFE07A, deep: 0xF2B21B, whiteOnFill: false, textLight: 0x8A6400, textDark: 0xFFD466)
    static let sky = Hue("sky", fill: 0x3AA8FF, glow: 0x7CC9FF, deep: 0x1F8DE6, whiteOnFill: false, textLight: 0x0B6BBF, textDark: 0x7CC6FF)
    static let pink = Hue("pink", fill: 0xF0569F, glow: 0xFF8CC0, deep: 0xD63D86, whiteOnFill: false, textLight: 0xB8246F, textDark: 0xFF9CCB)
    static let tangerine = Hue("tangerine", fill: 0xFF9A2E, glow: 0xFFBE5C, deep: 0xF07F0C, whiteOnFill: false, textLight: 0xA85800, textDark: 0xFFB866)
    static let indigo = Hue("indigo", fill: 0x5468F0, glow: 0x8795FF, deep: 0x3F50D0, whiteOnFill: true, textLight: 0x3F50D0, textDark: 0xA3AEFF)

    /// Bubble colours, in the order the deterministic picker indexes them.
    static let bubblePalette: [Hue] = [.grape, .coral, .mint, .sky, .sunny, .pink, .tangerine, .indigo]

    /// The colour of a bubble (or a person), from its id. Android and web use the same function
    /// so a bubble has the same colour everywhere.
    static func forID(_ id: UUID?) -> Hue {
        guard let id else { return .grape }
        return forSeed(id.uuidString.lowercased())
    }

    /// FNV-1a 32-bit over the UTF-8 bytes, upper half folded into the lower (h ^ h >> 16), modulo the palette size.
    static func forSeed(_ seed: String) -> Hue {
        let hash = fnv1a(seed)
        return bubblePalette[Int((hash ^ (hash >> 16)) % UInt32(bubblePalette.count))]
    }

    static func fnv1a(_ string: String) -> UInt32 {
        var hash: UInt32 = 2_166_136_261
        for byte in string.utf8 {
            hash ^= UInt32(byte)
            hash = hash &* 16_777_619
        }
        return hash
    }
}

/// The five features, each with its own colour and symbol.
enum Feature: Sendable {
    case chat, events, food, market, links

    var hue: Hue {
        switch self {
        case .chat: .grape
        case .events: .coral
        case .food: .tangerine
        case .market: .mint
        case .links: .sky
        }
    }

    var icon: String {
        switch self {
        case .chat: "bubble.left.and.bubble.right.fill"
        case .events: "calendar"
        case .food: "fork.knife"
        case .market: "tag.fill"
        case .links: "link"
        }
    }
}

enum Theme {
    // Brand
    static let brandHue = Hue.grape
    /// Brand purple for fills (white text on it passes AA).
    static let brand = Hue.grape.fill
    /// Brand purple for text and icons on surfaces.
    static let brandText = Hue.grape.text
    static let accent = Hue.indigo.fill

    // Surfaces
    static let background = Color(light: Color(hex: 0xFBF8FF), dark: Color(hex: 0x15111F))
    static let card = Color(light: .white, dark: Color(hex: 0x221C33))
    static let field = Color(light: Color(hex: 0xF1ECFB), dark: Color(hex: 0x2C2545))
    static let chipInactive = field
    static let otherBubble = Color(light: .white, dark: Color(hex: 0x2C2545))
    static let hairline = Color(light: Color(hex: 0x2A1B5E, opacity: 0.08), dark: Color.white.opacity(0.08))

    // Text
    /// Dark ink used on bright fills in both modes.
    static let inkOnColor = Color(hex: 0x1E1638)
    static let ink = Color(light: Color(hex: 0x1E1638), dark: Color(hex: 0xF5F2FF))
    static let inkSecondary = Color(light: Color(hex: 0x6A6382), dark: Color(hex: 0xABA4C4))
    /// Calm red for destructive actions (white text on it passes AA).
    static let danger = Color(hex: 0xD92D3A)
    static let dangerText = Color(light: Color(hex: 0xD92D3A), dark: Color(hex: 0xFF8A8F))

    // Shape
    enum Radius {
        static let small: CGFloat = 12   // thumbnails, icon badges
        static let field: CGFloat = 16   // inputs, calm buttons
        static let card: CGFloat = 24    // cards
        static let hero: CGFloat = 32    // hero cards, sheets, auth panel
    }
    static let cornerRadius = Radius.card

    // Spacing scale: 4 · 8 · 12 · 16 · 20 · 24 · 32 · 48
    enum Space {
        static let xxs: CGFloat = 4
        static let xs: CGFloat = 8
        static let s: CGFloat = 12
        static let m: CGFloat = 16
        static let l: CGFloat = 20
        static let xl: CGFloat = 24
        static let xxl: CGFloat = 32
        static let xxxl: CGFloat = 48
    }

    /// Bottom inset that keeps scroll content clear of the floating dock.
    static let tabBarClearance: CGFloat = 112
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

extension Font {
    /// SF Pro Rounded at a Dynamic Type text style: titles, buttons, chips, numbers.
    static func rounded(_ style: Font.TextStyle, weight: Font.Weight = .bold) -> Font {
        .system(style, design: .rounded, weight: weight)
    }
}

// MARK: - Motion

/// Motion tokens (design-system.md "Motion").
enum Motion {
    /// Press and release of anything tappable.
    static let press = Animation.spring(response: 0.25, dampingFraction: 0.6)
    /// Selection changes: tabs, chips, segmented pills.
    static let snappy = Animation.spring(response: 0.32, dampingFraction: 0.78)
    /// Things that pop into existence: messages, badges, staggered cards.
    static let bouncy = Animation.spring(response: 0.45, dampingFraction: 0.62)
    /// Layout and screen changes.
    static let gentle = Animation.spring(response: 0.55, dampingFraction: 0.86)
    /// Reduced-motion replacement for every spring.
    static let fade = Animation.easeOut(duration: 0.2)
    /// Delay between staggered siblings; only the first `staggerLimit` are delayed.
    static let stagger: Double = 0.045
    static let staggerLimit = 8

    static func resolve(_ animation: Animation, reduceMotion: Bool) -> Animation { reduceMotion ? fade : animation }
}

/// Press "squish": scales down with a springy release. Falls back to a dim under Reduce Motion.
struct SquishButtonStyle: ButtonStyle {
    var scale: CGFloat = 0.96
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? scale : 1)
            .opacity(configuration.isPressed && reduceMotion ? 0.7 : 1)
            .animation(Motion.resolve(Motion.press, reduceMotion: reduceMotion), value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == SquishButtonStyle {
    /// Cards and rows.
    static var squish: SquishButtonStyle { SquishButtonStyle() }
    /// Small round icon buttons.
    static var squishIcon: SquishButtonStyle { SquishButtonStyle(scale: 0.88) }
}

// MARK: - Surfaces

/// Rounded card: soft tinted shadow in light mode, a hairline edge in dark mode.
struct CardModifier: ViewModifier {
    var padding: CGFloat = 16
    var radius: CGFloat = Theme.Radius.card
    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .cardChrome(radius: radius)
    }
}

extension View {
    func card(padding: CGFloat = 16) -> some View { modifier(CardModifier(padding: padding)) }

    /// Elevation 1: the edge and shadow of a card, for views that draw their own background.
    func cardChrome(radius: CGFloat = Theme.Radius.card) -> some View {
        overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
            .shadow(color: Color(light: Color(hex: 0x2A1B5E, opacity: 0.08), dark: .black.opacity(0.28)), radius: 16, x: 0, y: 8)
    }

    /// Elevation 2: floating controls (dock, chat button).
    func floatingShadow(_ tint: Color = Color(hex: 0x2A1B5E)) -> some View {
        shadow(color: Color(light: tint.opacity(0.22), dark: .black.opacity(0.45)), radius: 18, x: 0, y: 10)
    }
}

// MARK: - Buttons

/// Full-width pill. Playful by default (gradient, glow, squish); `calm` is flat and still for safety flows.
struct PrimaryButtonStyle: ButtonStyle {
    var hue: Hue = .grape
    var calm = false
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        let shape = RoundedRectangle(cornerRadius: calm ? Theme.Radius.field : 27, style: .continuous)
        configuration.label
            .font(.rounded(.headline))
            .foregroundStyle(hue.onFill.opacity(isEnabled ? 1 : 0.85))
            .tint(hue.onFill)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 20)
            .frame(maxWidth: .infinity, minHeight: 54)
            .background {
                if !isEnabled {
                    shape.fill(hue.fill.opacity(0.38))
                } else if calm {
                    shape.fill(hue.fill)
                } else {
                    shape.fill(hue.gradient)
                        .overlay(shape.strokeBorder(.white.opacity(0.22), lineWidth: 1))
                        .shadow(color: hue.fill.opacity(configuration.isPressed ? 0.15 : 0.38), radius: configuration.isPressed ? 6 : 14, y: configuration.isPressed ? 3 : 8)
                }
            }
            .scaleEffect(configuration.isPressed && !reduceMotion && !calm ? 0.96 : 1)
            .opacity(configuration.isPressed && (reduceMotion || calm) ? 0.8 : 1)
            .animation(Motion.resolve(Motion.press, reduceMotion: reduceMotion || calm), value: configuration.isPressed)
            .animation(Motion.fade, value: isEnabled)
    }
}

/// Full-width pill with a soft wash instead of a fill.
struct SecondaryButtonStyle: ButtonStyle {
    var hue: Hue = .grape
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.rounded(.headline))
            .foregroundStyle(hue.text)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 20)
            .frame(maxWidth: .infinity, minHeight: 54)
            .background(hue.wash, in: RoundedRectangle(cornerRadius: 27, style: .continuous))
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.96 : 1)
            .opacity(configuration.isPressed && reduceMotion ? 0.7 : 1)
            .animation(Motion.resolve(Motion.press, reduceMotion: reduceMotion), value: configuration.isPressed)
    }
}

// MARK: - Inputs

/// Text field styling used across forms: soft fill, and a brand ring while focused.
struct BoolaaFieldModifier: ViewModifier {
    @FocusState private var focused: Bool
    func body(content: Content) -> some View {
        content
            .focused($focused)
            .padding(.horizontal, 16)
            .frame(minHeight: 52)
            .background(Theme.field, in: RoundedRectangle(cornerRadius: Theme.Radius.field, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.field, style: .continuous)
                .strokeBorder(Theme.brand, lineWidth: 2)
                .opacity(focused ? 1 : 0))
            .animation(Motion.fade, value: focused)
    }
}

extension View {
    func boolaaField() -> some View { modifier(BoolaaFieldModifier()) }
}
