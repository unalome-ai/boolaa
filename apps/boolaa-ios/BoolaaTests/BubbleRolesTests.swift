import Foundation
import Supabase
import Testing
@testable import Boolaa

/// Bubble roles (docs/boolaa-spec.md, "Roles"; migration 20261123190000_bubble_roles.sql).
@Suite("Bubble roles")
struct BubbleRolesTests {
    @Test func decodesAdminAndToleratesUnknownRoles() throws {
        struct Row: Decodable { let role: MemberRole }
        let rows = try JSONDecoder().decode([Row].self, from: Data(#"[{"role":"owner"},{"role":"admin"},{"role":"member"},{"role":"moderator"}]"#.utf8))
        #expect(rows.map(\.role) == [.owner, .admin, .member, .member])
    }

    @Test func permissions() {
        #expect(MemberRole.owner.canManage && MemberRole.admin.canManage && !MemberRole.member.canManage)
        #expect(MemberRole.owner.canChangeRoles && !MemberRole.admin.canChangeRoles && !MemberRole.member.canChangeRoles)
        #expect(MemberRole.owner.canRemove(.admin) && MemberRole.owner.canRemove(.member) && !MemberRole.owner.canRemove(.owner))
        #expect(MemberRole.admin.canRemove(.member) && !MemberRole.admin.canRemove(.admin) && !MemberRole.admin.canRemove(.owner))
        #expect(!MemberRole.member.canRemove(.member))
    }

    @Test(arguments: [
        ("only the owner can remove admins", UserFacingError.ownerOnlyAction),
        ("only the owner can transfer ownership", .ownerOnlyAction),
        ("only the owner can change roles", .ownerOnlyAction),
        ("only the owner can remove members", .ownerOnlyRemove),
        ("only the owner can change the invite code", .ownerOnlyRotate),
        ("already the owner", .generic),
        ("invalid role", .generic),
    ])
    func errorMapping(message: String, expected: UserFacingError) {
        #expect(UserFacingError.classify(PostgrestError(message: message)) == expected)
    }
}

/// Against the local backend, in a throwaway bubble of Alice's that Bob joins (deleted at the end).
@Suite("Bubble roles (local backend)", .serialized)
struct BubbleRolesIntegrationTests {
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

    private func roles(_ api: BoolaaAPI, _ bubbleID: UUID) async throws -> [UUID: MemberRole] {
        Dictionary(uniqueKeysWithValues: try await api.members(bubbleID: bubbleID).map { ($0.userId, $0.role) })
    }

    @Test(.timeLimit(.minutes(1)))
    func promoteTransferDemote() async throws {
        let alice = try await signedInAPI("alice@boolaa.test")
        let bob = try await signedInAPI("bob@boolaa.test")
        let aliceID = Seed.alice, bobID = Seed.bob

        let bubble = try await alice.createBubble(name: "zz roles \(UUID().uuidString.prefix(6))", description: nil, maxSize: 4)
        defer {
            let alice = alice, bob = bob
            Task {
                try? await bob.leaveBubble(bubbleID: bubble.id, userID: bobID)
                try? await alice.leaveBubble(bubbleID: bubble.id, userID: aliceID)
            }
        }
        let request = try await bob.requestToJoin(inviteCode: bubble.inviteCode)
        #expect(try await alice.approveJoinRequest(id: request.id))

        // A plain member can't change roles or transfer.
        await expectMapped(.ownerOnlyAction) { try await bob.setMemberRole(bubbleID: bubble.id, userID: bobID, role: .admin) }
        await expectMapped(.ownerOnlyAction) { try await bob.transferOwnership(bubbleID: bubble.id, newOwnerID: bobID) }

        // Owner makes Bob an admin; an admin can rotate the code but not remove the owner.
        try await alice.setMemberRole(bubbleID: bubble.id, userID: bobID, role: .admin)
        #expect(try await roles(alice, bubble.id)[bobID] == .admin)
        _ = try await bob.rotateInviteCode(bubbleID: bubble.id)
        await expectMapped(.ownerOnlyAction) { try await bob.removeMember(bubbleID: bubble.id, userID: aliceID) }

        // Transfer: Bob owner, Alice admin, exactly one owner.
        try await alice.transferOwnership(bubbleID: bubble.id, newOwnerID: bobID)
        let after = try await roles(bob, bubble.id)
        #expect(after[bobID] == .owner && after[aliceID] == .admin)
        await expectMapped(.ownerOnlyAction) { try await alice.setMemberRole(bubbleID: bubble.id, userID: bobID, role: .member) }

        // New owner demotes Alice.
        try await bob.setMemberRole(bubbleID: bubble.id, userID: aliceID, role: .member)
        #expect(try await roles(bob, bubble.id)[aliceID] == .member)
    }
}
