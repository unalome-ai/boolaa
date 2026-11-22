package com.boolaa.app

import com.boolaa.app.core.UserFacingError
import com.boolaa.app.core.UserFacingError.Companion.classify
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.IOException
import java.net.ConnectException

class UserFacingErrorTest {
    @Test fun rpc_exception_texts() {
        assertEquals(UserFacingError.INVALID_INVITE_CODE, classify("invalid invite code", "P0001"))
        assertEquals(UserFacingError.ALREADY_MEMBER, classify("already a member", "P0001"))
        assertEquals(UserFacingError.BUBBLE_FULL, classify("bubble is full", "P0001"))
        assertEquals(UserFacingError.NOT_MEMBER, classify("not a member of this bubble", "P0001"))
        assertEquals(UserFacingError.REQUEST_NOT_FOUND, classify("request not found", "P0001"))
        assertEquals(UserFacingError.EVENT_NOT_FOUND, classify("event not found", "P0001"))
        assertEquals(UserFacingError.ONLY_OWNER_CAN_REMOVE, classify("only the owner can remove members", "P0001"))
        assertEquals(UserFacingError.CANNOT_REMOVE_SELF, classify("use leave to remove yourself", "P0001"))
        assertEquals(UserFacingError.MEMBER_NOT_FOUND, classify("member not found", "P0001"))
    }

    @Test fun rls_auth_and_fallback() {
        assertEquals(UserFacingError.PERMISSION_DENIED, classify("new row violates row-level security policy for table \"events\"", "42501"))
        assertEquals(UserFacingError.PERMISSION_DENIED, classify("whatever", "42501"))
        assertEquals(UserFacingError.INVALID_CREDENTIALS, classify("Invalid login credentials", null))
        assertEquals(UserFacingError.NOT_AUTHENTICATED, classify("JWT expired", "PGRST301"))
        assertNull(classify("duplicate key value violates unique constraint", "23505"))
    }

    @Test fun throwables() {
        assertEquals(UserFacingError.NETWORK, classify(ConnectException("Failed to connect to /127.0.0.1:55321")))
        assertEquals(UserFacingError.NETWORK, classify(IOException("reset")))
        assertEquals(UserFacingError.GENERIC, classify(IllegalStateException("boom")))
        assertEquals(UserFacingError.BUBBLE_FULL, classify(IllegalStateException("bubble is full")))
    }

    @Test fun every_case_has_a_distinct_message() {
        assertEquals(UserFacingError.entries.size, UserFacingError.entries.map { it.message }.toSet().size)
    }
}
