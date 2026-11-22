import Foundation
import Supabase
import Testing
@testable import Boolaa

/// Blocks, reports and account deletion (migration 20261122140000) against the local backend.
/// Blocks are undone, reports carry a "zz test" marker so they can be purged, and the deleted
/// account is a throwaway sign-up, so seeded data is left as it was.
@Suite("Safety and account (local backend)", .serialized)
struct SafetyIntegrationTests {
    private func client() throws -> SupabaseClient {
        Backend.makeClient(config: try AppConfig.load(), authStorage: InMemoryAuthStorage())
    }

    private func signedInAPI(_ email: String) async throws -> BoolaaAPI {
        let client = try client()
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

    @Test func blockHidesMessagesUntilUnblocked() async throws {
        let alice = try await signedInAPI("alice@boolaa.test")
        let fromBob = { try await alice.chatMessages(bubbleID: Seed.flatmates).filter { $0.senderId == Seed.bob } }
        let before = try await fromBob()
        try #require(!before.isEmpty, "seed should have Bob's Flatmates messages")

        try await alice.block(userID: Seed.bob, me: Seed.alice)
        do {
            #expect(try await alice.blockedUsers().map(\.blockedId) == [Seed.bob])
            #expect(try await fromBob().isEmpty, "a blocked user's messages are hidden by RLS")
        } catch {
            try? await alice.unblock(userID: Seed.bob, me: Seed.alice)
            throw error
        }
        try await alice.unblock(userID: Seed.bob, me: Seed.alice)
        #expect(try await alice.blockedUsers().isEmpty)
        #expect(try await fromBob().count == before.count)
    }

    @Test func reportReturnsIdAndMapsErrors() async throws {
        let alice = try await signedInAPI("alice@boolaa.test")
        let messages = try await alice.chatMessages(bubbleID: Seed.flatmates)
        let bobs = try #require(messages.last { $0.senderId == Seed.bob })
        let mine = try #require(messages.last { $0.senderId == Seed.alice })

        let reportID = try await alice.report(.message(bobs), reason: .spam, details: "zz test \(UUID().uuidString)")
        #expect(reportID != UUID(uuidString: "00000000-0000-0000-0000-000000000000"))

        await expectMapped(.cannotReportSelf) { _ = try await alice.report(.message(mine), reason: .other, details: nil) }
        let ghost = ReportTarget(type: .chatMessage, targetID: UUID(), author: nil, authorID: Seed.bob)
        await expectMapped(.reportTargetNotFound) { _ = try await alice.report(ghost, reason: .other, details: nil) }
    }

    @Test(.timeLimit(.minutes(1)))
    func deleteMyAccountRemovesFilesAndUser() async throws {
        let client = try client()
        let email = "zz-delete-\(UUID().uuidString.prefix(8).lowercased())@boolaa.test"
        let password = "throwaway-\(UUID().uuidString)"
        let signUp = try await client.auth.signUp(email: email, password: password, data: ["name": .string("Throwaway")])
        let userID = try #require(signUp.session?.user.id, "local auth has email confirmations off")
        let api = BoolaaAPI(client: client)

        // One uploaded file in each bucket.
        let jpeg = try ImageCompression.jpeg(from: Self.tinyPNG, maxSide: 8, quality: 0.5)
        var urls: [String] = []
        for bucket in BoolaaAPI.userBuckets { urls.append(try await api.uploadImage(jpeg, bucket: bucket, userID: userID)) }
        for url in urls { #expect(await Self.status(of: url) == 200, "uploaded file is public") }

        try await api.deleteMyAccount(userID: userID)

        for url in urls { #expect(await Self.status(of: url) != 200, "file under <uid>/ was removed: \(url)") }
        let again = try self.client()
        await expectMapped(.invalidCredentials) { try await again.auth.signIn(email: email, password: password) }
    }

    private static func status(of url: String) async -> Int {
        guard let url = URL(string: url) else { return -1 }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData)
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        guard let (_, response) = try? await URLSession(configuration: .ephemeral).data(for: request) else { return -1 }
        return (response as? HTTPURLResponse)?.statusCode ?? -1
    }

    /// 1x1 PNG.
    private static let tinyPNG = Data(base64Encoded:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")!
}
