import SwiftUI

// The playful building blocks of the design system: glossy bubbles, the ambient backdrop,
// confetti, shimmer skeletons, the sliding segmented pill and entrance motion.
// Ambient loops are driven by TimelineView + Canvas (no repeatForever animations), so they cost one
// cheap draw per frame, pause under Reduce Motion and never keep the app from going idle.

private func fraction(_ value: Double) -> Double { value - value.rounded(.down) }

/// A glossy bubble: the brand's basic shape. Radial fill, soft rim and a highlight at 10 o'clock.
struct BubbleOrb: View {
    var hue: Hue
    var body: some View {
        GeometryReader { geo in
            let size = min(geo.size.width, geo.size.height)
            ZStack {
                Circle().fill(RadialGradient(colors: [hue.glow, hue.fill, hue.deep],
                                             center: UnitPoint(x: 0.35, y: 0.3),
                                             startRadius: 0, endRadius: size * 0.75))
                Circle().strokeBorder(.white.opacity(0.28), lineWidth: max(1, size * 0.03))
                Ellipse().fill(.white.opacity(0.6))
                    .frame(width: size * 0.26, height: size * 0.16)
                    .rotationEffect(.degrees(-35))
                    .offset(x: -size * 0.2, y: -size * 0.24)
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .accessibilityHidden(true)
    }
}

/// Floating translucent bubbles drifting upwards. Static under Reduce Motion.
struct BubbleBackdrop: View {
    var hues: [Hue] = [.grape, .coral, .mint, .sunny, .sky, .pink]
    var count = 16
    /// Multiplier on drift speed; 1 crosses the screen in roughly 20–36 s.
    var speed = 1.0
    var intensity = 1.0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60.0, paused: reduceMotion)) { timeline in
            Canvas(rendersAsynchronously: false) { context, size in
                draw(in: &context, size: size, time: timeline.date.timeIntervalSinceReferenceDate)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func draw(in context: inout GraphicsContext, size: CGSize, time: Double) {
        let alpha = (colorScheme == .dark ? 0.22 : 0.42) * intensity
        for index in 0..<count {
            let seed = Double(index) + 1
            let radius = (0.045 + 0.11 * fraction(seed * 0.618)) * size.width
            let period = (20 + 16 * fraction(seed * 0.37)) / speed
            let progress = reduceMotion ? fraction(seed * 0.754) : fraction(time / period + fraction(seed * 0.754))
            let sway = reduceMotion ? 0 : sin(time * 0.5 + seed * 1.7) * 0.03
            let x = (fraction(seed * 0.283 + 0.11) + sway) * size.width
            let y = size.height + radius - progress * (size.height + 2 * radius)
            let hue = hues[index % hues.count]
            let rect = CGRect(x: x - radius, y: y - radius, width: radius * 2, height: radius * 2)
            let circle = Path(ellipseIn: rect)
            context.fill(circle, with: .radialGradient(
                Gradient(colors: [hue.glow.opacity(alpha * 0.55), hue.fill.opacity(alpha)]),
                center: CGPoint(x: x - radius * 0.3, y: y - radius * 0.35), startRadius: 0, endRadius: radius * 1.4))
            context.stroke(circle, with: .color(.white.opacity(alpha * 0.9)), lineWidth: 1.5)
            var highlight = context
            highlight.translateBy(x: x - radius * 0.42, y: y - radius * 0.48)
            highlight.rotate(by: .degrees(-35))
            highlight.fill(Path(ellipseIn: CGRect(x: -radius * 0.24, y: -radius * 0.13, width: radius * 0.48, height: radius * 0.26)),
                           with: .color(.white.opacity(min(1, alpha * 1.5))))
        }
    }
}

/// Makes its content bob gently up and down. Static under Reduce Motion.
struct Floating: ViewModifier {
    var amplitude: CGFloat = 5
    var period: Double = 4
    var phase: Double = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        if reduceMotion {
            content
        } else {
            TimelineView(.animation(minimumInterval: 1.0 / 60.0)) { timeline in
                let t = timeline.date.timeIntervalSinceReferenceDate
                content.offset(y: sin((t / period + phase) * 2 * .pi) * amplitude)
            }
        }
    }
}

extension View {
    func floating(amplitude: CGFloat = 5, period: Double = 4, phase: Double = 0) -> some View {
        modifier(Floating(amplitude: amplitude, period: period, phase: phase))
    }
}

/// A cluster of three bubbles with a symbol in the largest: the illustration for empty states and headers.
struct BubbleCluster: View {
    var icon: String
    var hue: Hue
    var size: CGFloat = 96

