package com.boolaa.app

import com.boolaa.app.core.Backoff
import com.boolaa.app.core.ChatOutbox
import com.boolaa.app.core.ConnectivityMonitor
import com.boolaa.app.core.ConnectivityRules
import com.boolaa.app.core.NetEvent
import com.boolaa.app.core.NetStatus
import com.boolaa.app.core.OfflineCache
import com.boolaa.app.core.OutboxRules
import com.boolaa.app.core.OutboxState
import com.boolaa.app.core.PendingMessage
import com.boolaa.app.model.ChatMessage
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.time.Duration
import java.time.Instant

/** Offline and poor network (docs/boolaa-spec.md): pure logic, no backend. Same cases as web and iOS. */
@OptIn(ExperimentalCoroutinesApi::class)
class OfflineTest {
    // --- Connectivity state machine

    @Test fun path_lost_goes_offline_and_back_reconnects() {
        var t = ConnectivityRules.next(NetStatus.ONLINE, NetEvent.PathChanged(false))
        assertEquals(NetStatus.OFFLINE, t.status)
        assertFalse(t.reconnected)
        t = ConnectivityRules.next(NetStatus.OFFLINE, NetEvent.PathChanged(true))
        assertEquals(NetStatus.ONLINE, t.status)
        assertTrue(t.reconnected)
        assertTrue(ConnectivityRules.showsBackOnline(NetStatus.OFFLINE, NetStatus.ONLINE))
    }

    @Test fun network_failure_while_online_is_unreachable_until_a_success() {
        var t = ConnectivityRules.next(NetStatus.ONLINE, NetEvent.RequestFailed(network = true))
        assertEquals(NetStatus.UNREACHABLE, t.status)
        t = ConnectivityRules.next(NetStatus.UNREACHABLE, NetEvent.RequestFailed(network = true))
        assertEquals(NetStatus.UNREACHABLE, t.status)
        t = ConnectivityRules.next(NetStatus.UNREACHABLE, NetEvent.RequestSucceeded)
        assertEquals(NetStatus.ONLINE, t.status)
        assertTrue(t.reconnected)
    }

    @Test fun non_network_errors_and_offline_successes_change_nothing() {
        assertEquals(NetStatus.ONLINE, ConnectivityRules.next(NetStatus.ONLINE, NetEvent.RequestFailed(network = false)).status)
        assertEquals(NetStatus.OFFLINE, ConnectivityRules.next(NetStatus.OFFLINE, NetEvent.RequestSucceeded).status)
        assertEquals(NetStatus.OFFLINE, ConnectivityRules.next(NetStatus.OFFLINE, NetEvent.RequestFailed(network = true)).status)
        // The path coming back while unreachable doesn't claim online yet; a lost path always wins.
        assertEquals(NetStatus.UNREACHABLE, ConnectivityRules.next(NetStatus.UNREACHABLE, NetEvent.PathChanged(true)).status)
        assertEquals(NetStatus.OFFLINE, ConnectivityRules.next(NetStatus.UNREACHABLE, NetEvent.PathChanged(false)).status)
        assertFalse(ConnectivityRules.next(NetStatus.ONLINE, NetEvent.RequestSucceeded).reconnected)
    }

    @Test fun monitor_bumps_refresh_on_reconnect_and_foreground_and_flashes_back_online() = runTest {
        val scope = TestScope(StandardTestDispatcher(testScheduler))
        var probes = 0
        val monitor = ConnectivityMonitor(scope) { probes++; true }
        assertEquals(0, monitor.refresh.value)
        monitor.setSimulatedOffline(true)
        assertEquals(NetStatus.OFFLINE, monitor.status.value)
        monitor.setSimulatedOffline(false)
        assertEquals(NetStatus.ONLINE, monitor.status.value)
        assertEquals(1, monitor.refresh.value)
        assertTrue(monitor.backOnline.value)
        scope.advanceTimeBy(2_600)
        assertFalse(monitor.backOnline.value)
        monitor.foreground()
        assertEquals(2, monitor.refresh.value)
        // Unreachable: the health probe (after 1 s of backoff) brings it back.
        monitor.report(false)
        assertEquals(NetStatus.UNREACHABLE, monitor.status.value)
        scope.advanceTimeBy(1_300)
        assertEquals(1, probes)
        assertEquals(NetStatus.ONLINE, monitor.status.value)
        assertEquals(3, monitor.refresh.value)
        scope.advanceUntilIdle()
    }

