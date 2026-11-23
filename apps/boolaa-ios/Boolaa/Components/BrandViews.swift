import SwiftUI

// The brand redesign's building blocks (docs/design-system.md §8): the feature band behind headers, display
// titles, sticker labels, the mascot, the cheer toast and the calm marker for safety surfaces.

// MARK: - Calm (safety surfaces)

extension EnvironmentValues {
    /// Safety surfaces (report, block / blocked users, delete account, suspended, safety confirmations) are calm:
    /// the mascot refuses to draw inside them and they keep the plain system symbol of §6.9.
    @Entry var calm: Bool = false
}

extension View {
    /// Marks a safety surface: no mascot inside it (§8.4).
    func calmSurface() -> some View { environment(\.calm, true) }
}

// MARK: - Feature band (§8.1)

/// The header band: the screen's hue at 28 % (light) / 22 % (dark) over the background with three decorative
/// circles, opaque over the top 45 % and fading to transparent at the bottom. The tint cross-fades in 400 ms
/// (200 ms under Reduce Motion) when the tab or bubble changes. Decorative.
struct FeatureBand: View {
    var hue: Hue
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let dark = colorScheme == .dark
        let circle = dark ? Theme.background.opacity(Theme.Brand.bandCircleDark) : Color.white.opacity(Theme.Brand.bandCircleLight)
        GeometryReader { geo in
            let w = geo.size.width
            ZStack(alignment: .topLeading) {
                Rectangle().fill(hue.fill.opacity(dark ? Theme.Brand.bandDark : Theme.Brand.bandLight))
                    .animation(.easeOut(duration: reduceMotion ? 0.2 : Theme.Brand.bandFade), value: hue)
                // Ø 220, right edge −70, top −110 (mostly off-screen).
                Circle().fill(circle).frame(width: 220, height: 220).position(x: w + 70 - 110, y: -110 + 110)
                // Ø 110, right 26 % of the width, top −62.
                Circle().fill(circle).frame(width: 110, height: 110).position(x: w * 0.74 - 55, y: -62 + 55)
                // Ring Ø 30, 2 px, right 38 %, top 22.
                Circle().strokeBorder(circle, lineWidth: 2).frame(width: 30, height: 30).position(x: w * 0.62 - 15, y: 22 + 15)
            }
            .frame(width: w, height: geo.size.height)
            .clipped()
            .mask(LinearGradient(stops: [.init(color: .black, location: 0),
                                         .init(color: .black, location: Theme.Brand.bandFadeStart),
                                         .init(color: .clear, location: 1)],
                                 startPoint: .top, endPoint: .bottom))
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

// MARK: - Display type (§8.5)

/// Screen title: SF Pro Rounded black, 38 pt (32 on pushed screens) scaled with Dynamic Type, tracking −0.95,
/// up to two lines, shrinking to 68 % before it would truncate. `gradient` is for the Home title only.
struct DisplayTitle: View {
    var title: LocalizedStringResource
    var pushed = false
    var gradient = false
    @ScaledMetric(relativeTo: .largeTitle) private var tabSize: CGFloat = 38
    @ScaledMetric(relativeTo: .largeTitle) private var pushedSize: CGFloat = 32
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        Text(title)
            .font(.system(size: pushed ? pushedSize : tabSize, weight: .black, design: .rounded))
            .tracking(-0.95)
            .lineLimit(2)
            .minimumScaleFactor(0.68)
            .foregroundStyle(titleStyle)
    }

    private var titleStyle: AnyShapeStyle {
        // Increased contrast replaces the gradient with the plain text colour.
        guard gradient, contrast != .increased else { return AnyShapeStyle(Theme.ink) }
        return AnyShapeStyle(LinearGradient(gradient: Theme.Brand.titleGradient,
                                            startPoint: Theme.Brand.titleGradientStart, endPoint: Theme.Brand.titleGradientEnd))
    }
}

/// Sticker "kind" label on the Home feed (§8.5): display 12 black uppercase on the feature gradient, a white
/// die-cut edge, a soft shadow in the hue and a fixed tilt (none at the accessibility sizes).
struct StickerLabel: View {
    var text: LocalizedStringResource
    var kind: StickerKind
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .caption) private var size: CGFloat = 12

