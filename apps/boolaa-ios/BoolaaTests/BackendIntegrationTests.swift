import Foundation
import Supabase
import Testing
@testable import Boolaa

/// Runs against the local Supabase stack (`supabase start`, API on 127.0.0.1:55321).
/// Uses its own client with in-memory session storage, so it never touches the app's Keychain session.
@Suite("Local backend (as Alice)", .serialized)
struct BackendIntegrationTests {
    let client: SupabaseClient
    let api: BoolaaAPI

    init() throws {
        client = Backend.makeClient(config: try AppConfig.load(), authStorage: InMemoryAuthStorage())
        api = BoolaaAPI(client: client)
    }

    private func signInAlice() async throws -> UUID {
        let session = try await client.auth.signIn(email: "alice@boolaa.test", password: "password123")
        return session.user.id
    }

    @Test func loadsBubblesAndFlatmatesChat() async throws {
        let me = try await signInAlice()
        #expect(me == Seed.alice)

        let profile = try await api.profile(userID: me)
        #expect(profile.name == "Alice")

        let memberships = try await api.memberships(userID: me)
        let names = Set(memberships.compactMap(\.bubble?.name))
        #expect(names.isSuperset(of: ["Flatmates", "Climbing Crew"]))

        let flatmates = try #require(memberships.first { $0.bubble?.name == "Flatmates" }?.bubble)
        let chat = try await api.chatMessages(bubbleID: flatmates.id)
        #expect(chat.count >= 2)
        #expect(chat.allSatisfy { $0.bubbleId == flatmates.id && $0.sender != nil })
        #expect(chat.contains { $0.content.contains("oat milk") })
        #expect(zip(chat, chat.dropFirst()).allSatisfy { $0.createdAt <= $1.createdAt })

        // Other sections decode too.
        _ = try await api.events(bubbleID: flatmates.id)
        _ = try await api.foodPosts(bubbleID: flatmates.id)
        _ = try await api.marketItems(bubbleID: flatmates.id)
        _ = try await api.links(bubbleID: flatmates.id)
        let members = try await api.members(bubbleID: flatmates.id)
        #expect(members.contains { $0.userId == me && $0.role == .owner })
        let requests = try await api.joinRequests(bubbleID: flatmates.id)
        #expect(requests.contains { $0.user?.name == "Carol" })

        try await client.auth.signOut()
    }

    @Test func rpcErrorsMapToUserFacingErrors() async throws {
        _ = try await signInAlice()
        do {
            _ = try await api.requestToJoin(inviteCode: "NOPE0000")
            Issue.record("expected 'invalid invite code'")
        } catch {
            #expect(UserFacingError.classify(error) == .invalidInviteCode)
        }
        do {
            _ = try await api.requestToJoin(inviteCode: "FLAT2026")
            Issue.record("expected 'already a member'")
        } catch {
            #expect(UserFacingError.classify(error) == .alreadyMember)
        }
        try await client.auth.signOut()
    }

    @Test(.timeLimit(.minutes(1)))
    func realtimeDeliversInsert() async throws {
        let me = try await signInAlice()
        let channel = client.realtimeV2.channel("test-chat-\(UUID().uuidString.lowercased())")
        let inserts = channel.postgresChange(InsertAction.self, schema: "public", table: "chat_messages",
                                             filter: .eq("bubble_id", value: Seed.climbing))
        try await channel.subscribeWithError()
        try await Task.sleep(for: .milliseconds(500))

        let text = "integration test \(UUID().uuidString.prefix(8))"
        let sent = try await api.sendMessage(bubbleID: Seed.climbing, senderID: me, content: text)

        var received: ChatMessage?
        for await action in inserts {
            let message = try action.decodeRecord(as: ChatMessage.self, decoder: BoolaaJSON.decoder)
            if message.id == sent.id { received = message; break }
        }
        #expect(received?.content == text)
        #expect(received?.senderId == me)

        await client.realtimeV2.removeChannel(channel)
        try await client.from("chat_messages").delete().eq("id", value: sent.id).execute()
        try await client.auth.signOut()
    }
}
