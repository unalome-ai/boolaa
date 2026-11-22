import Foundation
import Supabase

// Reactions on chat messages, events, food posts, market items and links
// (docs/boolaa-spec.md, "Reactions"; supabase/migrations/20261123160000_reactions_link_previews.sql).

/// The six fixed reactions, in display order. Stored as keys, not emoji.
enum ReactionKind: String, CaseIterable, Codable, Sendable, Identifiable {
    case like, love, laugh, wow, sad, thanks
    var id: String { rawValue }

    var emoji: String {
        switch self {
        case .like: "👍"
        case .love: "❤️"
        case .laugh: "😂"
        case .wow: "😮"
        case .sad: "😢"
        case .thanks: "🙏"
        }
    }

    /// Accessible name (picker buttons, chip labels).
    var name: LocalizedStringResource {
        switch self {
        case .like: LocalizedStringResource("Like", comment: "Reaction name (👍)")
        case .love: LocalizedStringResource("Love", comment: "Reaction name (❤️)")
        case .laugh: LocalizedStringResource("Haha", comment: "Reaction name (😂)")
        case .wow: LocalizedStringResource("Wow", comment: "Reaction name (😮)")
        case .sad: LocalizedStringResource("Sad", comment: "Reaction name (😢)")
        case .thanks: LocalizedStringResource("Thanks", comment: "Reaction name (🙏)")
        }
    }

    /// "Love: 3 reactions" (real plurals per language).
    func chipLabel(count: Int) -> String {
        String(localized: "\(String(localized: name)): \(count) reactions",
               comment: "Accessibility label of a reaction chip; the first argument is the reaction name, the second the count")
    }
}

/// Same names as report targets.
enum ReactionTargetType: String, Codable, Sendable {
    case chatMessage = "chat_message", event, foodPost = "food_post", marketItem = "market_item", sharedLink = "shared_link"
}

/// One row of `reactions` (only the columns clients read).
struct Reaction: Codable, Hashable, Sendable, Identifiable {
    let id: UUID
    let targetType: String
    let targetId: UUID
    let reaction: String
    let userId: UUID

    enum CodingKeys: String, CodingKey {
        case id, reaction
        case targetType = "target_type"
        case targetId = "target_id"
        case userId = "user_id"
    }

    static let selectColumns = "id, target_type, target_id, reaction, user_id"
}

/// Result of `toggle_reaction`: `reacted` is the new state; `id` the row added or removed.
struct ToggleReactionResult: Decodable, Hashable, Sendable {
    let id: UUID
    let reacted: Bool
    let reaction: String
    let targetType: String
    let targetId: UUID

    enum CodingKeys: String, CodingKey {
        case id, reacted, reaction
        case targetType = "target_type"
        case targetId = "target_id"
    }
}

/// A chip: one reaction kind on one target.
struct ReactionSummary: Hashable, Sendable, Identifiable {
    let kind: ReactionKind
    let count: Int
    let mine: Bool
    var id: ReactionKind { kind }
}

/// Pure, unit-tested state: the reaction rows held for one screen, indexed by target.
/// Every change is by row id, so the realtime echo of our own toggle changes nothing.
struct ReactionSet: Hashable, Sendable {
    private(set) var byTarget: [UUID: [Reaction]] = [:]
    private var targetOf: [UUID: UUID] = [:]

    var count: Int { targetOf.count }
    func contains(_ id: UUID) -> Bool { targetOf[id] != nil }

    /// A fresh load for these targets: their rows are replaced, others are kept.
    mutating func replace(targets: some Sequence<UUID>, with rows: [Reaction]) {
        for t in targets { dropTarget(t) }
        for r in rows { insert(r) }
    }

    /// Adds a row; returns false when it was already there (idempotent).
    @discardableResult
    mutating func insert(_ r: Reaction) -> Bool {
        guard targetOf[r.id] == nil else { return false }
        targetOf[r.id] = r.targetId
        byTarget[r.targetId, default: []].append(r)
        return true
    }

    /// Removes the row with this id; ids we don't hold (another bubble, another screen) change nothing.
    @discardableResult
    mutating func remove(id: UUID) -> Bool {
        guard let t = targetOf.removeValue(forKey: id) else { return false }
        byTarget[t]?.removeAll { $0.id == id }
        if byTarget[t]?.isEmpty == true { byTarget[t] = nil }
        return true
    }

    /// A deleted chat message (or a removed target) loses its reactions.
    mutating func dropTarget(_ target: UUID) {
        for r in byTarget.removeValue(forKey: target) ?? [] { targetOf[r.id] = nil }
    }

    /// Applies our own toggle result right away.
    mutating func apply(_ result: ToggleReactionResult, me: UUID) {
        if result.reacted {
            insert(Reaction(id: result.id, targetType: result.targetType, targetId: result.targetId,
                            reaction: result.reaction, userId: me))
        } else {
            remove(id: result.id)
        }
    }

