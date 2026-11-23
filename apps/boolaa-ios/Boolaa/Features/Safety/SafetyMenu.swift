import SwiftUI

/// "Report …" and "Block/Unblock <name>" menu items for a piece of content or a member.
/// Nothing is shown for your own content.
struct SafetyMenuItems: View {
    var target: ReportTarget
    @Environment(SessionStore.self) private var session
    @Environment(SafetyStore.self) private var safety

    var body: some View {
        if target.authorID != session.userID {
            Button(role: .destructive) { safety.reportTarget = target } label: {
                Label { Text(target.type.reportTitle) } icon: { Image(systemName: "flag") }
            }
            if safety.isBlocked(target.authorID) {
                Button { Task { await safety.unblock(target.authorID) } } label: {
                    Label { Text("Unblock \(target.authorName)", comment: "Menu action; the argument is a person's name") }
                        icon: { Image(systemName: "person.crop.circle.badge.checkmark") }
                }
            } else {
                Button(role: .destructive) { Interaction.destructiveConfirm.play(); Task { await safety.block(target.authorID) } } label: {
                    Label { Text("Block \(target.authorName)", comment: "Menu action; the argument is a person's name") }
                        icon: { Image(systemName: "hand.raised") }
                }
            }
        }
    }
}

private struct SafetyContextMenu: ViewModifier {
    var target: ReportTarget
    var react: ((ReactionKind) -> Void)?
    @Environment(SessionStore.self) private var session

    func body(content: Content) -> some View {
        if target.authorID == session.userID {
            if let react {
                content.contextMenu { ReactSubmenu(onPick: react) }
            } else {
                content
            }
        } else {
            content.contextMenu {
                if let react { ReactSubmenu(onPick: react) }
                SafetyMenuItems(target: target)
            }
        }
    }
}

extension View {
    /// Long press offers Report and Block for someone else's content, and "React" when `react` is set.
    func safetyContextMenu(_ target: ReportTarget, react: ((ReactionKind) -> Void)? = nil) -> some View {
        modifier(SafetyContextMenu(target: target, react: react))
    }
}
