import SwiftUI
import UIKit

/// The chat composer's state for @mentions (docs/boolaa-spec.md, "Mentions", "Composer"): the draft with its
/// tokens, the candidates, which "@" the list was dismissed for, and the active row.
@MainActor
@Observable
final class MentionComposerModel {
    var draft = MentionDraft()
    var focused = false
    /// IME composition in progress: no list.
    var composing = false
    var candidates: [MentionCandidate] = [] {
        didSet { applyPendingMention() }
    }
    /// The "@" (UTF-16 location) whose list Escape closed; it reopens only with a new "@".
    private var dismissedAt: Int?
    var activeIndex = 0
    /// Bumped on every change the text view must take over (pick, cleared after send, a draft, a swallowed token).
    private(set) var revision = 0
    /// An "Ask in chat" draft's owner, made a token once the candidates say they are a member.
    private var pendingMention: (userID: UUID, range: NSRange)?

    var text: String { draft.text }

    /// The "@query" at the caret, if the list may show.
    var trigger: (at: Int, query: String)? {
        guard focused, !composing, draft.selection.length == 0,
              let t = Mentions.activeQuery(in: draft.text, caret: draft.selection.location, tokens: draft.tokens),
              t.at != dismissedAt else { return nil }
        return t
    }

    var list: Mentions.ListState {
        Mentions.listState(query: trigger?.query, candidates: candidates, tokenCount: draft.tokens.count)
    }

    var rows: [MentionCandidate] {
        if case .rows(let rows) = list { return rows }
        return []
    }

    var isListOpen: Bool { list != .hidden }

    // MARK: Actions

    func pick(_ candidate: MentionCandidate) {
        guard let at = trigger?.at else { return }
        draft.insert(candidate, at: at)
        activeIndex = 0
        revision += 1
    }

    /// Return / Enter while the list is open: inserts the active row (nothing on the limit or no-match row).
    func pickActive() {
        let rows = rows
        guard !rows.isEmpty else { return }
        pick(rows[min(activeIndex, rows.count - 1)])
    }

    /// ↑ / ↓, wrapping.
    func move(by step: Int) {
        let count = rows.count
        guard count > 0 else { return }
        activeIndex = ((activeIndex + step) % count + count) % count
    }

    /// Escape: closes the list, keeps the text.
    func dismissList() {
        dismissedAt = trigger?.at
    }

    /// The text view's edit, before it happens. Returns whether the view may apply it itself.
    func shouldApply(_ range: NSRange, replacement: String) -> Bool {
        var next = draft
        let applied = next.replace(range, with: replacement)
        draft = next
        afterEdit()
        if applied == range { return true }
        revision += 1
        return false
    }

    /// The text view's text after an edit it made without asking first (or that came out differently): tokens that
    /// no longer match their "@Name" are dropped.
    func resync(text: String, selection: NSRange) {
        if text != draft.text {
            let ns = text as NSString
            draft.tokens = draft.tokens.filter { t in
                NSMaxRange(t.range) <= ns.length && ns.substring(with: t.range) == (draft.text as NSString).substring(with: t.range)
                    && ns.substring(with: t.range).hasPrefix("@")
            }
            draft.text = text
        }
        draft.selection = selection
        afterEdit()
    }

    func select(_ range: NSRange) {
        guard draft.selection != range else { return }
        draft.selection = range
        afterEdit()
    }

    private func afterEdit() {
        if let at = dismissedAt {
            let ns = draft.text as NSString
            if at >= ns.length || ns.character(at: at) != 0x40 { dismissedAt = nil }
        }
        if activeIndex >= max(rows.count, 1) { activeIndex = 0 }
    }

    /// Another bubble: its members aren't this one's, so the draft keeps its text as plain text.
    func forgetTokens() {
        guard !draft.tokens.isEmpty || pendingMention != nil else { return }
        draft.tokens = []
        pendingMention = nil
        revision += 1
    }

    func clear() {
        draft = MentionDraft()
        dismissedAt = nil
        pendingMention = nil
        activeIndex = 0
        revision += 1
    }

    /// Adds `text` to the draft (the marketplace "Ask in chat"); `mention` is the owner named in it as "@Name".
    func append(_ text: String, mention: UserProfile?) {
        let prefix = draft.text.isEmpty ? "" : draft.text + " "
        let offset = (prefix as NSString).length
        draft = MentionDraft(text: prefix + text, tokens: draft.tokens)
        if let mention {
            let r = (text as NSString).range(of: "@" + mention.displayName)
            if r.location != NSNotFound {
                pendingMention = (mention.id, NSRange(location: r.location + offset, length: r.length))
            }
        }
        revision += 1
        applyPendingMention()
    }