    private var companions: (Hue, Hue) {
        switch hue {
        case .coral: (.sunny, .grape)
        case .tangerine: (.coral, .mint)
        case .mint: (.sky, .sunny)
        case .sky: (.mint, .pink)
        default: (.coral, .mint)
        }
    }

    var body: some View {
        ZStack {
            BubbleOrb(hue: companions.0)
                .frame(width: size * 0.34, height: size * 0.34)
                .offset(x: size * 0.46, y: -size * 0.3)
                .floating(amplitude: 4, period: 3.6, phase: 0.3)
            BubbleOrb(hue: companions.1)
                .frame(width: size * 0.24, height: size * 0.24)
                .offset(x: -size * 0.5, y: size * 0.28)
                .floating(amplitude: 5, period: 4.4, phase: 0.7)
            ZStack {
                BubbleOrb(hue: hue)
                Image(systemName: icon)
                    .font(.system(size: size * 0.36, weight: .bold))
                    .foregroundStyle(hue.onFill)
            }
            .frame(width: size * 0.8, height: size * 0.8)
            .floating(amplitude: 3, period: 5)
        }
        .frame(width: size * 1.3, height: size)
        .accessibilityHidden(true)
    }
}

/// A one-shot burst of confetti, fired each time `trigger` changes. Draws nothing under Reduce Motion.
struct ConfettiBurst: View {
    var trigger: Int
    var hues: [Hue] = [.sunny, .coral, .mint, .sky, .pink, .grape]
    @State private var start: Date?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    static let duration = 0.9

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60.0, paused: start == nil)) { timeline in
            Canvas { context, size in
                guard let start else { return }
                let t = timeline.date.timeIntervalSince(start)
                guard t >= 0, t < Self.duration else { return }
                let center = CGPoint(x: size.width / 2, y: size.height / 2)
                for index in 0..<22 {
                    let seed = Double(index) + 1
                    let angle = seed / 22 * 2 * .pi + fraction(seed * 0.618) * 0.5
                    let velocity = 110 + 120 * fraction(seed * 0.37)
                    // Fast start, eased out, plus gravity.
                    let travel = velocity * (1 - pow(1 - t / Self.duration, 3)) * 0.55
                    let x = center.x + cos(angle) * travel
                    let y = center.y + sin(angle) * travel + 160 * t * t
                    let fade = min(1, (Self.duration - t) / 0.3)
                    let side = 5 + 4 * fraction(seed * 0.283)
                    var piece = context
                    piece.translateBy(x: x, y: y)
                    piece.rotate(by: .radians(t * (4 + 6 * fraction(seed * 0.9)) + seed))
                    let rect = CGRect(x: -side / 2, y: -side / 2, width: side, height: index % 3 == 0 ? side : side * 0.55)
                    let path = index % 3 == 0 ? Path(ellipseIn: rect) : Path(roundedRect: rect, cornerRadius: 1.5)
                    piece.fill(path, with: .color(hues[index % hues.count].fill.opacity(fade)))
                }
            }
        }
        .frame(width: 260, height: 260)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onChange(of: trigger) {
            guard !reduceMotion else { return }
            let fired = Date.now
            start = fired
            Task {
                try? await Task.sleep(for: .seconds(Self.duration + 0.05))
                if start == fired { start = nil }
            }
        }
    }
}

/// Shimmering placeholder block shown while content loads.
struct Shimmer: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        if reduceMotion {
            content
        } else {
            content.overlay {
                TimelineView(.animation(minimumInterval: 1.0 / 60.0)) { timeline in
                    GeometryReader { geo in
                        let phase = fraction(timeline.date.timeIntervalSinceReferenceDate / 1.3)
                        LinearGradient(colors: [.clear, .white.opacity(0.45), .clear], startPoint: .leading, endPoint: .trailing)
                            .frame(width: geo.size.width * 0.6)
                            .offset(x: -geo.size.width * 0.6 + phase * geo.size.width * 1.6)
                    }
                }
                .blendMode(.plusLighter)
                .mask(content)
            }
        }
    }
}