    var body: some View {
        let hue = kind.feature.hue
        Text(text)
            .font(.system(size: size, weight: .black, design: .rounded))
            .tracking(size * 0.06)
            .textCase(.uppercase)
            .lineLimit(1)
            .foregroundStyle(hue.onFill)
            .padding(.horizontal, 8).padding(.vertical, 2)
            .frame(minHeight: 22)
            .background(Capsule().fill(hue.gradient))
            .overlay(Capsule().strokeBorder(Theme.Brand.stickerEdge, lineWidth: 2).padding(-2))
            .shadow(color: hue.fill.opacity(0.45), radius: 4, y: 3)
            .padding(2)
            .rotationEffect(.degrees(kind.tilt(accessibilitySize: typeSize.isAccessibilitySize)))
    }
}

// MARK: - Mascot (§8.4)

/// The empty-state cluster whose main orb has a face. Drawn in code (orbs + a Canvas face on a 100-unit box),
/// decorative (hidden from VoiceOver), still under Reduce Motion, and never drawn on a calm (safety) surface.
struct Mascot: View {
    var expression: MascotExpression
    var hue: Hue
    var size: CGFloat = 96
    var companions = true
    @Environment(\.calm) private var calm
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var start = Date.now

    static func companions(for hue: Hue) -> (Hue, Hue) {
        switch hue {
        case .coral: (.sunny, .grape)
        case .tangerine: (.coral, .mint)
        case .mint: (.sky, .sunny)
        case .sky: (.mint, .pink)
        default: (.coral, .mint)
        }
    }

    var body: some View {
        if calm {
            EmptyView()
        } else {
            Group {
                if reduceMotion {
                    cluster(time: 0, still: true)
                } else {
                    TimelineView(.animation(minimumInterval: 1.0 / 60.0)) { timeline in
                        cluster(time: timeline.date.timeIntervalSince(start), still: false)
                    }
                }
            }
            .frame(width: size, height: size)
            .accessibilityHidden(true)
            .accessibilityIdentifier("mascot-\(expression.rawValue)")
        }
    }

    private func cluster(time t: Double, still: Bool) -> some View {
        let main = size * (companions ? 0.8 : 1)
        let pair = Self.companions(for: hue)
        let bob: (Double, Double) -> CGFloat = { amp, period in still ? 0 : CGFloat(sin(t / period * 2 * .pi) * amp) }
        var faceOffset: CGFloat = 0
        var scale: CGFloat = 1
        switch expression {
        case .curious, .worried: faceOffset = bob(4, 5.2)
        case .sleepy: scale = still ? 1 : CGFloat(1 + 0.015 * (1 - cos(t / 4.8 * 2 * .pi)))
        case .cheering:
            // Hop: up 8 % of the orb and back, 600 ms, three times, then rest.
            if !still && t < 1.8 {
                let f = (t.truncatingRemainder(dividingBy: 0.6)) / 0.6
                faceOffset = -main * 0.08 * CGFloat(sin(f * .pi))
            }
        }
        return ZStack(alignment: .topLeading) {
            ZStack {
                BubbleOrb(hue: hue)
                MascotFace(expression: expression, hue: hue, eyeOpen: still ? 1 : Self.eyeOpenness(t))
            }
            .frame(width: main, height: main)
            .scaleEffect(scale)
            .offset(x: companions ? size * 0.1 : 0, y: (companions ? size * 0.1 : 0) + faceOffset)
            if companions {
                BubbleOrb(hue: pair.0).frame(width: size * 0.34, height: size * 0.34)
                    .offset(x: size - size * 0.34 + size * 0.06, y: -size * 0.02 + bob(5, 3.8))
                BubbleOrb(hue: pair.1).frame(width: size * 0.24, height: size * 0.24)
                    .offset(x: 0, y: size - size * 0.24 - size * 0.02 + bob(3, 4.6))
            }
        }
        .frame(width: size, height: size, alignment: .topLeading)
    }

    /// Blink: closed (10 %) at 96 % of a 4.2 s loop, closing 94 → 96 %, opening 96 → 98 %.
    static func eyeOpenness(_ t: Double) -> CGFloat {
        let p = (t / 4.2).truncatingRemainder(dividingBy: 1)
        if p >= 0.94 && p < 0.96 { return CGFloat(1 - 0.9 * (p - 0.94) / 0.02) }
        if p >= 0.96 && p < 0.98 { return CGFloat(0.1 + 0.9 * (p - 0.96) / 0.02) }
        return 1
    }
}