    private func applyPendingMention() {
        guard let pending = pendingMention, !candidates.isEmpty else { return }
        pendingMention = nil
        guard candidates.contains(where: { $0.userID == pending.userID }),
              NSMaxRange(pending.range) <= (draft.text as NSString).length,
              !draft.tokens.contains(where: { NSIntersectionRange($0.range, pending.range).length > 0 }) else { return }
        draft.tokens.append(MentionToken(range: pending.range, userID: pending.userID))
        draft.tokens.sort { $0.range.location < $1.range.location }
        revision += 1
    }
}

/// `UITextView` that reports the hardware keys the mention list uses.
final class ComposerTextView: UITextView {
    /// Returns true when the key was handled.
    var onKey: (@MainActor (UIKeyboardHIDUsage) -> Bool)?

    override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        if let key = presses.first?.key, onKey?(key.keyCode) == true { return }
        super.pressesBegan(presses, with: event)
    }
}

/// The composer's text field: a plain text view (IME, dictation, spell check and VoiceOver work as usual) showing
/// mention tokens in the mention style, with the token editing rules applied to every edit.
struct MentionTextView: UIViewRepresentable {
    @Bindable var model: MentionComposerModel
    var placeholder: String
    var maxLines = 5

    func makeCoordinator() -> Coordinator { Coordinator(model: model) }

    func makeUIView(context: Context) -> ComposerTextView {
        let view = ComposerTextView()
        view.delegate = context.coordinator
        view.backgroundColor = .clear
        view.font = .preferredFont(forTextStyle: .body)
        view.adjustsFontForContentSizeCategory = true
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.isScrollEnabled = false
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.accessibilityIdentifier = "chat-input"
        view.accessibilityLabel = placeholder
        view.onKey = { [weak coordinator = context.coordinator] key in coordinator?.handle(key) ?? false }
        context.coordinator.apply(to: view)
        return view
    }

    func updateUIView(_ view: ComposerTextView, context: Context) {
        context.coordinator.model = model
        if context.coordinator.revision != model.revision, view.markedTextRange == nil {
            context.coordinator.apply(to: view)
        }
        if model.focused, !view.isFirstResponder, view.window != nil {
            DispatchQueue.main.async { view.becomeFirstResponder() }
        } else if !model.focused, view.isFirstResponder {
            DispatchQueue.main.async { view.resignFirstResponder() }
        }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: ComposerTextView, context: Context) -> CGSize? {
        let width = proposal.width ?? 240
        let fit = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        let line = (uiView.font ?? .preferredFont(forTextStyle: .body)).lineHeight
        let cap = ceil(line * CGFloat(maxLines))
        let scrolls = fit.height > cap
        if uiView.isScrollEnabled != scrolls { DispatchQueue.main.async { uiView.isScrollEnabled = scrolls } }
        return CGSize(width: width, height: max(ceil(line), min(fit.height, cap)))
    }

    @MainActor
    final class Coordinator: NSObject, UITextViewDelegate {
        var model: MentionComposerModel
        var revision = -1

        init(model: MentionComposerModel) { self.model = model }

        /// Puts the model's text, tokens and caret into the view.
        func apply(to view: UITextView) {
            revision = model.revision
            // Tell the keyboard, so autocorrect and predictions don't act on the old text.
            let changesText = view.text != model.draft.text
            if changesText {
                view.inputDelegate?.textWillChange(view)
                view.text = model.draft.text
            }
            style(view)
            let length = (view.text as NSString).length
            let sel = model.draft.selection
            let clamped = NSRange(location: min(sel.location, length), length: min(sel.length, max(0, length - min(sel.location, length))))
            if view.selectedRange != clamped {
                view.inputDelegate?.selectionWillChange(view)
                view.selectedRange = clamped
                view.inputDelegate?.selectionDidChange(view)
            }
            if changesText { view.inputDelegate?.textDidChange(view) }
        }

