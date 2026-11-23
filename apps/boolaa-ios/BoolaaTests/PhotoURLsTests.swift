import Foundation
import Supabase
import Testing
import UIKit
@testable import Boolaa

/// Private photos (PhotoURLs, supabase/migrations/20261123210000_private_photos.sql).
@Suite("Private photos")
struct PhotoURLsTests {
    @Test func refOnlyForOurPublicFormURLs() {
        let base = "http://127.0.0.1:55321/storage/v1/object/public/"
        #expect(PhotoURLs.ref(fromStored: base + "food.images/u1/a.jpg") == .init(bucket: "food.images", path: "u1/a.jpg"))
        #expect(PhotoURLs.ref(fromStored: base + "bubble.images/b1/c.jpg?x=1") == .init(bucket: "bubble.images", path: "b1/c.jpg"))
        #expect(PhotoURLs.ref(fromStored: base + "avatars/u1/a%20b.jpg") == .init(bucket: "avatars", path: "u1/a b.jpg"))
        #expect(PhotoURLs.ref(fromStored: base + "other/u1/a.jpg") == nil, "unknown bucket")
        #expect(PhotoURLs.ref(fromStored: base + "avatars/u1/../u2/a.jpg") == nil, "no traversal")
        #expect(PhotoURLs.ref(fromStored: "https://images.unsplash.com/photo-1?w=800") == nil, "external")
        #expect(PhotoURLs.ref(fromStored: "http://h/storage/v1/object/sign/chat.images/u/a.jpg?token=t") == nil, "already signed")
        #expect(PhotoURLs.ref(fromStored: nil) == nil)
    }

    @Test @MainActor func externalURLsPassThrough() async {
        let store = PhotoURLs(api: BoolaaAPI(client: Backend.makeClient(config: try! AppConfig.load(), authStorage: InMemoryAuthStorage())))
        #expect(await store.resolve("https://images.unsplash.com/photo-1?w=800")?.absoluteString == "https://images.unsplash.com/photo-1?w=800")
        #expect(await store.resolve(nil) == nil)
    }
}

/// Against the local Supabase: members get signed URLs, outsiders and the public URL get nothing.
@Suite("Private photos (local backend)", .serialized)
struct PhotoURLsIntegrationTests {
    private func signIn(_ email: String) async throws -> BoolaaAPI {
        let client = Backend.makeClient(config: try AppConfig.load(), authStorage: InMemoryAuthStorage())
        try await client.auth.signIn(email: email, password: "password123")
        return BoolaaAPI(client: client)
    }

    private func status(_ url: URL) async -> Int {
        let request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData)
        guard let (_, response) = try? await URLSession(configuration: .ephemeral).data(for: request) else { return -1 }
        return (response as? HTTPURLResponse)?.statusCode ?? -1
    }

    @Test @MainActor func avatarIsReadableOnlyThroughSignedURLsForBubbleMates() async throws {
        let alice = try await signIn("alice@boolaa.test")
        let bob = try await signIn("bob@boolaa.test")
        let carol = try await signIn("carol@boolaa.test") // only a pending request, shares no bubble with Alice
        let jpeg = try ImageCompression.jpeg(from: try tinyPNG(), for: .avatars)
        let stored = try await alice.uploadImage(jpeg, bucket: .avatars, userID: Seed.alice)
        defer { Task { await alice.removeImage(publicURL: stored, bucket: .avatars, userID: Seed.alice) } }

        #expect(await status(try #require(URL(string: stored))) != 200, "the public URL serves nothing")

        let bobs = PhotoURLs(api: bob)
        let first = try #require(await bobs.resolve(stored), "bob shares Flatmates with Alice")
        #expect(first.absoluteString.contains("/storage/v1/object/sign/avatars/"))
        #expect(await status(first) == 200)
        #expect(await bobs.resolve(stored) == first, "cached per path: the same signed URL is reused")
        bobs.invalidate(stored)
        #expect(await bobs.resolve(stored) != nil, "re-signed after invalidation")

        #expect(await PhotoURLs(api: carol).resolve(stored) == nil, "carol can't read it")
    }

    private func tinyPNG() throws -> Data {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 8, height: 8))
        return renderer.pngData { ctx in
            UIColor.systemPurple.setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: 8, height: 8))
        }
    }
}
