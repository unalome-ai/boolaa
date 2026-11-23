import SwiftUI

/// Search state for one bubble: debounced, and only the latest query's answer is shown.
@MainActor
@Observable
final class SearchModel {
    enum Phase: Equatable { case idle, tooShort, loading, failed, done(query: String, hits: [SearchHit]) }
    private(set) var phase: Phase = .idle
    private(set) var hits: [SearchHit] = []

    /// Runs inside `.task(id:)` keyed by query and bubble: a newer key cancels this one.
    func run(_ text: String, bubbleID: UUID?, api: BoolaaAPI) async {
        guard let bubbleID else { return }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let query = SearchRules.query(text) else {
            phase = trimmed.isEmpty ? .idle : .tooShort
            hits = []
            return
        }
        do { try await Task.sleep(for: SearchRules.debounce) } catch { return }
        if case .done = phase {} else { phase = .loading }
        do {
            let result = try await api.searchBubble(bubbleID: bubbleID, query: query)
            guard !Task.isCancelled else { return }
            hits = result
            phase = .done(query: query, hits: result)
        } catch {
            guard !Task.isCancelled, !(error is CancellationError) else { return }
            phase = .failed
        }
    }
}

/// Search inside the current bubble (docs/boolaa-spec.md, "Search"): messages, events, food posts,
/// market items and links. A result opens its screen and highlights it; a message opens in the chat.
struct SearchView: View {
    @Environment(SessionStore.self) private var session
    @Environment(ShellRouter.self) private var router
    @Environment(\.dismiss) private var dismiss
    @State private var model = SearchModel()
    @State private var text = ""
    @State private var attempt = 0
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Search", comment: "Title of the search sheet")
                    .font(.rounded(.title2, weight: .heavy))
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                Button { dismiss() } label: {
                    Image(systemName: "xmark").font(.system(size: 15, weight: .heavy))
                        .frame(width: 36, height: 36)
                        .background(Circle().fill(Theme.card))
                        .minimumHitTarget()
                }
                .buttonStyle(.squishIcon)
                .accessibilityLabel(Text("Close"))
                .accessibilityIdentifier("search-close")
            }
            field
            content
        }
        .padding(.horizontal, 16)
        .padding(.top, 20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .onAppear { focused = true }
        .task(id: "\(text)|\(session.currentBubble?.id.uuidString ?? "")|\(attempt)") {
            await model.run(text, bubbleID: session.currentBubble?.id, api: session.api)
        }
        .onChange(of: session.currentBubble?.id) { _, _ in text = "" }
        .onChange(of: model.phase) { _, phase in
            guard case .done(let query, let hits) = phase else { return }
            AccessibilityNotification.Announcement(hits.isEmpty
                ? String(localized: "No results for “\(query)”")
                : String(localized: "\(hits.count) results")).post()
        }
    }

    private var field: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(Theme.inkSecondary).accessibilityHidden(true)
            TextField(text: $text, prompt: Text("Search \(session.currentBubble?.name ?? "")")) {
                Text("Search this bubble")
            }
            .focused($focused)
            .submitLabel(.search)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .onSubmit { if case .done(_, let hits) = model.phase, let first = hits.first { router.open(first) } }
            .accessibilityIdentifier("search-field")
            if !text.isEmpty {
                Button { text = ""; focused = true } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.inkSecondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Clear search"))
                .accessibilityIdentifier("search-clear")
            }
        }
        .fieldShell(focused: focused)
    }

    @ViewBuilder private var content: some View {
        switch model.phase {
        case .idle:
            hint("Find messages, events, food, items and links.", id: "search-hint")
        case .tooShort:
            hint("Type at least 2 characters.", id: "search-min")
        case .loading:
            ProgressView().frame(maxWidth: .infinity).padding(.top, 30).accessibilityIdentifier("search-loading")
        case .failed:
            VStack(spacing: 12) {
                Text("Search didn't work. Try again.").foregroundStyle(Theme.dangerText)
                Button("Try again") { attempt += 1 }.buttonStyle(.bordered)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 24)
            .accessibilityIdentifier("search-error")
        case .done(let query, let hits):
            if hits.isEmpty {
                EmptyStateView(title: "No results for “\(query)”",
                               message: "Try another word, or fewer letters.")
                    .padding(.top, 20)
                    .accessibilityIdentifier("search-empty")
            } else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(hits) { hit in
                            Button { router.open(hit) } label: { SearchHitRowView(hit: hit) }
                                .buttonStyle(.squish)
                                .accessibilityIdentifier("search-hit-\(hit.kind.rawValue)")
                        }
                    }
                    .padding(.bottom, 24)
                }
                .scrollDismissesKeyboard(.interactively)
                .accessibilityLabel(Text("\(hits.count) results"))
            }
        }
    }

    private func hint(_ text: LocalizedStringResource, id: String) -> some View {
        Text(text).font(.subheadline).foregroundStyle(Theme.inkSecondary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.top, 24)
            .accessibilityIdentifier(id)
    }
}

/// One result: kind icon in its feature colour, title (or author), highlighted snippet, kind · author · date.
struct SearchHitRowView: View {
    let hit: SearchHit

    private var hue: Hue { hit.kind.feature.hue }
    private var author: String { hit.authorName ?? String(localized: "Someone") }
    private var headline: String { hit.title ?? author }
    private var meta: String {
        let date = hit.eventAt.map { $0.formatted(date: .abbreviated, time: .shortened) }
            ?? hit.createdAt.formatted(.relative(presentation: .named))
        return [hit.kind.label, hit.title == nil ? nil : author, date].compactMap { $0 }.joined(separator: " · ")
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: hit.kind.feature.icon)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(hue.onFill)
                .frame(width: 40, height: 40)
                .background(Circle().fill(hue.gradient))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(SearchHighlight.attributed(headline, words: hit.matchedWords, hue: hue))
                    .font(.rounded(.headline)).lineLimit(1)
                if let snippet = hit.snippet {
                    Text(SearchHighlight.attributed(snippet, words: hit.matchedWords, hue: hue))
                        .font(.subheadline).lineLimit(2)
                        .accessibilityIdentifier("search-snippet")
                }
                Text(meta).font(.caption.weight(.semibold)).foregroundStyle(Theme.inkSecondary).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .multilineTextAlignment(.leading)
            .foregroundStyle(Theme.ink)
        }
        .card(padding: 12)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text([headline, hit.snippet, meta].compactMap { $0 }.joined(separator: ", ")))
        .accessibilityAddTraits(.isButton)
    }
}