    // --- Backoff

    @Test fun backoff_doubles_to_thirty_seconds() {
        assertEquals(listOf(1_000L, 2_000L, 4_000L, 8_000L, 16_000L, 30_000L, 30_000L), (0..6).map { Backoff.delayMs(it) })
        assertEquals(800L, Backoff.delayMs(0, 0.8))
        assertEquals(36_000L, Backoff.delayMs(9, 1.2))
        assertEquals(1_200L, Backoff.delayMs(0, 5.0)) // jitter is clamped to [0.8, 1.2]
        repeat(50) { val j = Backoff.randomJitter(); assertTrue(j in 0.8..1.2) }
    }

    // --- Offline cache

    private fun tempDir(): File = Files.createTempDirectory("offline").toFile()

    @Test fun cache_round_trips_per_user_and_clears() {
        val root = tempDir()
        val cache = OfflineCache(root)
        val strings = ListSerializer(String.serializer())
        cache.save("alice", "events.b1", strings, listOf("a", "b"))
        cache.save("bob", "events.b1", strings, listOf("bob's"))
        assertEquals(listOf("a", "b"), cache.load("alice", "events.b1", strings))
        assertEquals(listOf("bob's"), cache.load("bob", "events.b1", strings))
        assertNull(cache.load("alice", "events.b2", strings))
        cache.keepOnly("alice")
        assertNull(cache.load("bob", "events.b1", strings))
        assertEquals(listOf("a", "b"), cache.load("alice", "events.b1", strings))
        cache.clearAll()
        assertNull(cache.load("alice", "events.b1", strings))
        assertFalse(root.exists())
    }

    @Test fun cache_ignores_old_wrong_version_and_garbage() {
        val root = tempDir()
        var now = Instant.parse("2026-11-01T10:00:00Z")
        val cache = OfflineCache(root) { now }
        val ser = String.serializer()
        cache.save("u", "k", ser, "hello")
        now = now.plus(Duration.ofDays(29))
        assertEquals("hello", cache.load("u", "k", ser))
        now = now.plus(Duration.ofDays(2))
        assertNull(cache.load("u", "k", ser))
        File(root, "u").mkdirs()
        File(root, "u/v.json").writeText("""{"v":2,"savedAt":"${now}","data":"x"}""")
        assertNull(cache.load("u", "v", ser))
        File(root, "u/w.json").writeText("not json")
        assertNull(cache.load("u", "w", ser))
        assertFalse(File(root, "u/w.json").exists())
        // Keys and ids can't escape the user's folder.
        cache.save("../evil", "../../k", ser, "x")
        assertTrue(root.walkTopDown().all { it.canonicalPath.startsWith(root.canonicalPath) })
    }

    // --- Outbox rules

    @Test fun duplicate_insert_and_upload_count_as_sent() {
        assertTrue(OutboxRules.isUniqueViolation("23505"))
        assertFalse(OutboxRules.isUniqueViolation("42501"))
        assertFalse(OutboxRules.isUniqueViolation(null))
        assertTrue(OutboxRules.isDuplicateObject(409, null, null))
        assertTrue(OutboxRules.isDuplicateObject(400, "Duplicate", "The resource already exists"))
        assertFalse(OutboxRules.isDuplicateObject(413, "EntityTooLarge", "The object exceeded the maximum allowed size"))
    }

