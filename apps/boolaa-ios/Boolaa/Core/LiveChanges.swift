import Foundation
import Supabase

/// Subscribes to Postgres changes on several tables over one realtime channel.
///
/// INSERT and UPDATE are filtered server-side (and RLS-checked). Realtime cannot filter DELETE
/// events and their `old_record` only carries the primary key, so deletes are matched client-side
/// with `deleteMatches`.
enum LiveChanges {
    struct Watch: Sendable {
        var table: String
        /// INSERT/UPDATE filter `column=eq.value` (RealtimePostgresFilter itself isn't Sendable).
        var column: String
        var equals: UUID
        var deleteMatches: @Sendable ([String: AnyJSON]) async -> Bool
    }

    /// Calls `onChange` for every matching event until the calling task is cancelled.
    static func observe(
        _ client: SupabaseClient,
        topic: String,
        watches: [Watch],
        onSubscribed: @escaping @MainActor @Sendable () -> Void = {},
        onChange: @escaping @MainActor @Sendable () -> Void
    ) async {
        let channel = client.realtimeV2.channel(topic)
        var streams: [(AsyncStream<InsertAction>, AsyncStream<UpdateAction>, AsyncStream<DeleteAction>, Watch)] = []
        for watch in watches {
            let filter = RealtimePostgresFilter.eq(watch.column, value: watch.equals)
            streams.append((
                channel.postgresChange(InsertAction.self, schema: "public", table: watch.table, filter: filter),
                channel.postgresChange(UpdateAction.self, schema: "public", table: watch.table, filter: filter),
                channel.postgresChange(DeleteAction.self, schema: "public", table: watch.table),
                watch
            ))
        }
        do {
            try await channel.subscribeWithError()
            await onSubscribed()
        } catch {
            // Pull-to-refresh still works when realtime is unavailable.
        }
        await withTaskGroup(of: Void.self) { group in
            for (inserts, updates, deletes, watch) in streams {
                group.addTask { for await _ in inserts { await onChange() } }
                group.addTask { for await _ in updates { await onChange() } }
                group.addTask {
                    for await action in deletes where await watch.deleteMatches(action.oldRecord) { await onChange() }
                }
            }
        }
        await client.realtimeV2.removeChannel(channel)
    }

    /// True when `record[column]` is the given UUID.
    static func record(_ record: [String: AnyJSON], _ column: String, is id: UUID) -> Bool {
        if case .string(let value)? = record[column] { return UUID(uuidString: value) == id }
        return false
    }

    static func id(of record: [String: AnyJSON]) -> UUID? {
        if case .string(let value)? = record["id"] { return UUID(uuidString: value) }
        return nil
    }
}

/// Coalesces bursts of realtime events (an approval can fire UPDATE + INSERT + DELETE) into one reload.
@MainActor
final class ReloadCoalescer {
    private var task: Task<Void, Never>?
    func schedule(after delay: Duration = .milliseconds(250), _ work: @escaping @MainActor () async -> Void) {
        task?.cancel()
        task = Task {
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            await work()
        }
    }
    func cancel() { task?.cancel() }
}
