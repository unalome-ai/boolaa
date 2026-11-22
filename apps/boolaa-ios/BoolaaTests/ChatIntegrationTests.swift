import Foundation
import Supabase
import Testing
@testable import Boolaa

/// Chat improvements against the local backend (20261123120000_chat_improvements.sql): pages, unread
/// counts and the read marker, photos in the private bucket, deleting your own message (live UPDATE).
/// Everything happens in a throwaway bubble owned by Alice and joined by Bob; both leave at the end,
/// which deletes the bubble and its messages, so seeded data is untouched.
@Suite("Chat (local backend)", .serialized)
struct ChatIntegrationTests {
    private func signedInAPI(_ email: String) async throws -> BoolaaAPI {
        let client = Backend.makeClient(config: try AppConfig.load(), authStorage: InMemoryAuthStorage())
        try await client.auth.signIn(email: email, password: "password123")
        return BoolaaAPI(client: client)
    }

    /// Alice's new bubble with Bob admitted.
    private func bubbleWithBob(alice: BoolaaAPI, bob: BoolaaAPI) async throws -> Bubble {
        let bubble = try await alice.createBubble(name: "zz chat \(UUID().uuidString.prefix(6))", description: nil, maxSize: 4)
        let request = try await bob.requestToJoin(inviteCode: bubble.inviteCode)
        _ = try await alice.approveJoinRequest(id: request.id)
        return bubble
    }

    private func cleanUp(_ bubble: Bubble, alice: BoolaaAPI, bob: BoolaaAPI) async {
        try? await bob.leaveBubble(bubbleID: bubble.id, userID: Seed.bob)
        try? await alice.leaveBubble(bubbleID: bubble.id, userID: Seed.alice)
    }

    private func status(of url: URL) async -> Int {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData)
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        guard let (_, response) = try? await URLSession(configuration: .ephemeral).data(for: request) else { return -1 }
        return (response as? HTTPURLResponse)?.statusCode ?? -1
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

