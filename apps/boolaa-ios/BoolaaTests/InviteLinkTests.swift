import Foundation
import Supabase
import Testing
import UIKit
@testable import Boolaa

@Suite("Invite links: parsing")
struct InviteLinkParsingTests {
    @Test(arguments: [
        ("https://boolaa.ro/join/FLAT2026", "FLAT2026"),
        ("https://boolaa.ro/join/flat2026", "FLAT2026"),
        ("https://boolaa.ro/join/FLAT2026/", "FLAT2026"),
        ("https://boolaa.ro/join/FLAT2026?utm_source=whatsapp", "FLAT2026"),
        ("https://www.boolaa.ro/join/K7M2-QX9P-RT", "K7M2QX9PRT"),
        ("https://BOOLAA.RO/JOIN/abcd", "ABCD"),
        ("https://boolaa.ro/join/ab%20cd", "ABCD"),
        ("boolaa://join/climb123", "CLIMB123"),
        ("ro.boolaa.app://join/CLIMB123", "CLIMB123"),
        ("BOOLAA://join/CLIMB123", "CLIMB123"),
    ])
    func acceptsInviteLinks(raw: String, expected: String) throws {
        #expect(InviteLink.code(from: try #require(URL(string: raw))) == expected)
    }

    @Test(arguments: [
        "ro.boolaa.app://auth/callback?code=abc",           // OAuth / email-link callback
        "ro.boolaa.app://auth/callback",
        "https://evil.example/join/FLAT2026",               // other host
        "https://boolaa.ro.evil.example/join/FLAT2026",
        "http://boolaa.ro/join/FLAT2026",                   // not https
        "https://boolaa.ro/FLAT2026",                       // wrong path
        "https://boolaa.ro/join",
        "https://boolaa.ro/join/",
        "https://boolaa.ro/join/FLAT2026/extra",
        "https://boolaa.ro/invite/FLAT2026",
        "https://boolaa.ro/join/ABC",                       // too short
        "https://boolaa.ro/join/\(String(repeating: "A", count: 33))", // too long
        "https://boolaa.ro/join/FL%C4%82T2026",             // non-ASCII letter
        "https://boolaa.ro/join/FLAT_2026",                 // underscore
        "boolaa://events/FLAT2026",
        "boolaa://join",
        "boolaa://join/FLAT2026/x",
        "mailto:join@boolaa.ro",
        "com.googleusercontent.apps.123://oauth2redirect",
    ])
    func rejectsEverythingElse(raw: String) throws {
        #expect(InviteLink.code(from: try #require(URL(string: raw))) == nil, "\(raw)")
    }

    @Test func normalisation() {
        #expect(InviteLink.normalize(" k7m2 qx9p-rt ") == "K7M2QX9PRT")
        #expect(InviteLink.normalize("abcd") == "ABCD")
        #expect(InviteLink.normalize("abc") == nil)
        #expect(InviteLink.normalize(String(repeating: "9", count: 32)) != nil)
        #expect(InviteLink.normalize(String(repeating: "9", count: 33)) == nil)
        #expect(InviteLink.normalize("ABCD!") == nil)
        #expect(InviteLink.normalize("ÀBCD") == nil)
    }

    @Test func buildsProductionLinks() {
        #expect(InviteLink.url(for: "FLAT2026").absoluteString == "https://boolaa.ro/join/FLAT2026")
        #expect(InviteLink.url(for: "k7m2-qx9p").absoluteString == "https://boolaa.ro/join/K7M2QX9P")
        // Round trip.
        #expect(InviteLink.code(from: InviteLink.url(for: "CLIMB123")) == "CLIMB123")
    }

    @Test func qrCodeIsCrispAndSquare() throws {
        let image = try #require(InviteLink.qrImage(for: "https://boolaa.ro/join/K7M2QX9PRT", scale: 10))
        let cg = try #require(image.cgImage)
        #expect(cg.width == cg.height)
        #expect(cg.width >= 210 && cg.width % 10 == 0) // whole modules, scaled without smoothing
    }

    @Test func previewDecodes() throws {
        let json = #"[{"bubble_id":null,"name":"Flatmates","logo":null,"member_count":2,"max_size":8,"status":"pending"}]"#
        let rows = try BoolaaJSON.decoder.decode([InvitePreview].self, from: Data(json.utf8))
        #expect(rows == [InvitePreview(bubbleId: nil, name: "Flatmates", logo: nil, memberCount: 2, maxSize: 8, status: .pending)])
    }
}

