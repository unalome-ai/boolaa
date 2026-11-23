import SwiftUI

// Accessibility helpers (docs/boolaa-spec.md, "Accessibility"): composed VoiceOver labels, polite
// announcements, layouts that stack at the accessibility text sizes and minimum touch targets.
// Labels are joined with ", " so VoiceOver pauses between the parts.

enum A11y {
    /// Minimum touch target (Apple HIG).
    static let minTarget: CGFloat = 44

    /// Joins the non-empty parts with ", ".
    nonisolated static func join(_ parts: [String?]) -> String {
        parts.compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }.joined(separator: ", ")
    }

    /// "Photo from Ana": a post, item or chat photo.
    nonisolated static func photoFrom(_ name: String) -> String {
        String(localized: "Photo from \(name)", comment: "Accessibility label of a photo someone posted; the argument is the person's name")
    }

    /// Spoken when a message from someone else arrives while the chat is open.
    nonisolated static func newMessageFrom(_ name: String) -> String {
        String(localized: "New message from \(name)", comment: "VoiceOver announcement for a live chat message; the argument is the sender's name")
    }

    /// "Love: 3 reactions, You reacted" for each reaction, in the fixed order.
    nonisolated static func reactions(_ summaries: [ReactionSummary]) -> String {
        join(summaries.map { s in
            s.mine ? join([s.kind.chipLabel(count: s.count), String(localized: "You reacted", comment: "Accessibility value of a reaction chip you added")])
                : s.kind.chipLabel(count: s.count)
        })
    }

    /// One chat message read as a single element: sender, text (or photo, or the deleted placeholder), time, reactions.
    nonisolated static func chatMessage(sender: String, isMine: Bool, text: String, hasPhoto: Bool, deleted: Bool,
                                        time: String, reactions: [ReactionSummary]) -> String {
        let who = isMine ? String(localized: "You", comment: "Author label for your own chat messages") : sender
        if deleted {
            return join([who, String(localized: "This message was deleted"), time])
        }
        let photo = isMine ? String(localized: "Photo", comment: "Home card / chat preview for a photo message without a caption") : photoFrom(who)
        return join([who, hasPhoto ? photo : nil, text, time, A11y.reactions(reactions)])
    }

    /// Posts a polite VoiceOver announcement (queued behind current speech, never interrupting it).
    @MainActor static func announce(_ text: String) {
        guard !text.isEmpty else { return }
        var message = AttributedString(text)
        message.accessibilitySpeechAnnouncementPriority = .default
        AccessibilityNotification.Announcement(message).post()
    }
}

/// An HStack that becomes a leading-aligned VStack at the accessibility text sizes (AX1–AX5),
/// so side-by-side content wraps instead of being squeezed or clipped.
struct AdaptiveStack<Content: View>: View {
    var spacing: CGFloat? = nil
    var horizontalAlignment: VerticalAlignment = .center
    @ViewBuilder var content: Content
    @Environment(\.dynamicTypeSize) private var size

    var body: some View {
        let layout = size.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: spacing))
            : AnyLayout(HStackLayout(alignment: horizontalAlignment, spacing: spacing))
        layout { content }
    }
}

extension View {
    /// Grows the tappable frame to at least 44 × 44 pt around a smaller visual.
    func minimumHitTarget(_ size: CGFloat = A11y.minTarget) -> some View {
        frame(minWidth: size, minHeight: size).contentShape(Rectangle())
    }

    /// A photo someone posted: one image element labelled "Photo from <name>"; hidden when there is no photo
    /// (the placeholder is decorative).
    func photoLabel(_ name: String?, present: Bool = true) -> some View {
        accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: A11y.photoFrom(name ?? "")))
            .accessibilityAddTraits(.isImage)
            .accessibilityHidden(!present)
    }
}

/// A transition that becomes a plain fade under Reduce Motion.
private struct MotionTransition: ViewModifier {
    var transition: AnyTransition
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func body(content: Content) -> some View { content.transition(reduceMotion ? .opacity : transition) }
}

extension View {
    func motionTransition(_ transition: AnyTransition) -> some View { modifier(MotionTransition(transition: transition)) }
}