/// Skeleton of a feed card: icon block and three text lines.
struct SkeletonCard: View {
    var height: CGFloat? = nil
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.field).frame(width: 44, height: 44)
            VStack(alignment: .leading, spacing: 10) {
                Capsule().fill(Theme.field).frame(width: 90, height: 10)
                Capsule().fill(Theme.field).frame(height: 14)
                Capsule().fill(Theme.field).frame(width: 150, height: 12)
            }
        }
        .frame(height: height, alignment: .top)
        .modifier(Shimmer())
        .card()
        .accessibilityHidden(true)
    }
}

/// Three skeleton cards, used by every list while its first load is in flight.
struct SkeletonList: View {
    var count = 3
    var body: some View {
        VStack(spacing: 12) {
            ForEach(0..<count, id: \.self) { _ in SkeletonCard() }
        }
        .accessibilityElement()
        .accessibilityLabel(Text("Loading"))
    }
}

/// Segmented control with a pill that slides between options.
struct SegmentedPill<Value: Hashable>: View {
    struct Option: Identifiable {
        var value: Value
        var label: LocalizedStringResource
        var id: Value { value }
    }

    @Binding var selection: Value
    var options: [Option]
    var hue: Hue = .grape
    @Namespace private var namespace
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 4) {
            ForEach(options) { option in
                let selected = option.value == selection
                Button {
                    withAnimation(Motion.resolve(Motion.snappy, reduceMotion: reduceMotion)) { selection = option.value }
                } label: {
                    Text(option.label)
                        .font(.rounded(.subheadline))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .foregroundStyle(selected ? hue.onFill : Theme.inkSecondary)
                        .padding(.horizontal, 10)
                        .frame(maxWidth: .infinity, minHeight: 40)
                        .background {
                            if selected {
                                Capsule().fill(hue.gradient)
                                    .shadow(color: hue.fill.opacity(0.3), radius: 6, y: 3)
                                    .matchedGeometryEffect(id: "selection", in: namespace)
                            }
                        }
                        .contentShape(Capsule())
                }
                .buttonStyle(.squish)
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
        .padding(4)
        .background(Theme.field, in: Capsule())
        .sensoryFeedback(.selection, trigger: selection)
    }
}

/// Entrance for list content: fades up with a bouncy spring, staggered by `index` for the first few siblings.
struct PopIn: ViewModifier {
    var index: Int
    @State private var shown = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .opacity(shown ? 1 : 0)
            .offset(y: shown || reduceMotion ? 0 : 18)
            .scaleEffect(shown || reduceMotion ? 1 : 0.96)
            .onAppear {
                guard !shown else { return }
                let delay = index < Motion.staggerLimit ? Double(index) * Motion.stagger : 0
                withAnimation(Motion.resolve(Motion.bouncy, reduceMotion: reduceMotion).delay(reduceMotion ? 0 : delay)) { shown = true }
            }
    }
}

extension View {
    /// Staggered entrance; pass the item's position in its list.
    func popIn(_ index: Int = 0) -> some View { modifier(PopIn(index: index)) }

    /// Cards shrink and fade slightly as they scroll off either edge.
    func scrollFade() -> some View { modifier(ScrollFade()) }
}

private struct ScrollFade: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func body(content: Content) -> some View {
        let reduce = reduceMotion
        content.scrollTransition(.interactive, axis: .vertical) { view, phase in
            view
                .scaleEffect(phase.isIdentity || reduce ? 1 : 0.94)
                .opacity(phase.isIdentity || reduce ? 1 : 0.55)
        }
    }
}

/// Round icon button on a surface: back, edit, copy, share.
struct CircleIcon: View {
    var systemName: String
    var hue: Hue = .grape
    var size: CGFloat = 42
    var filled = false
    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: size * 0.4, weight: .bold))
            .foregroundStyle(filled ? hue.onFill : hue.text)
            .frame(width: size, height: size)
            .background(Circle().fill(filled ? AnyShapeStyle(hue.gradient) : AnyShapeStyle(hue.wash)))
            .contentShape(Circle())
    }
}

/// Squircle badge with a feature symbol on the feature's fill.
struct FeatureBadge: View {
    var icon: String
    var hue: Hue
    var size: CGFloat = 44
    var body: some View {
        Image(systemName: icon)
            .font(.system(size: size * 0.4, weight: .bold))
            .foregroundStyle(hue.onFill)
            .frame(width: size, height: size)
            .background(hue.gradient, in: RoundedRectangle(cornerRadius: size * 0.32, style: .continuous))
            .accessibilityHidden(true)
    }
}
