package com.boolaa.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.boolaa.app.core.Backend
import com.boolaa.app.core.BoolaaApi
import com.boolaa.app.core.UserFacingError
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.builtin.Email
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

/**
 * remove_member against the local backend with two independent sessions. Alice creates a throwaway bubble,
 * admits Bob, then the RPC is exercised as non-owner and owner. The bubble is deleted when Alice leaves last.
 */
@RunWith(AndroidJUnit4::class)
class RemoveMemberTest {
    private suspend fun signedIn(email: String): Pair<BoolaaApi, String> {
        val client = Backend.createClient(ephemeral = true)
        client.auth.signInWith(Email) { this.email = email; password = "password123" }
        return BoolaaApi(client) to client.auth.currentUserOrNull()!!.id
    }

    private suspend fun expectError(expected: UserFacingError, block: suspend () -> Unit) {
        try {
            block()
            fail("expected $expected")
        } catch (e: AssertionError) {
            throw e
        } catch (e: Throwable) {
            assertEquals(expected, UserFacingError.classify(e))
        }
    }

    @Test fun owner_removes_member_and_non_owner_cannot() = runBlocking {
        val (alice, aliceId) = signedIn("alice@boolaa.test")
        val (bob, bobId) = signedIn("bob@boolaa.test")
        val bubble = alice.createBubble("Android remove test ${UUID.randomUUID().toString().take(6)}", null, 4)
        try {
            val request = bob.requestToJoin(bubble.inviteCode)
            assertTrue("single owner's vote is a majority", alice.approveJoinRequest(request.id))
            assertTrue(bob.memberships(bobId).any { it.bubbleId == bubble.id && it.approved })

            expectError(UserFacingError.ONLY_OWNER_CAN_REMOVE) { bob.removeMember(bubble.id, aliceId) }
            expectError(UserFacingError.CANNOT_REMOVE_SELF) { alice.removeMember(bubble.id, aliceId) }

            alice.removeMember(bubble.id, bobId)
            assertFalse(bob.memberships(bobId).any { it.bubbleId == bubble.id })
            expectError(UserFacingError.MEMBER_NOT_FOUND) { alice.removeMember(bubble.id, bobId) }
        } finally {
            runCatching { bob.leaveBubble(bubble.id, bobId) }
            alice.leaveBubble(bubble.id, aliceId) // last member out: the trigger deletes the bubble
            alice.client.auth.signOut()
            bob.client.auth.signOut()
        }
    }
}
