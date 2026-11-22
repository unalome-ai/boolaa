import Foundation
import Supabase
import Testing
import UIKit
@testable import Boolaa

/// Bubble photo (bucket `bubble.images`, supabase/migrations/20261123130000_bubble_cover.sql).
@Suite("Bubble photo")
struct BubbleLogoTests {
    private let bubble = UUID(uuidString: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE")!

    @Test func pathIsBubbleFolderWithLowercasedIDs() {
        let file = UUID(uuidString: "12345678-ABCD-4000-8000-0000000000FF")!
        #expect(BoolaaAPI.bubbleLogoPath(bubbleID: bubble, fileID: file)
                == "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/12345678-abcd-4000-8000-0000000000ff.jpg")
    }

    @Test func pathFromPublicURLOnlyForThisBubblesFolder() {
        let base = "http://127.0.0.1:55321/storage/v1/object/public/bubble.images/"
        let own = base + "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/f.jpg"
        #expect(BoolaaAPI.bubbleLogoPath(fromPublicURL: own, bubbleID: bubble) == "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/f.jpg")
        #expect(BoolaaAPI.bubbleLogoPath(fromPublicURL: own + "?t=1", bubbleID: bubble) == "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/f.jpg")
        #expect(BoolaaAPI.bubbleLogoPath(fromPublicURL: base + "11111111-1111-1111-1111-111111111111/f.jpg", bubbleID: bubble) == nil)
        #expect(BoolaaAPI.bubbleLogoPath(fromPublicURL: "http://127.0.0.1:55321/storage/v1/object/public/avatars/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/f.jpg", bubbleID: bubble) == nil)
        #expect(BoolaaAPI.bubbleLogoPath(fromPublicURL: "https://example.com/logo.png", bubbleID: bubble) == nil)
        #expect(BoolaaAPI.bubbleLogoPath(fromPublicURL: nil, bubbleID: bubble) == nil)
    }

    @Test func bucketUsesAvatarLimits() {
        #expect(BoolaaAPI.ImageBucket.bubbles.rawValue == "bubble.images")
        #expect(ImageCompression.maxSide(for: .bubbles) == 512)
        #expect(ImageCompression.maxBytes(for: .bubbles) == 2 * 1024 * 1024)
    }

    @Test func pendingRequestDecodesBubbleLogo() throws {
        let json = #"{"id":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","name":"Flat","logo":"https://x/y.jpg"}"#
        let ref = try JSONDecoder().decode(BubbleRef.self, from: Data(json.utf8))
        #expect(ref.logo == "https://x/y.jpg")
        let bare = try JSONDecoder().decode(BubbleRef.self, from: Data(#"{"id":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","name":"Flat"}"#.utf8))
        #expect(bare.logo == nil)
    }

    /// English needs no entry: the key is the English text.
    @Test(arguments: [
        ("ro", "Fotografia bulei"), ("fr", "Photo de la bulle"), ("es", "Foto de la burbuja"), ("it", "Foto della bolla"),
    ])
    func stringsTranslated(lang: String, heading: String) throws {
        let path = try #require(Bundle.main.path(forResource: lang, ofType: "lproj"))
        let bundle = try #require(Bundle(path: path))
        #expect(bundle.localizedString(forKey: "Bubble photo", value: "⟨missing⟩", table: nil) == heading)
        for key in ["Add a photo", "Change photo", "Remove photo", "Everyone in the bubble sees it. Square photos look best.", "Photo of %@"] {
            #expect(bundle.localizedString(forKey: key, value: "⟨missing⟩", table: nil) != "⟨missing⟩", "\(key) [\(lang)]")
        }
    }
}

/// Upload, replace, remove and the server's checks, against the local stack with a throwaway bubble.
@Suite("Bubble photo (local backend)", .serialized)
struct BubbleLogoIntegrationTests {
    private func signIn(_ email: String) async throws -> BoolaaAPI {
        let client = Backend.makeClient(config: try AppConfig.load(), authStorage: InMemoryAuthStorage())
        try await client.auth.signIn(email: email, password: "password123")
        return BoolaaAPI(client: client)
    }

    private func logo(_ api: BoolaaAPI, _ id: UUID) async throws -> String? {
        let row: Bubble = try await api.client.from("bubbles").select().eq("id", value: id).single().execute().value
        return row.logo
    }

    private func exists(_ url: String) async throws -> Bool {
        var request = URLRequest(url: try #require(URL(string: url)), cachePolicy: .reloadIgnoringLocalAndRemoteCacheData)
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        let (_, response) = try await URLSession(configuration: .ephemeral).data(for: request)
        return (response as? HTTPURLResponse)?.statusCode == 200
    }

    @Test func ownerSetsReplacesAndRemovesPhoto() async throws {
        let alice = try await signIn("alice@boolaa.test")
        let bubble = try await alice.createBubble(name: "ios-logo-\(UUID().uuidString.prefix(8))", description: nil, maxSize: 4)
        defer { Task { try? await alice.leaveBubble(bubbleID: bubble.id, userID: Seed.alice) } }

        let jpeg = try ImageCompression.jpeg(from: try tinyPNG(), for: .bubbles)
        let first = try await alice.uploadBubbleLogo(jpeg, bubbleID: bubble.id)
        #expect(first.contains("/storage/v1/object/public/bubble.images/\(bubble.id.uuidString.lowercased())/"))
        try await alice.setBubbleLogo(bubbleID: bubble.id, logo: first)
        #expect(try await logo(alice, bubble.id) == first)

        // Only URLs of files in this bubble's folder are accepted.
        do {
            try await alice.setBubbleLogo(bubbleID: bubble.id, logo: "https://example.com/x.jpg")
            Issue.record("foreign logo URL was accepted")
        } catch { #expect(UserFacingError.classify(error) == .generic, "\(error)") }

        // Replace: the old file goes.
        let second = try await alice.uploadBubbleLogo(jpeg, bubbleID: bubble.id)
        try await alice.setBubbleLogo(bubbleID: bubble.id, logo: second)
        await alice.removeBubbleLogo(publicURL: first, bubbleID: bubble.id)
        #expect(try await exists(first) == false)
        #expect(try await exists(second))

        // Remove.
        try await alice.setBubbleLogo(bubbleID: bubble.id, logo: nil)
        await alice.removeBubbleLogo(publicURL: second, bubbleID: bubble.id)
        #expect(try await logo(alice, bubble.id) == nil)
        #expect(try await exists(second) == false)

        try await alice.leaveBubble(bubbleID: bubble.id, userID: Seed.alice)
    }

    @Test func nonMembersCannotWriteIntoTheBubbleFolder() async throws {
        let alice = try await signIn("alice@boolaa.test")
        let carol = try await signIn("carol@boolaa.test")
        let bubble = try await alice.createBubble(name: "ios-logo-\(UUID().uuidString.prefix(8))", description: nil, maxSize: 4)
        defer { Task { try? await alice.leaveBubble(bubbleID: bubble.id, userID: Seed.alice) } }
        let jpeg = try ImageCompression.jpeg(from: try tinyPNG(), for: .bubbles)
        do {
            _ = try await carol.uploadBubbleLogo(jpeg, bubbleID: bubble.id)
            Issue.record("non-member uploaded into the bubble folder")
        } catch {}
        try await alice.leaveBubble(bubbleID: bubble.id, userID: Seed.alice)
    }

    /// A 4x4 opaque PNG drawn in memory.
    private func tinyPNG() throws -> Data {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 4, height: 4))
        let image = renderer.image { ctx in UIColor.systemPurple.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: 4, height: 4)) }
        return try #require(image.pngData())
    }
}
