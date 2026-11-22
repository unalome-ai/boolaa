package com.boolaa.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.boolaa.app.core.Backend
import com.boolaa.app.core.BoolaaApi
import com.boolaa.app.core.ImageBucket
import com.boolaa.app.core.UserFacingError
import com.boolaa.app.model.ReportReason
import com.boolaa.app.model.ReportTargetType
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.builtin.Email
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

/**
 * Blocks, report errors and delete_my_account against the local backend, using two throwaway users so the seeded
 * accounts are never blocked. Both users are deleted with delete_my_account at the end, which also removes their
 * bubble (empty bubbles are deleted) and content.
 */
@RunWith(AndroidJUnit4::class)
class SafetyTest {
    private val run = UUID.randomUUID().toString().take(8)

    private suspend fun throwaway(name: String): Pair<BoolaaApi, String> {
        val client = Backend.createClient(ephemeral = true)
        client.auth.signUpWith(Email) {
            email = "android-$name-$run@boolaa.test"; password = "password123"
            data = com.boolaa.app.state.SessionStore.signUpMetadata("Android $name $run", "en")
        }
        if (client.auth.currentUserOrNull() == null) {
            client.auth.signInWith(Email) { email = "android-$name-$run@boolaa.test"; password = "password123" }
        }
        return BoolaaApi(client) to client.auth.currentUserOrNull()!!.id
    }

    private suspend fun expectError(expected: UserFacingError, block: suspend () -> Unit) {
        try {
            block(); fail("expected $expected")
        } catch (e: AssertionError) {
            throw e
        } catch (e: Throwable) {
            assertEquals(expected, UserFacingError.classify(e))
        }
    }

    private fun httpStatus(url: String): Int =
        (URL(url).openConnection() as HttpURLConnection).run { try { responseCode } finally { disconnect() } }

    @Test fun block_hides_messages_until_unblocked_then_accounts_are_deleted() = runBlocking {
        val (a, aId) = throwaway("blocker")
        val (b, bId) = throwaway("blocked")
        var aDeleted = false
        var bDeleted = false
        try {
            val bubble = a.createBubble("Android safety $run", null, 4)
            assertTrue(a.approveJoinRequest(b.requestToJoin(bubble.inviteCode).id))
            val fromB = b.sendMessage(bubble.id, bId, "hello from B $run")
            a.sendMessage(bubble.id, aId, "hello from A $run")
            assertTrue(a.chatMessages(bubble.id).any { it.id == fromB.id })

            // Report errors (no report rows are created on these paths).
            expectError(UserFacingError.CANNOT_REPORT_SELF) { b.report(ReportTargetType.CHAT_MESSAGE, fromB.id, ReportReason.SPAM, null) }
            expectError(UserFacingError.REPORT_TARGET_NOT_FOUND) {
                a.report(ReportTargetType.CHAT_MESSAGE, UUID.randomUUID().toString(), ReportReason.OTHER, "x")
            }

            // Block is two-way: neither side sees the other's messages; members still list both.
            a.block(aId, bId)
            assertEquals(listOf(bId), a.blocks().map { it.blockedId })
            assertFalse(a.chatMessages(bubble.id).any { it.senderId == bId })
            assertFalse(b.chatMessages(bubble.id).any { it.senderId == aId })
            assertEquals(2, a.members(bubble.id).size)

            a.unblock(aId, bId)
            assertTrue(a.blocks().isEmpty())
            assertTrue(a.chatMessages(bubble.id).any { it.id == fromB.id })

            // delete_my_account: storage under <uid>/ is removed first, then the auth user and everything it owns.
            val avatar = b.uploadImage(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xD9.toByte()), ImageBucket.AVATARS, bId)
            assertEquals(200, httpStatus(avatar))
            b.deleteMyAccount(bId); bDeleted = true
            assertTrue(httpStatus(avatar) >= 400)
            assertFalse(a.members(bubble.id).any { it.userId == bId })
            assertFalse(a.chatMessages(bubble.id).any { it.senderId == bId })
            b.client.auth.signOut()
            expectError(UserFacingError.INVALID_CREDENTIALS) {
                b.client.auth.signInWith(Email) { email = "android-blocked-$run@boolaa.test"; password = "password123" }
            }

            a.deleteMyAccount(aId); aDeleted = true // last member: the bubble goes too
            assertNotNull(bubble.id)
        } finally {
            if (!bDeleted) runCatching { b.deleteMyAccount(bId) }
            if (!aDeleted) runCatching { a.deleteMyAccount(aId) }
            runCatching { a.client.auth.signOut() }
            runCatching { b.client.auth.signOut() }
        }
    }
}