        /// Plain text in the body style; tokens semibold in the grape text shade.
        func style(_ view: UITextView) {
            guard view.markedTextRange == nil else { return }
            let font = UIFont.preferredFont(forTextStyle: .body)
            let base: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: UIColor.label]
            let storage = view.textStorage
            let length = storage.length
            let selection = view.selectedRange
            storage.beginEditing()
            storage.setAttributes(base, range: NSRange(location: 0, length: length))
            let bold = UIFont(descriptor: font.fontDescriptor.withSymbolicTraits(.traitBold) ?? font.fontDescriptor, size: font.pointSize)
            for t in model.draft.tokens where NSMaxRange(t.range) <= length {
                storage.addAttributes([.font: bold, .foregroundColor: UIColor(Hue.grape.text)], range: t.range)
            }
            storage.endEditing()
            view.typingAttributes = base
            if view.selectedRange != selection { view.selectedRange = selection }
        }

        func handle(_ key: UIKeyboardHIDUsage) -> Bool {
            guard model.isListOpen else { return false }
            switch key {
            case .keyboardUpArrow: model.move(by: -1); return true
            case .keyboardDownArrow: model.move(by: 1); return true
            case .keyboardEscape: model.dismissList(); return true
            default: return false
            }
        }

        func textView(_ view: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
            // Return picks while the list is open (it never sends anyway: Send is a button).
            if text == "\n", model.isListOpen, view.markedTextRange == nil {
                model.pickActive()
                apply(to: view)
                return false
            }
            if model.shouldApply(range, replacement: text) { return true }
            apply(to: view)
            return false
        }

        func textViewDidChange(_ view: UITextView) {
            model.composing = view.markedTextRange != nil
            model.resync(text: view.text, selection: view.selectedRange)
            style(view)
            revision = model.revision
        }

        func textViewDidChangeSelection(_ view: UITextView) {
            model.composing = view.markedTextRange != nil
            model.select(view.selectedRange)
        }

        func textViewDidBeginEditing(_ view: UITextView) { if !model.focused { model.focused = true } }
        func textViewDidEndEditing(_ view: UITextView) { if model.focused { model.focused = false } }
    }
}

/// The strip above the composer: members to mention (avatar + name), at most five rows visible, the first active.
struct MentionStrip: View {
    var state: Mentions.ListState
    var activeIndex: Int
    var onPick: (MentionCandidate) -> Void
    @ScaledMetric(relativeTo: .body) private var rowHeight: CGFloat = 48

    var body: some View {
        Group {
            switch state {
            case .hidden:
                EmptyView()
            case .limit:
                infoRow(String(localized: "You can mention up to 10 people in one message.", comment: "Mention list row and error"))
                    .accessibilityIdentifier("mention-limit")
            case .noMatch:
                infoRow(String(localized: "No members match", comment: "Mention list: nothing matches what was typed after @"))
                    .accessibilityIdentifier("mention-no-match")
            case .rows(let rows):
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(Array(rows.enumerated()), id: \.element.id) { index, candidate in
                                row(candidate, active: index == activeIndex).id(candidate.id)
                            }
                        }
                    }
                    .frame(height: rowHeight * CGFloat(min(rows.count, Mentions.visibleRows)))
                    .onChange(of: activeIndex) { _, i in
                        if rows.indices.contains(i) { proxy.scrollTo(rows[i].id) }
                    }
                }
            }
        }
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Theme.fieldBorder, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Members to mention", comment: "Accessibility name of the mention list"))
        .accessibilityIdentifier("mention-list")
    }

    private func row(_ candidate: MentionCandidate, active: Bool) -> some View {
        Button { onPick(candidate) } label: {
            HStack(spacing: 10) {
                AvatarView(user: candidate.profile, size: 30).accessibilityHidden(true)
                Text(verbatim: candidate.displayName)
                    .font(.body.weight(.medium))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14)
            .frame(minHeight: max(44, rowHeight))
            .background(active ? Hue.grape.wash : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("Mention \(candidate.displayName)", comment: "Accessibility label of a row in the mention list"))
        .accessibilityIdentifier("mention-row-\(candidate.displayName)")
    }

    private func infoRow(_ text: String) -> some View {
        Text(verbatim: text)
            .font(.subheadline)
            .foregroundStyle(Theme.inkSecondary)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .padding(.horizontal, 14)
    }

    /// What VoiceOver hears when the list appears or its count changes.
    static func announcement(_ state: Mentions.ListState) -> String? {
        switch state {
        case .hidden: nil
        case .limit: String(localized: "You can mention up to 10 people in one message.", comment: "Mention list row and error")
        case .noMatch: String(localized: "No members match", comment: "Mention list: nothing matches what was typed after @")
        case .rows(let rows): String(localized: "\(rows.count) members", comment: "Mention list announcement: how many members match")
        }
    }
}
