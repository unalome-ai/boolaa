import Foundation
import Supabase
import Testing
@testable import Boolaa

/// Reactions and link preview columns against the local backend
/// (20261123160000_reactions_link_previews.sql). A throwaway bubble owned by Alice and joined by Bob;
/// both leave at the end, which deletes the bubble and everything in it.
@Suite("Reactions (local backend)", .serialized)
struct ReactionsIntegrationTests {
    private func signedInAPI(_ email: String) async throws -> BoolaaAPI {
        let client = Backend.makeClient(config: try AppConfig.load(), authStorage: InMemoryAuthStorage())
        try await client.auth.signIn(email: email, password: "password123")
        return BoolaaAPI(client: client)
    }

    @MainActor
    private func eventually(_ timeout: Duration = .seconds(10), _ check: @MainActor () -> Bool) async -> Bool {
        let clock = ContinuousClock(), deadline = clock.now.advanced(by: timeout)
        while clock.now < deadline {
            if check() { return true }
            try? await Task.sleep(for: .milliseconds(100))
        }
        return check()
    }

    @MainActor
    @Test(.timeLimit(.minutes(2)))
    func toggleLoadLiveAndDeletedMessage() async throws {
        let alice = try await signedInAPI("alice@boolaa.test")
        let bob = try await signedInAPI("bob@boolaa.test")
        let bubble = try await alice.createBubble(name: "zz react \(UUID().uuidString.prefix(6))", description: nil, maxSize: 4)
        let request = try await bob.requestToJoin(inviteCode: bubble.inviteCode)
        _ = try await alice.approveJoinRequest(id: request.id)
        defer {
            Task {
                try? await bob.leaveBubble(bubbleID: bubble.id, userID: Seed.bob)
                try? await alice.leaveBubble(bubbleID: bubble.id, userID: Seed.alice)
            }
        }

        // A new link starts with a pending preview; the client decodes the new columns.
        try await alice.createLink(LinkInput(bubbleId: bubble.id, userId: Seed.alice, url: "https://example.com/react", title: "x", tags: []))
        let link = try #require(try await alice.links(bubbleID: bubble.id).first)
        #expect(link.previewStatus == "pending" || link.previewStatus == "fetching" || link.previewStatus == "failed" || link.previewStatus == "ready")

        // Alice's store listens like the Links screen does.
        let store = ReactionStore(.sharedLink)
        let channel = alice.client.realtimeV2.channel("shared_links:\(bubble.id.uuidString.lowercased())")
        let run = store.streams(on: channel, bubbleID: bubble.id, holds: { $0 == link.id })
        try await channel.subscribeWithError()
        let listener = Task { await run() }
        defer { listener.cancel(); Task { await alice.client.realtimeV2.removeChannel(channel) } }
        try await Task.sleep(for: .seconds(1.5))

        let on = try await bob.toggleReaction(targetType: .sharedLink, targetID: link.id, kind: .love)
        #expect(on.reacted)
        #expect(await eventually { store.summary(for: link.id, me: Seed.alice) == [ReactionSummary(kind: .love, count: 1, mine: false)] },
                "Bob's reaction arrives live")
        await store.load(api: alice, bubbleID: bubble.id, targetIDs: [link.id])
        #expect(store.summary(for: link.id, me: Seed.alice).first?.count == 1, "load agrees")

        let off = try await bob.toggleReaction(targetType: .sharedLink, targetID: link.id, kind: .love)
        #expect(!off.reacted && off.id == on.id)
        #expect(await eventually { store.summary(for: link.id, me: Seed.alice).isEmpty }, "the DELETE (id only) removes it")

        // Own toggle through the store; reacting to a deleted message is refused.
        let error = await store.toggle(api: alice, target: link.id, kind: .thanks, me: Seed.alice)
        #expect(error == nil)
        #expect(store.summary(for: link.id, me: Seed.alice) == [ReactionSummary(kind: .thanks, count: 1, mine: true)])
        let message = try await bob.sendMessage(bubbleID: bubble.id, senderID: Seed.bob, content: "react to me")
        _ = try await alice.toggleReaction(targetType: .chatMessage, targetID: message.id, kind: .laugh)
        _ = try await bob.deleteChatMessage(id: message.id)
        #expect(try await alice.reactions(bubbleID: bubble.id, targetType: .chatMessage, targetIDs: [message.id]).isEmpty)
        await #expect(throws: (any Error).self) {
            _ = try await alice.toggleReaction(targetType: .chatMessage, targetID: message.id, kind: .laugh)
        }
        listener.cancel()
        await alice.client.realtimeV2.removeChannel(channel)
        try? await bob.leaveBubble(bubbleID: bubble.id, userID: Seed.bob)
        try? await alice.leaveBubble(bubbleID: bubble.id, userID: Seed.alice)
    }
}
