import Foundation
import Supabase

/// A row of a bubble feed that streams over Realtime (events + RSVPs, food, market, links;
/// supabase/migrations/20261123110000_realtime_feeds.sql).
protocol FeedRow: Decodable, Identifiable, Hashable, Sendable where ID == UUID {
    static var table: String { get }
    /// `select` for one row with its joined author, as the list loads it.
    static var selectColumns: String { get }
    /// The joined author; a realtime payload never has it.
    var author: UserProfile? { get set }
    /// List order.
    static func precedes(_ a: Self, _ b: Self) -> Bool
}

extension BubbleEvent: FeedRow {
    static let table = "events"
    static let selectColumns = "*, creator:users!creator_id(\(BoolaaAPI.authorColumns))"
    var author: UserProfile? { get { creator } set { creator = newValue } }
    static func precedes(_ a: Self, _ b: Self) -> Bool {
        a.datetime != b.datetime ? a.datetime < b.datetime : a.id.uuidString < b.id.uuidString
    }
}

extension FoodPost: FeedRow {
    static let table = "food_posts"
    static let selectColumns = "*, user:users!user_id(\(BoolaaAPI.authorColumns))"
    var author: UserProfile? { get { user } set { user = newValue } }
    static func precedes(_ a: Self, _ b: Self) -> Bool { FeedMerge.newestFirst(a.createdAt, a.id, b.createdAt, b.id) }
}

extension MarketItem: FeedRow {
    static let table = "market_items"
    static let selectColumns = "*, owner:users!owner_id(\(BoolaaAPI.authorColumns))"
    var author: UserProfile? { get { owner } set { owner = newValue } }
    /// Taken items sink to the end; otherwise newest first (docs/boolaa-spec.md, Marketplace).
    static func precedes(_ a: Self, _ b: Self) -> Bool {
        let aTaken = a.availability == .taken, bTaken = b.availability == .taken
        if aTaken != bTaken { return bTaken }
        return FeedMerge.newestFirst(a.createdAt, a.id, b.createdAt, b.id)
    }
}

extension SharedLink: FeedRow {
    static let table = "shared_links"
    static let selectColumns = "*, user:users!user_id(\(BoolaaAPI.authorColumns))"
    var author: UserProfile? { get { user } set { user = newValue } }
    static func precedes(_ a: Self, _ b: Self) -> Bool { FeedMerge.newestFirst(a.createdAt, a.id, b.createdAt, b.id) }
}

/// Pure merge rules for live feed changes (unit-tested; same cases as web and Android).
enum FeedMerge {
    /// Inserts or replaces `row` by id, keeping the list order. A missing author is kept from the
    /// row already in the list. Returns `rows` unchanged when nothing differs (the echo of our own
    /// write), so SwiftUI has nothing to animate.
    static func upsert<T: FeedRow>(_ rows: [T], _ row: T) -> [T] {
        var row = row
        if let idx = rows.firstIndex(where: { $0.id == row.id }) {
            if row.author == nil { row.author = rows[idx].author }
            if rows[idx] == row { return rows }
            var next = rows
            next[idx] = row
            return next.sorted(by: T.precedes)
        }
        return (rows + [row]).sorted(by: T.precedes)
    }

    /// Removes the row with `id`; ids we don't hold (another bubble's delete) change nothing.
    static func remove<T: FeedRow>(_ rows: [T], id: UUID) -> [T] {
        rows.contains { $0.id == id } ? rows.filter { $0.id != id } : rows
    }

    static func newestFirst(_ aDate: Date, _ aID: UUID, _ bDate: Date, _ bID: UUID) -> Bool {
        aDate != bDate ? aDate > bDate : aID.uuidString < bID.uuidString
    }
}

/// Keeps one feed list live for the current bubble until the calling task is cancelled (the view
/// disappears, the bubble changes, sign-out). INSERT/UPDATE are filtered by `bubble_id` and
/// RLS-checked by Realtime, so blocked authors and unverified sessions get nothing. DELETE only
/// carries the id and can't be filtered: it removes by id. New rows are fetched once with their
/// author (RLS decides again).
enum LiveFeed {
    static func observe<T: FeedRow>(
        _ type: T.Type,
        api: BoolaaAPI,
        bubbleID: UUID,
        rows: @escaping @MainActor @Sendable () -> [T],
        apply: @escaping @MainActor @Sendable ([T]) -> Void,
        reload: @escaping @MainActor @Sendable () async -> Void,
        reactions: ReactionStore? = nil
    ) async {
        let client = api.client
        let channel = client.realtimeV2.channel("\(T.table):\(bubbleID.uuidString.lowercased())")
        let filter = RealtimePostgresFilter.eq("bubble_id", value: bubbleID)
        let inserts = channel.postgresChange(InsertAction.self, schema: "public", table: T.table, filter: filter)
        let updates = channel.postgresChange(UpdateAction.self, schema: "public", table: T.table, filter: filter)
        let deletes = channel.postgresChange(DeleteAction.self, schema: "public", table: T.table)
        // Reactions on this screen's rows ride on the same channel (docs/boolaa-spec.md, "Reactions").
        let reactionStreams = await reactions?.streams(on: channel, bubbleID: bubbleID,
                                                       holds: { id in rows().contains { $0.id == id } })

        @Sendable func fetchAndMerge(_ id: UUID) async {
            guard let row = try? await api.feedRow(T.self, id: id) else { return }
            await MainActor.run { apply(FeedMerge.upsert(rows(), row)) }
        }

        do {
            try await channel.subscribeWithError()
            // Catch whatever changed between the first load and the subscription.
            await reload()
        } catch {
            // Pull-to-refresh still works when realtime is unavailable.
        }
        await withTaskGroup(of: Void.self) { group in
            if let reactionStreams { group.addTask { await reactionStreams() } }
            group.addTask {
                for await action in inserts {
                    if let id = LiveChanges.id(of: action.record) { await fetchAndMerge(id) }
                }
            }
            group.addTask {
                for await action in updates {
                    guard let id = LiveChanges.id(of: action.record) else { continue }
                    let known = await MainActor.run { rows().contains { $0.id == id } }
                    if known, let row = try? action.decodeRecord(as: T.self, decoder: BoolaaJSON.decoder) {
                        await MainActor.run { apply(FeedMerge.upsert(rows(), row)) }
                    } else {
                        await fetchAndMerge(id)
                    }
                }
            }
            group.addTask {
                for await action in deletes {
                    guard let id = LiveChanges.id(of: action.oldRecord) else { continue }
                    await MainActor.run { apply(FeedMerge.remove(rows(), id: id)) }
                }
            }
        }
        await client.realtimeV2.removeChannel(channel)
    }
}

extension BoolaaAPI {
    /// One feed row with its author, or nil when RLS hides it / it is gone.
    func feedRow<T: FeedRow>(_ type: T.Type, id: UUID) async throws -> T? {
        let rows: [T] = try await client.from(T.table)
            .select(T.selectColumns)
            .eq("id", value: id)
            .limit(1)
            .execute().value
        return rows.first
    }
}