    /// Chips for a target in the fixed order, only kinds with a count. Unknown keys are ignored.
    func summary(for target: UUID, me: UUID?) -> [ReactionSummary] {
        let rows = byTarget[target] ?? []
        guard !rows.isEmpty else { return [] }
        return ReactionKind.allCases.compactMap { kind in
            let matching = rows.filter { $0.reaction == kind.rawValue }
            guard !matching.isEmpty else { return nil }
            return ReactionSummary(kind: kind, count: matching.count, mine: me != nil && matching.contains { $0.userId == me })
        }
    }

    func reacted(_ kind: ReactionKind, on target: UUID, me: UUID?) -> Bool {
        guard let me else { return false }
        return byTarget[target]?.contains { $0.reaction == kind.rawValue && $0.userId == me } ?? false
    }
}

/// One screen's reactions (one target type). Loads, toggles and applies live changes.
@MainActor
@Observable
final class ReactionStore {
    let targetType: ReactionTargetType
    private(set) var set = ReactionSet()
    /// Toggles in flight, so a double tap doesn't send two.
    private var inFlight: Set<String> = []

    init(_ targetType: ReactionTargetType) { self.targetType = targetType }

    func summary(for target: UUID, me: UUID?) -> [ReactionSummary] { set.summary(for: target, me: me) }

    /// Reactions of these targets, in chunks of 100 ids; replaces what was held for them.
    func load(api: BoolaaAPI, bubbleID: UUID, targetIDs: [UUID]) async {
        guard !targetIDs.isEmpty else { return }
        do {
            let rows = try await api.reactions(bubbleID: bubbleID, targetType: targetType, targetIDs: targetIDs)
            set.replace(targets: targetIDs, with: rows)
        } catch {
            // Reactions are secondary: the list stays usable without them.
        }
    }

    /// Returns the user-facing error, if any, for the screen's error alert.
    @discardableResult
    func toggle(api: BoolaaAPI, target: UUID, kind: ReactionKind, me: UUID?) async -> String? {
        guard let me else { return nil }
        let key = "\(target)-\(kind.rawValue)"
        guard inFlight.insert(key).inserted else { return nil }
        defer { inFlight.remove(key) }
        do {
            let result = try await api.toggleReaction(targetType: targetType, targetID: target, kind: kind)
            set.apply(result, me: me)
            return nil
        } catch {
            return error.userMessage
        }
    }

    /// Live INSERT: kept only for this screen's type and a target the screen holds.
    func liveInsert(_ r: Reaction, holds: (UUID) -> Bool) {
        guard r.targetType == targetType.rawValue, holds(r.targetId) else { return }
        set.insert(r)
    }

    func liveDelete(id: UUID) { set.remove(id: id) }
    func dropTarget(_ target: UUID) { set.dropTarget(target) }
    func reset() { set = ReactionSet() }

    /// Adds the reactions INSERT (filtered by bubble, RLS-checked) and DELETE (by id) streams to a
    /// screen's channel. Call before `subscribe`; run the returned closure in the screen's task group.
    func streams(on channel: RealtimeChannelV2, bubbleID: UUID,
                 holds: @escaping @MainActor @Sendable (UUID) -> Bool) -> @Sendable () async -> Void {
        let inserts = channel.postgresChange(InsertAction.self, schema: "public", table: "reactions",
                                             filter: .eq("bubble_id", value: bubbleID))
        let deletes = channel.postgresChange(DeleteAction.self, schema: "public", table: "reactions")
        return { [weak self] in
            await withTaskGroup(of: Void.self) { group in
                group.addTask {
                    for await action in inserts {
                        guard let r = try? action.decodeRecord(as: Reaction.self, decoder: BoolaaJSON.decoder) else { continue }
                        await MainActor.run { self?.liveInsert(r, holds: holds) }
                    }
                }
                group.addTask {
                    for await action in deletes {
                        guard let id = LiveChanges.id(of: action.oldRecord) else { continue }
                        await MainActor.run { self?.liveDelete(id: id) }
                    }
                }
            }
        }
    }
}

extension BoolaaAPI {
    static let reactionChunk = 100

    func reactions(bubbleID: UUID, targetType: ReactionTargetType, targetIDs: [UUID]) async throws -> [Reaction] {
        var all: [Reaction] = []
        for start in stride(from: 0, to: targetIDs.count, by: Self.reactionChunk) {
            let chunk = Array(targetIDs[start..<min(start + Self.reactionChunk, targetIDs.count)])
            let rows: [Reaction] = try await client.from("reactions")
                .select(Reaction.selectColumns)
                .eq("bubble_id", value: bubbleID)
                .eq("target_type", value: targetType.rawValue)
                .in("target_id", values: chunk)
                .execute().value
            all += rows
        }
        return all
    }

    /// Raises "invalid reaction" / "reaction target not found" (shown as the generic error).
    func toggleReaction(targetType: ReactionTargetType, targetID: UUID, kind: ReactionKind) async throws -> ToggleReactionResult {
        struct Params: Encodable { let p_target_type: String; let p_target_id: UUID; let p_reaction: String }
        return try await client.rpc("toggle_reaction",
                                    params: Params(p_target_type: targetType.rawValue, p_target_id: targetID, p_reaction: kind.rawValue))
            .execute().value
    }
}