    @Test(.timeLimit(.minutes(2)))
    func pagesUnreadCountsAndReadMarker() async throws {
        let alice = try await signedInAPI("alice@boolaa.test")
        let bob = try await signedInAPI("bob@boolaa.test")
        let bubble = try await bubbleWithBob(alice: alice, bob: bob)
        do {
            // 55 messages from Alice: one full page and a short one.
            var sent: [ChatMessage] = []
            for i in 1...55 { sent.append(try await alice.sendMessage(bubbleID: bubble.id, senderID: Seed.alice, content: "m\(i)")) }

            let newest = try await bob.chatPage(bubbleID: bubble.id, beforeID: nil)
            #expect(newest.count == 50)
            #expect(!ChatTimeline.reachedStart(pageCount: newest.count))
            #expect(newest.map(\.content) == (6...55).map { "m\($0)" }, "chronological, newest page")
            #expect(newest.allSatisfy { $0.sender?.name == "Alice" }, "sender embedded")

            let older = try await bob.chatPage(bubbleID: bubble.id, beforeID: try #require(newest.first?.id))
            #expect(older.map(\.content) == (1...5).map { "m\($0)" })
            #expect(ChatTimeline.reachedStart(pageCount: older.count))
            let all = ChatTimeline.prepend(newest, olderPage: older)
            #expect(all.map(\.id) == sent.map(\.id), "no gaps or repeats across pages")

            // Bob: everything since he joined is unread; Alice's own messages never count for her.
            let bobBefore = try #require(try await bob.chatUnreadCounts().first { $0.bubbleId == bubble.id })
            #expect(bobBefore.unreadCount == 55)
            #expect(ChatTimeline.dividerID(all, lastReadAt: bobBefore.lastReadAt, me: Seed.bob) == sent.first?.id)
            #expect(try await alice.chatUnreadCounts().first { $0.bubbleId == bubble.id }?.unreadCount == 0)

            // Marking read up to message 50, then trying to move the marker back.
            let marker = try await bob.markChatRead(bubbleID: bubble.id, messageID: sent[49].id)
            #expect(marker != nil)
            #expect(try await bob.chatUnreadCounts().first { $0.bubbleId == bubble.id }?.unreadCount == 5)
            try await bob.markChatRead(bubbleID: bubble.id, messageID: sent[0].id)
            let after = try #require(try await bob.chatUnreadCounts().first { $0.bubbleId == bubble.id })
            #expect(after.unreadCount == 5, "the marker never moves back")
            #expect(ChatTimeline.dividerID(all, lastReadAt: after.lastReadAt, me: Seed.bob) == sent[50].id)
            try await bob.markChatRead(bubbleID: bubble.id, messageID: sent[54].id)
            #expect(try await bob.chatUnreadCounts().first { $0.bubbleId == bubble.id }?.unreadCount == 0)

            do {
                try await bob.markChatRead(bubbleID: bubble.id, messageID: UUID())
                Issue.record("expected 'message not found'")
            } catch { #expect(UserFacingError.classify(error) == .chatMessageGone) }
        } catch {
            await cleanUp(bubble, alice: alice, bob: bob)
            throw error
        }
        await cleanUp(bubble, alice: alice, bob: bob)
    }

    @Test(.timeLimit(.minutes(1)))
    func photoMessageSignedURLAndDeletion() async throws {
        let alice = try await signedInAPI("alice@boolaa.test")
        let bob = try await signedInAPI("bob@boolaa.test")
        let bubble = try await bubbleWithBob(alice: alice, bob: bob)
        var uploaded: String?
        do {
            // Bob listens to the chat as ChatView does (INSERT + UPDATE, filtered by bubble).
            let channel = bob.client.realtimeV2.channel("test-chat-\(UUID().uuidString.lowercased())")
            let updates = channel.postgresChange(UpdateAction.self, schema: "public", table: "chat_messages",
                                                 filter: .eq("bubble_id", value: bubble.id))
            try await channel.subscribeWithError()
            try await Task.sleep(for: .milliseconds(500))

            // Photo without a caption.
            let jpeg = try ImageCompression.jpeg(from: Self.tinyPNG, for: .chat)
            let path = try await alice.uploadChatImage(jpeg, userID: Seed.alice)
            uploaded = path
            #expect(path.hasPrefix(Seed.alice.uuidString.lowercased() + "/") && path.hasSuffix(".jpg"))
            let photo = try await alice.sendMessage(bubbleID: bubble.id, senderID: Seed.alice, content: "", imagePath: path)
            #expect(photo.imagePath == path && photo.content.isEmpty)

            // The bucket is private: Bob (a member) reads it through a signed URL only.
            let signed = try await bob.signedChatImageURLs(paths: [path])
            let url = try #require(signed[path])
            #expect(await status(of: url) == 200)
            let publicURL = try bob.client.storage.from("chat.images").getPublicURL(path: path)
            #expect(await status(of: publicURL) != 200, "no public access")

            // Only the author can delete.
            do {
                _ = try await bob.deleteChatMessage(id: photo.id)
                Issue.record("Bob deleted Alice's message")
            } catch { #expect(UserFacingError.classify(error) == .chatMessageGone) }

            // Alice deletes: the RPC names the photo to remove, Bob sees the placeholder live.
            let toRemove = try await alice.deleteChatMessage(id: photo.id)
            #expect(toRemove == path)
            await alice.removeChatImage(path: toRemove, userID: Seed.alice)
            uploaded = nil
            let update = await first(updates) { LiveChanges.id(of: $0.record) == photo.id }
            let live = try #require(try update.map { try $0.decodeRecord(as: ChatMessage.self, decoder: BoolaaJSON.decoder) })
            #expect(live.isDeleted && live.imagePath == nil && live.content.isEmpty)
            #expect(ChatTimeline.applyUpdate([photo], live).first?.isDeleted == true)
            await bob.client.realtimeV2.removeChannel(channel)

            // Access is gone, deleting again is a no-op, Home skips it, the page keeps the placeholder.
            #expect(try await bob.signedChatImageURLs(paths: [path])[path] == nil)
            #expect(try await alice.deleteChatMessage(id: photo.id) == nil)
            #expect(try await bob.chatMessages(bubbleID: bubble.id, limit: 5, includeDeleted: false).allSatisfy { $0.id != photo.id })
            #expect(try await bob.chatPage(bubbleID: bubble.id, beforeID: nil).first { $0.id == photo.id }?.isDeleted == true)

            // A photo that was never uploaded is refused.
            do {
                _ = try await alice.sendMessage(bubbleID: bubble.id, senderID: Seed.alice, content: "",
                                                imagePath: BoolaaAPI.chatImagePath(userID: Seed.alice))
                Issue.record("insert with a missing photo was accepted")
            } catch {}
        } catch {
            await alice.removeChatImage(path: uploaded, userID: Seed.alice)
            await cleanUp(bubble, alice: alice, bob: bob)
            throw error
        }
        await cleanUp(bubble, alice: alice, bob: bob)
    }

    /// 1x1 PNG.
    private static let tinyPNG = Data(base64Encoded:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")!
}
