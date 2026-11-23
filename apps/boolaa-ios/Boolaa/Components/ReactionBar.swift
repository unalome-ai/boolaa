import SwiftUI

/// The reaction chips under a message or post (docs/boolaa-spec.md, "Reactions"): one chip per
/// reaction with a count, in the fixed order, yours highlighted; tapping a chip toggles yours.
/// The trailing smiley opens the picker.
struct ReactionBar: View {
    var summaries: [ReactionSummary]
    var hue: Hue
    /// The "Add a reaction" button. Hidden when `addOnlyWithChips` and there is nothing yet (chat).
    var showsAdd = true
    var addOnlyWithChips = false
    /// Chat (§8.2): your reactions are the grape gradient with white, whatever the bubble's hue.
    var filledMine = false
    var onToggle: (ReactionKind) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let add = showsAdd && (!addOnlyWithChips || !summaries.isEmpty)
        if !summaries.isEmpty || add {
            FlowLayout(spacing: 6) {
                ForEach(summaries) { s in
                    ReactionChip(summary: s, hue: hue, filledMine: filledMine) { onToggle(s.kind) }
                        // A chip that appears pops 0.4 → 1 (`bouncy`); one whose count reaches 0 just goes.
                        .transition(.asymmetric(insertion: reduceMotion ? .opacity : .scale(scale: 0.4).combined(with: .opacity),
                                                removal: .identity))
                }
                if add { AddReactionButton(hue: hue, onPick: onToggle) }
            }
            .animation(reduceMotion ? Motion.fade : Motion.bouncy, value: summaries)
            // Adding yours: a light impact; taking it back: a selection tick (§8.3).
            .sensoryFeedback(trigger: summaries) { old, new in
                Self.mineCount(new) > Self.mineCount(old) ? Interaction.reactionAdded.haptic.feedback
                    : Self.mineCount(new) < Self.mineCount(old) ? Interaction.reactionRemoved.haptic.feedback : nil
            }
        }
    }

    static func mineCount(_ summaries: [ReactionSummary]) -> Int { summaries.filter(\.mine).count }
}

struct ReactionChip: View {
    var summary: ReactionSummary
    var hue: Hue
    var filledMine = false
    var action: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Text(verbatim: summary.kind.emoji)
                Text(summary.count, format: .number)
                    .font(.rounded(.footnote, weight: .bold)).monospacedDigit()
                    .contentTransition(.numericText(value: Double(summary.count)))
                    // A changed count pops softly 0.9 → 1 (`bouncy`); in place under Reduce Motion.
                    .phaseAnimator(reduceMotion ? [1.0] : [1.0, 0.9, 1.0], trigger: summary.count) { count, scale in
                        count.scaleEffect(scale)
                    } animation: { scale in scale == 0.9 ? .linear(duration: 0.01) : Motion.bouncy }
            }
            .foregroundStyle(summary.mine ? (filledMine ? Hue.grape.onFill : hue.text) : (filledMine ? Theme.ink : Theme.inkSecondary))
            .padding(.horizontal, 10)
            .frame(minHeight: 32)
            .background {
                if summary.mine && filledMine {
                    Capsule().fill(Hue.grape.gradient)
                } else if summary.mine {
                    Capsule().fill(hue.wash).overlay(Capsule().strokeBorder(hue.text.opacity(0.6), lineWidth: 1.5))
                } else {
                    Capsule().fill(Theme.chipInactive)
                }
            }
            // 32 pt chip, 44 pt touch target.
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.squish)
        .accessibilityLabel(Text(verbatim: summary.kind.chipLabel(count: summary.count)))
        .accessibilityValue(summary.mine ? Text("You reacted", comment: "Accessibility value of a reaction chip you added") : Text(verbatim: ""))
        .accessibilityAddTraits(summary.mine ? .isSelected : [])
        .accessibilityIdentifier("reaction-\(summary.kind.rawValue)")
    }
}

/// Smiley button opening the six reactions.
struct AddReactionButton: View {
    var hue: Hue
    var onPick: (ReactionKind) -> Void

    var body: some View {
        Menu {
            ReactionMenuItems(onPick: onPick)
        } label: {
            Image(systemName: "face.smiling")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(hue.text)
                .frame(width: 36, height: 32)
                .background(Capsule().fill(Theme.chipInactive))
                .overlay(alignment: .topTrailing) {
                    Image(systemName: "plus").font(.system(size: 8, weight: .black)).foregroundStyle(hue.text).offset(x: -5, y: 4)
                }
                .minimumHitTarget()
        }
        .accessibilityLabel(Text("Add a reaction", comment: "Button opening the reaction picker"))
        .accessibilityIdentifier("add-reaction")
    }
}

/// The six reactions as menu buttons (picker, context menus).
struct ReactionMenuItems: View {
    var onPick: (ReactionKind) -> Void
    var body: some View {
        ForEach(ReactionKind.allCases) { kind in
            Button { onPick(kind) } label: { Text(verbatim: kind.emoji + "  ") + Text(kind.name) }
                .accessibilityLabel(Text(kind.name))
                .accessibilityIdentifier("pick-reaction-\(kind.rawValue)")
        }
    }
}

/// "React" submenu for long-press menus.
struct ReactSubmenu: View {
    var onPick: (ReactionKind) -> Void
    var body: some View {
        Menu {
            ReactionMenuItems(onPick: onPick)
        } label: {
            Label { Text("React", comment: "Context menu entry opening the reactions") } icon: { Image(systemName: "face.smiling") }
        }
    }
}

extension View {
    /// VoiceOver actions "Like", "Love", … on an element that combines its children (chat bubbles).
    func reactionAccessibilityActions(enabled: Bool = true, _ onPick: @escaping (ReactionKind) -> Void) -> some View {
        accessibilityActions {
            ForEach(enabled ? ReactionKind.allCases : []) { kind in
                Button { onPick(kind) } label: { Text(kind.name) }
            }
        }
    }
}

/// Left-to-right wrapping row (chips).
struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        let width = rows.map(\.width).max() ?? 0
        let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(rows.count - 1, 0))
        return CGSize(width: proposal.width.map { min($0, width) } ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(width: bounds.width, subviews: subviews) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y + (row.height - size.height) / 2), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row { var indices: [Int] = []; var width: CGFloat = 0; var height: CGFloat = 0 }

    private func arrange(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = []
        var current = Row()
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let needed = current.indices.isEmpty ? size.width : current.width + spacing + size.width
            if needed > width, !current.indices.isEmpty {
                rows.append(current)
                current = Row()
            }
            current.width = current.indices.isEmpty ? size.width : current.width + spacing + size.width
            current.height = max(current.height, size.height)
            current.indices.append(index)
        }
        if !current.indices.isEmpty { rows.append(current) }
        return rows
    }
}