/// The face on a 100 × 100 box laid over the orb (§8.4 table).
private struct MascotFace: View {
    var expression: MascotExpression
    var hue: Hue
    var eyeOpen: CGFloat

    var body: some View {
        Canvas { context, size in
            let k = size.width / 100
            let white = MascotExpression.faceIsWhite(hue)
            let ink: Color = white ? .white : Theme.inkOnColor
            let shine: Color = white ? hue.deep : .white
            func p(_ x: Double, _ y: Double) -> CGPoint { CGPoint(x: x * k, y: y * k) }
            func ellipse(_ cx: Double, _ cy: Double, _ rx: Double, _ ry: Double) -> Path {
                Path(ellipseIn: CGRect(x: (cx - rx) * k, y: (cy - ry) * k, width: 2 * rx * k, height: 2 * ry * k))
            }
            func arc(_ from: (Double, Double), _ control: (Double, Double), _ to: (Double, Double)) -> Path {
                var path = Path()
                path.move(to: p(from.0, from.1))
                path.addQuadCurve(to: p(to.0, to.1), control: p(control.0, control.1))
                return path
            }
            func stroke(_ path: Path, _ width: Double) {
                context.stroke(path, with: .color(ink), style: StrokeStyle(lineWidth: width * k, lineCap: .round, lineJoin: .round))
            }
            func openEyes(y: Double, rx: Double, ry: Double) {
                for x in [35.0, 65.0] {
                    var eye = context
                    // Blink: scale vertically around the eye's own centre.
                    eye.translateBy(x: x * k, y: y * k)
                    eye.scaleBy(x: 1, y: eyeOpen)
                    eye.translateBy(x: -x * k, y: -y * k)
                    eye.fill(ellipse(x, y, rx, ry), with: .color(ink))
                    eye.fill(ellipse(x + 1.6, y - 2.4, 2, 2), with: .color(shine))
                }
            }
            let cheek = Theme.Brand.mascotCheek.opacity(expression == .cheering ? 0.65 : 0.45)
            context.fill(ellipse(25, 64, 6, 3.5), with: .color(cheek))
            context.fill(ellipse(75, 64, 6, 3.5), with: .color(cheek))
            switch expression {
            case .curious:
                openEyes(y: 52, rx: 5.8, ry: 7.6)
                context.fill(ellipse(50, 69, 4.4, 5), with: .color(ink))
            case .sleepy:
                stroke(arc((29, 54), (35, 59), (41, 54)), 3.2)
                stroke(arc((59, 54), (65, 59), (71, 54)), 3.2)
                context.fill(ellipse(50, 70, 3, 2.2), with: .color(ink))
                context.fill(ellipse(80, 28, 3, 3), with: .color(.white.opacity(0.7)))
                context.fill(ellipse(87, 18, 2, 2), with: .color(.white.opacity(0.55)))
            case .cheering:
                stroke(arc((29, 56), (35, 48), (41, 56)), 3.2)
                stroke(arc((59, 56), (65, 48), (71, 56)), 3.2)
                var mouth = arc((38, 64), (50, 82), (62, 64))
                mouth.closeSubpath()
                context.fill(mouth, with: .color(ink))
                stroke(mouth, 2)
                context.fill(ellipse(50, 72.5, 5, 2.6), with: .color(Theme.Brand.mascotTongue))
            case .worried:
                var brows = Path()
                brows.move(to: p(28, 45)); brows.addLine(to: p(40, 40))
                brows.move(to: p(60, 40)); brows.addLine(to: p(72, 45))
                stroke(brows, 2.6)
                openEyes(y: 55, rx: 4.6, ry: 6)
                stroke(arc((42, 72), (50, 65), (58, 72)), 3.2)
            }
        }
        .allowsHitTesting(false)
    }
}

// MARK: - Cheer toast (§8.4)

/// Success moments with the cheering mascot: RSVP confirmed, your first event / post / item, admitted to a bubble.
@MainActor
@Observable
final class CheerCenter {
    static let shared = CheerCenter()

    struct Cheer: Equatable, Identifiable {
        let id = UUID()
        let text: String
        let hue: Hue
    }