    @Test fun pending_messages_order_per_bubble_and_hide_once_the_server_has_them() {
        val t = Instant.parse("2026-11-23T10:00:00Z")
        val a = PendingMessage.create("b1", "me", "first", null, t)
        val b = PendingMessage.create("b1", "me", "second", null, t.plusSeconds(1))
        val other = PendingMessage.create("b2", "me", "elsewhere", null, t)
        assertEquals(listOf(a, b), OutboxRules.forBubble(listOf(b, other, a), "b1"))
        assertEquals(listOf(b), OutboxRules.visible(listOf(a, b), setOf(a.clientId)))
        val photo = a.copy(photo = byteArrayOf(1))
        assertEquals(listOf(b.copy(state = OutboxState.FAILED)), OutboxRules.restored(listOf(photo, b)))
        assertEquals("me/${a.clientId}.jpg", photo.photoPath)
        assertNull(a.photoPath)
    }

    // --- Outbox

    private fun row(p: PendingMessage) = ChatMessage(p.clientId, p.bubbleId, p.senderId, p.content, p.createdAt)

    @Test fun outbox_sends_online_and_waits_offline_then_flushes_in_order() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        val scope = TestScope(dispatcher)
        var online = false
        val sent = mutableListOf<String>()
        val outbox = ChatOutbox(tempDir(), scope, isOnline = { online }, attempt = { p -> sent += p.content; row(p) }, ioDispatcher = dispatcher)
        outbox.restore("me")
        outbox.send(PendingMessage.create("b1", "me", "one", null, Instant.EPOCH))
        outbox.send(PendingMessage.create("b1", "me", "two", null, Instant.EPOCH.plusSeconds(1)))
        scope.advanceUntilIdle()
        assertEquals(emptyList<String>(), sent)
        assertTrue(outbox.items.value.all { it.state == OutboxState.SENDING })
        online = true
        outbox.flush()
        scope.advanceUntilIdle()
        assertEquals(listOf("one", "two"), sent)
        assertTrue(outbox.items.value.isEmpty())
    }

    @Test fun outbox_failure_marks_failed_retry_sends_once_discard_removes() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        val scope = TestScope(dispatcher)
        var fail = true
        var attempts = 0
        val outbox = ChatOutbox(tempDir(), scope, isOnline = { true }, attempt = { p ->
            attempts++
            if (fail) throw IOException("timeout") else row(p)
        }, ioDispatcher = dispatcher)
        outbox.restore("me")
        val msg = PendingMessage.create("b1", "me", "hi", null)
        outbox.send(msg)
        scope.advanceUntilIdle()
        assertEquals(OutboxState.FAILED, outbox.items.value.single().state)
        // A failed message waits for a tap: a flush doesn't resend it.
        outbox.flush()
        scope.advanceUntilIdle()
        assertEquals(1, attempts)
        fail = false
        outbox.retry(msg.clientId)
        scope.advanceUntilIdle()
        assertEquals(2, attempts)
        assertTrue(outbox.items.value.isEmpty())

        val other = PendingMessage.create("b1", "me", "bye", null)
        fail = true
        outbox.send(other)
        scope.advanceUntilIdle()
        assertEquals(other.clientId, outbox.discard(other.clientId)?.clientId)
        assertTrue(outbox.items.value.isEmpty())
    }

    @Test fun outbox_persists_text_only_restores_as_failed_and_clears_on_sign_out() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        val scope = TestScope(dispatcher)
        val dir = tempDir()
        val first = ChatOutbox(dir, scope, isOnline = { false }, attempt = { row(it) }, ioDispatcher = dispatcher)
        first.restore("me")
        first.send(PendingMessage.create("b1", "me", "text", null))
        first.send(PendingMessage.create("b1", "me", "", byteArrayOf(1, 2, 3)))
        scope.advanceUntilIdle()

        val second = ChatOutbox(dir, scope, isOnline = { false }, attempt = { row(it) }, ioDispatcher = dispatcher)
        second.restore("me")
        val restored = second.items.value
        assertEquals(listOf("text"), restored.map { it.content })
        assertEquals(OutboxState.FAILED, restored.single().state)

        // Another account never sees it.
        val third = ChatOutbox(dir, scope, isOnline = { false }, attempt = { row(it) }, ioDispatcher = dispatcher)
        third.restore("someone-else")
        assertTrue(third.items.value.isEmpty())

        second.clear()
        scope.advanceUntilIdle()
        assertTrue(second.items.value.isEmpty())
        assertFalse(dir.exists())
    }
}
