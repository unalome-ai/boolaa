package com.boolaa.app

import com.boolaa.app.core.UserFacingError
import com.boolaa.app.core.UserFacingError.Companion.classify
import com.boolaa.app.model.BubbleMember
import com.boolaa.app.model.MemberPermissions
import com.boolaa.app.model.MemberRole
import com.boolaa.app.model.MemberRole.ADMIN
import com.boolaa.app.model.MemberRole.MEMBER
import com.boolaa.app.model.MemberRole.OWNER
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Bubble roles (20261123190000_bubble_roles.sql): decoding, what each role may do, and the new error texts. */
class MemberRolesTest {
    private val members = Fixtures.list("members.json", BubbleMember.serializer())
    private val alice = "11111111-1111-1111-1111-111111111111"
    private val bob = "22222222-2222-2222-2222-222222222222"
    private val carol = "33333333-3333-3333-3333-333333333333"

    @Test fun decodes_owner_admin_member() {
        assertEquals(OWNER, members.single { it.userId == alice }.role)
        assertEquals(MEMBER, members.single { it.userId == bob }.role)
        assertEquals(ADMIN, members.single { it.userId == carol }.role)
        assertEquals(1, members.count { it.role == OWNER })
    }

    @Test fun my_role_comes_from_the_live_list() {
        assertEquals(ADMIN, MemberPermissions.roleOf(carol, members, fallback = MEMBER))
        assertEquals(OWNER, MemberPermissions.roleOf("unknown", members, fallback = OWNER))
        assertNull(MemberPermissions.roleOf("unknown", members))
    }

    @Test fun owner_and_admins_manage_the_bubble() {
        assertTrue(MemberPermissions.canManage(OWNER))
        assertTrue(MemberPermissions.canManage(ADMIN))
        assertFalse(MemberPermissions.canManage(MEMBER))
        assertFalse(MemberPermissions.canManage(null))
    }

    @Test fun who_can_remove_whom() {
        assertTrue(MemberPermissions.canRemove(OWNER, MEMBER))
        assertTrue(MemberPermissions.canRemove(OWNER, ADMIN))
        assertFalse(MemberPermissions.canRemove(OWNER, OWNER))
        assertTrue(MemberPermissions.canRemove(ADMIN, MEMBER))
        assertFalse(MemberPermissions.canRemove(ADMIN, ADMIN))
        assertFalse(MemberPermissions.canRemove(ADMIN, OWNER))
        for (target in MemberRole.entries) assertFalse(MemberPermissions.canRemove(MEMBER, target))
        assertFalse(MemberPermissions.canRemove(null, MEMBER))
        assertFalse("never yourself", MemberPermissions.canRemove(OWNER, MEMBER, isSelf = true))
        assertFalse("never yourself", MemberPermissions.canRemove(ADMIN, MEMBER, isSelf = true))
    }

    @Test fun only_the_owner_changes_roles_and_transfers() {
        assertTrue(MemberPermissions.canChangeRoles(OWNER))
        assertFalse(MemberPermissions.canChangeRoles(OWNER, isSelf = true))
        assertFalse(MemberPermissions.canChangeRoles(ADMIN))
        assertFalse(MemberPermissions.canChangeRoles(MEMBER))
        assertFalse(MemberPermissions.canChangeRoles(null))
    }

    @Test fun role_error_texts() {
        assertEquals(UserFacingError.OWNER_ONLY_ACTION, classify("only the owner can remove admins", "P0001"))
        assertEquals(UserFacingError.OWNER_ONLY_ACTION, classify("only the owner can transfer ownership", "P0001"))
        assertEquals(UserFacingError.OWNER_ONLY_ACTION, classify("only the owner can change roles", "P0001"))
        // Unchanged texts, now shown as "owner or an admin".
        assertEquals(UserFacingError.ONLY_OWNER_CAN_REMOVE, classify("only the owner can remove members", "P0001"))
        assertEquals(UserFacingError.ONLY_OWNER_CAN_ROTATE, classify("only the owner can change the invite code", "P0001"))
        assertEquals(UserFacingError.MEMBER_NOT_FOUND, classify("member not found", "P0001"))
        // Programming errors fall back to the generic message.
        assertNull(classify("already the owner", "P0001"))
        assertNull(classify("invalid role", "P0001"))
        assertNull(classify("use transfer_ownership", "P0001"))
    }
}
