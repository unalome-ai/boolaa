import Foundation
import Supabase
import Testing
@testable import Boolaa

/// Membership fixes (migration 20261122120000) against the local backend.
/// Uses a throwaway bubble owned by Alice and joined by Bob; leaving it at the end deletes it
/// (after_member_removed drops empty bubbles), so seeded data is untouched.
@Suite("Membership fixes (local backend)", .serialized)
struct MembershipIntegrationTests {
    private func signedInAPI(_ email: String) async throws -> BoolaaAPI {
        let client = Backend.makeClient(config: try AppConfig.load(), authStorage: InMemoryAuthStorage())
        try await client.auth.signIn(email: email, password: "password123")
        return BoolaaAPI(client: client)
    }

    private func expectMapped(_ expected: UserFacingError, _ body: () async throws -> Void) async {
        do {
            try await body()
            Issue.record("expected \(expected)")
        } catch {
            #expect(UserFacingError.classify(error) == expected)
        }
    }

    /// Waits for the first element of `stream` matching `predicate`, or nil after `timeout`.
    private func first<S: AsyncSequence & Sendable>(
        _ stream: S, within timeout: Duration = .seconds(10), where predicate: @escaping @Sendable (S.Element) -> Bool
    ) async -> S.Element? where S.Element: Sendable {
        await withTaskGroup(of: S.Element?.self) { group in
            group.addTask {
                do { for try await element in stream where predicate(element) { return element } } catch {}
                return nil
            }
            group.addTask { try? await Task.sleep(for: timeout); return nil }
            let result = await group.next() ?? nil
            group.cancelAll()
            return result
        }
    }

    @Test(.timeLimit(.minutes(1)))
    func removeMemberAndRealtimeForSelf() async throws {
        let alice = try await signedInAPI("alice@boolaa.test")
        let bob = try await signedInAPI("bob@boolaa.test")
        let aliceID = Seed.alice, bobID = Seed.bob

        let bubble = try await alice.createBubble(name: "zz test \(UUID().uuidString.prefix(6))", description: nil, maxSize: 4)
        defer {
            // Cleanup even if an expectation fails: Bob leaves (if still in), Alice leaves -> bubble deleted.
            let alice = alice, bob = bob
            Task {
                try? await bob.leaveBubble(bubbleID: bubble.id, userID: bobID)
                try? await bob.cancelJoinRequestsFor(bubbleID: bubble.id, userID: bobID)
                try? await alice.leaveBubble(bubbleID: bubble.id, userID: aliceID)
            }
        }

        // Bob listens to his own membership rows, as SessionStore does.
        let channel = bob.client.realtimeV2.channel("test-membership-\(UUID().uuidString.lowercased())")
        let inserts = channel.postgresChange(InsertAction.self, schema: "public", table: "bubble_members",
                                             filter: .eq("user_id", value: bobID))
        let deletes = channel.postgresChange(DeleteAction.self, schema: "public", table: "bubble_members")
        try await channel.subscribeWithError()
        try await Task.sleep(for: .milliseconds(500))

        // Bob asks to join; Alice (the only member) approves -> admitted.
        let request = try await bob.requestToJoin(inviteCode: bubble.inviteCode)
        #expect(try await alice.approveJoinRequest(id: request.id))

        let inserted = await first(inserts) { LiveChanges.record($0.record, "bubble_id", is: bubble.id) }
        #expect(inserted != nil, "Bob should receive his own bubble_members INSERT")
        if let inserted { #expect(LiveChanges.record(inserted.record, "user_id", is: bobID)) }

        // Owner-only and self-removal errors map to user-facing errors.
        await expectMapped(.ownerOnlyRemove) { try await bob.removeMember(bubbleID: bubble.id, userID: aliceID) }
        await expectMapped(.removeSelf) { try await alice.removeMember(bubbleID: bubble.id, userID: aliceID) }

        // The owner removes Bob; Bob sees his row disappear live.
        try await alice.removeMember(bubbleID: bubble.id, userID: bobID)
        let removed = await first(deletes) {
            LiveChanges.record($0.oldRecord, "user_id", is: bobID) && LiveChanges.record($0.oldRecord, "bubble_id", is: bubble.id)
        }
        #expect(removed != nil, "Bob should receive the DELETE of his own membership")
        #expect(try await bob.memberships(userID: bobID).allSatisfy { $0.bubbleId != bubble.id })
        await expectMapped(.memberNotFound) { try await alice.removeMember(bubbleID: bubble.id, userID: bobID) }

        await bob.client.realtimeV2.removeChannel(channel)

        // Alice leaves: the empty bubble is deleted (nothing left behind).
        try await alice.leaveBubble(bubbleID: bubble.id, userID: aliceID)
        #expect(try await alice.memberships(userID: aliceID).allSatisfy { $0.bubbleId != bubble.id })
    }
}

private extension BoolaaAPI {
    func cancelJoinRequestsFor(bubbleID: UUID, userID: UUID) async throws {
        try await client.from("join_requests").delete().eq("bubble_id", value: bubbleID).eq("user_id", value: userID).execute()
    }
}