    private(set) var current: Cheer?

    /// Shows the toast for 2.8 s, announces it politely and plays the success haptic.
    func show(_ text: String, hue: Hue) {
        let cheer = Cheer(text: text, hue: hue)
        current = cheer
        A11y.announce(text)
        Interaction.success.play()
        Task {
            try? await Task.sleep(for: .seconds(Theme.Brand.cheerSeconds))
            if current?.id == cheer.id { current = nil }
        }
    }

    // Glossary keys `cheer.*` (docs/i18n-glossary.md, "Brand redesign").
    static var going: String { String(localized: "You're going!", comment: "Cheer toast when an RSVP is confirmed") }
    static var firstEvent: String { String(localized: "Your first event is up!", comment: "Cheer toast after saving your first upcoming event in this bubble") }
    static var firstPost: String { String(localized: "First post shared!", comment: "Cheer toast after your first food post in this bubble") }
    static var firstItem: String { String(localized: "First item listed!", comment: "Cheer toast after your first marketplace item in this bubble") }
    static func joined(_ bubble: String) -> String {
        String(localized: "You're in. Say hi to \(bubble)!", comment: "Cheer toast on Home after being admitted to a bubble; the argument is the bubble name")
    }
}

/// The toast: a card pill 96 above the bottom safe area with the cheering mascot (40, no companions) and the
/// text. Pops in (fades under Reduce Motion), never takes focus and never blocks taps.
struct CheerHost: View {
    @State private var center = CheerCenter.shared
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack {
            Spacer()
            if let cheer = center.current {
                HStack(spacing: 10) {
                    Mascot(expression: .cheering, hue: cheer.hue, size: 40, companions: false)
                    Text(verbatim: cheer.text)
                        .font(.system(size: 15, weight: .heavy, design: .rounded))
                        .foregroundStyle(Theme.ink)
                        .multilineTextAlignment(.leading)
                }
                .padding(.leading, 6).padding(.trailing, 20).padding(.vertical, 6)
                .background(Capsule().fill(Theme.card))
                .overlay(Capsule().strokeBorder(Theme.hairline, lineWidth: 1))
                .floatingShadow()
                .padding(.horizontal, 16)
                .padding(.bottom, 96)
                .id(cheer.id)
                .transition(reduceMotion ? .opacity : .scale(scale: 0.9).combined(with: .opacity))
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("cheer")
            }
        }
        .frame(maxWidth: .infinity)
        .animation(reduceMotion ? Motion.fade : Motion.bouncy, value: center.current)
        .allowsHitTesting(false)
    }
}

// MARK: - Chat orbs (§8.2)

/// Three faint bubble orbs behind the chat thread, clipped to the panel: the bubble's hue and its two companions.
/// They bob 5–6 pt on 7 / 9 / 8 s sines; under Reduce Motion they are drawn once and never move.
struct ChatOrbs: View {
    var hue: Hue
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if reduceMotion {
                orbs(t: 0)
            } else {
                TimelineView(.animation(minimumInterval: 1.0 / 30.0)) { orbs(t: $0.date.timeIntervalSinceReferenceDate) }
            }
        }
        .opacity(colorScheme == .dark ? Theme.Brand.chatOrbDark : Theme.Brand.chatOrbLight)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func orbs(t: Double) -> some View {
        let pair = Mascot.companions(for: hue)
        let bob: (Double, Double) -> CGFloat = { amp, period in CGFloat(sin(t / period * 2 * .pi) * amp) }
        return GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            ZStack(alignment: .topLeading) {
                // Ø 220 at right −14 % / top 6 %.
                BubbleOrb(hue: hue).frame(width: 220, height: 220)
                    .position(x: w + 0.14 * w - 110, y: 0.06 * h + 110 + bob(6, 7))
                // Ø 110 at left −8 % / bottom 14 %.
                BubbleOrb(hue: pair.0).frame(width: 110, height: 110)
                    .position(x: -0.08 * w + 55, y: h - 0.14 * h - 55 + bob(5, 9))
                // Ø 64 at right 18 % / bottom −4 %.
                BubbleOrb(hue: pair.1).frame(width: 64, height: 64)
                    .position(x: w - 0.18 * w - 32, y: h + 0.04 * h - 32 + bob(5, 8))
            }
        }
    }
}