@MainActor
@Suite("Invite links: session")
struct InviteLinkSessionTests {
    @Test func storesPendingInviteAcrossLaunches() throws {
        let defaults = try #require(UserDefaults(suiteName: "invite-test-\(UUID().uuidString)"))
        let api = BoolaaAPI(client: Backend.makeClient(config: try AppConfig.load(), authStorage: InMemoryAuthStorage()))
        let device = DeviceIdentity(id: DeviceIdentity.generateID(), label: "test")
        let store = SessionStore(api: api, device: device, defaults: defaults)
        #expect(store.handleInviteURL(URL(string: "https://boolaa.ro/join/abcd-efgh")!))
        #expect(store.pendingInviteCode == "ABCDEFGH")
        #expect(!store.handleInviteURL(URL(string: "ro.boolaa.app://auth/callback?code=x")!))
        #expect(store.pendingInviteCode == "ABCDEFGH")
        // Signed out: never shown over sign-in.
        #expect(store.inviteToShow == nil)
        let relaunched = SessionStore(api: api, device: device, defaults: defaults)
        #expect(relaunched.pendingInviteCode == "ABCDEFGH")
        relaunched.pendingInviteCode = nil
        #expect(SessionStore(api: api, device: device, defaults: defaults).pendingInviteCode == nil)
    }
}

@Suite("Invite links: errors and strings")
struct InviteLinkStringTests {
    @Test func backendErrorsMap() {
        #expect(UserFacingError.classify(PostgrestError(code: "54000", message: "too many attempts")) == .tooManyInviteAttempts)
        #expect(UserFacingError.classify(PostgrestError(message: "only the owner can change the invite code")) == .ownerOnlyRotate)
    }

    @Test func translated() throws {
        let path = try #require(Bundle.main.path(forResource: "ro", ofType: "lproj"))
        let ro = try #require(Bundle(path: path))
        #expect(String(localized: "Open bubble", bundle: ro) == "Deschide bula")
        #expect(String(localized: "Join my bubble “\("Flat")” on Boolaa: \("https://boolaa.ro/join/X")", bundle: ro)
                == "Intră în bula mea „Flat” pe Boolaa: https://boolaa.ro/join/X")
    }
}

/// get_invite_preview / rotate_invite_code (migration 20261123140000) against the local backend. A throwaway
/// bubble owned by Alice; Bob previews it. Seeded bubbles' codes are never rotated.
@Suite("Invite links (local backend)", .serialized)
struct InviteLinkIntegrationTests {
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

    @Test(.timeLimit(.minutes(1)))
    func previewRequestAndRotate() async throws {
        let alice = try await signedInAPI("alice@boolaa.test")
        let bob = try await signedInAPI("bob@boolaa.test")
        let bubble = try await alice.createBubble(name: "zz invite \(UUID().uuidString.prefix(6))", description: nil, maxSize: 5)
        defer {
            let alice = alice, bob = bob
            Task {
                try? await bob.client.from("join_requests").delete().eq("bubble_id", value: bubble.id).eq("user_id", value: Seed.bob).execute()
                try? await alice.leaveBubble(bubbleID: bubble.id, userID: Seed.alice)
            }
        }

        // A non-member sees name, size and status, never the bubble id.
        let open = try #require(try await bob.invitePreview(code: InviteLink.url(for: bubble.inviteCode).lastPathComponent.lowercased()))
        #expect(open == InvitePreview(bubbleId: nil, name: bubble.name, logo: nil, memberCount: 1, maxSize: 5, status: .open))

        // The member sees the id (to switch to it).
        let mine = try #require(try await alice.invitePreview(code: bubble.inviteCode))
        #expect(mine.status == .member && mine.bubbleId == bubble.id)

        // Requesting goes through the normal vote: Bob is pending, not a member.
        _ = try await bob.requestToJoin(inviteCode: bubble.inviteCode)
        #expect(try await bob.invitePreview(code: bubble.inviteCode)?.status == .pending)

        // Only the owner rotates; a plain UPDATE of the code is refused.
        await expectMapped(.ownerOnlyRotate) { _ = try await bob.rotateInviteCode(bubbleID: bubble.id) }
        await expectMapped(.permissionDenied) {
            try await alice.client.from("bubbles").update(["invite_code": "AAAA1111"]).eq("id", value: bubble.id).execute()
        }
        let newCode = try await alice.rotateInviteCode(bubbleID: bubble.id)
        #expect(newCode != bubble.inviteCode && newCode.count == 10 && InviteLink.normalize(newCode) == newCode)

        // The old code is dead (link, QR and typed code alike); the new one works and Bob's request survived.
        // (Checked through request_to_join only: an unknown-code preview would count towards the seeded
        // user's hourly throttle, shared with other test suites. The backend Deno tests cover that path.)
        await expectMapped(.invalidInviteCode) { _ = try await bob.requestToJoin(inviteCode: bubble.inviteCode) }
        #expect(try await bob.invitePreview(code: newCode)?.status == .pending)
    }
}
