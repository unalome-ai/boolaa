import Foundation
import Supabase
import Testing
@testable import Boolaa

/// Offline and poor network (docs/boolaa-spec.md): connectivity state machine, backoff, the per-user cache
/// and the chat outbox. Pure logic, no backend (same cases as web and Android).
@Suite("Offline: connectivity and backoff")
struct ConnectivityLogicTests {
    @Test func pathLossGoesOfflineAndReturnReconnects() {
        var s = ConnectivityState()
        #expect(s.status == .online)
        #expect(s.pathChanged(available: false) == false)
        #expect(s.status == .offline)
        #expect(s.pathChanged(available: false) == false)
        #expect(s.pathChanged(available: true) == true, "offline → online is a reconnect")
        #expect(s.status == .online)
        #expect(s.pathChanged(available: true) == false, "already online: nothing to refetch")
    }

    @Test func networkFailureWhileOnlineMeansUnreachable() {
        var s = ConnectivityState()
        s.requestFailed(isNetworkError: false)
        #expect(s.status == .online, "an RLS / HTTP error says nothing about reachability")
        s.requestFailed(isNetworkError: true)
        #expect(s.status == .unreachable)
        #expect(s.requestSucceeded() == true, "Supabase answered again: reconnect")
        #expect(s.status == .online)
        #expect(s.requestSucceeded() == false)
    }

    @Test func offlineIgnoresRequestResults() {
        var s = ConnectivityState()
        _ = s.pathChanged(available: false)
        s.requestFailed(isNetworkError: true)
        #expect(s.status == .offline)
        #expect(s.requestSucceeded() == false)
        #expect(s.status == .offline, "the path decides while offline")
    }

    @Test func unreachableThenPathLostThenBack() {
        var s = ConnectivityState()
        s.requestFailed(isNetworkError: true)
        _ = s.pathChanged(available: false)
        #expect(s.status == .offline)
        let back = s.pathChanged(available: true)
        #expect(back)
        #expect(s.status == .online)
    }

    @Test func backoffSequence() {
        #expect((0..<8).map { Backoff.delay(attempt: $0) } == [1, 2, 4, 8, 16, 30, 30, 30])
        #expect(Backoff.delay(attempt: 2, jitter: 0.8) == 3.2)
        #expect(Backoff.delay(attempt: 2, jitter: 1.2) == 4.8)
        #expect(Backoff.delay(attempt: 2, jitter: 5) == 4.8, "jitter is clamped to [0.8, 1.2]")
        #expect(Backoff.delay(attempt: -3) == 1)
        #expect(Backoff.delay(attempt: 1000) == 30)
        for _ in 0..<50 { #expect((0.8...1.2).contains(Backoff.randomJitter())) }
    }

    @Test func networkErrorClassification() {
        #expect(Connectivity.isNetworkError(URLError(.notConnectedToInternet)))
        #expect(Connectivity.isNetworkError(URLError(.timedOut)))
        #expect(!Connectivity.isNetworkError(URLError(.cancelled)))
        #expect(!Connectivity.isNetworkError(PostgrestError(code: "42501", message: "permission denied")))
        #expect(Connectivity.isNetworkError(NSError(domain: NSURLErrorDomain, code: NSURLErrorCannotConnectToHost)))
    }
}

@Suite("Offline: cache")
struct OfflineCacheTests {
    private let alice = UUID(uuidString: "11111111-1111-1111-1111-111111111111")!
    private let bob = UUID(uuidString: "22222222-2222-2222-2222-222222222222")!
    private let bubble = UUID(uuidString: "aaaaaaaa-0000-0000-0000-000000000001")!

    private func tempRoot() -> URL {
        FileManager.default.temporaryDirectory.appending(path: "offline-tests-\(UUID().uuidString)", directoryHint: .isDirectory)
    }

    private func message(_ text: String, at seconds: TimeInterval) -> ChatMessage {
        ChatMessage(id: UUID(), bubbleId: bubble, senderId: alice, content: text,
                    createdAt: Date(timeIntervalSince1970: seconds + 0.123), imagePath: "\(alice.uuidString.lowercased())/a.jpg",
                    sender: UserProfile(id: alice, name: "Alice", avatar: nil))
    }

    @Test func roundTripsPerUser() {
        let cache = OfflineCache(root: tempRoot())
        let rows = [message("hi", at: 1_700_000_000), message("there", at: 1_700_000_100)]
        #expect(cache.read([ChatMessage].self, key: "chat.x") == nil, "no user, nothing read")
        cache.write(rows, key: "chat.x")
        cache.currentUser = alice
        cache.write(rows, key: OfflineCache.Key.chat(bubble))
        #expect(cache.read([ChatMessage].self, key: OfflineCache.Key.chat(bubble)) == rows, "dates survive to the millisecond")
        cache.currentUser = bob
        #expect(cache.read([ChatMessage].self, key: OfflineCache.Key.chat(bubble)) == nil, "Bob never sees Alice's cache")
    }

    @Test func signOutClearsEverything() {
        let root = tempRoot()
        let cache = OfflineCache(root: root)
        cache.currentUser = alice
        cache.write(["x"], key: OfflineCache.Key.bubbles)
        cache.clearAll()
        #expect(cache.currentUser == nil)
        #expect(!FileManager.default.fileExists(atPath: root.path(percentEncoded: false)))
        cache.currentUser = alice
        #expect(cache.read([String].self, key: OfflineCache.Key.bubbles) == nil)
    }

    @Test func signInKeepsOnlyThatUser() {
        let cache = OfflineCache(root: tempRoot())
        cache.currentUser = alice
        cache.write(["alice"], key: OfflineCache.Key.bubbles)
        cache.currentUser = bob
        cache.write(["bob"], key: OfflineCache.Key.bubbles)
        cache.keepOnly(bob)
        #expect(cache.read([String].self, key: OfflineCache.Key.bubbles) == ["bob"])
        #expect(cache.hasData(for: bob))
        #expect(!cache.hasData(for: alice))
        cache.currentUser = alice
        #expect(cache.read([String].self, key: OfflineCache.Key.bubbles) == nil)
    }

    @Test func oldOrForeignFilesAreIgnoredAndDeleted() throws {
        let root = tempRoot()
        let clock = TestClock(Date(timeIntervalSince1970: 1_700_000_000))
        let cache = OfflineCache(root: root, now: { clock.now })
        cache.currentUser = alice
        cache.write(["fresh"], key: "events.b")
        clock.now = clock.now.addingTimeInterval(OfflineCache.maxAge + 1)
        #expect(cache.read([String].self, key: "events.b") == nil, "older than 30 days")

        let file = root.appending(path: alice.uuidString.lowercased()).appending(path: "food.b.json")
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(#"{"v":99,"savedAt":0,"data":["x"]}"#.utf8).write(to: file)
        #expect(cache.read([String].self, key: "food.b") == nil, "another version")
        #expect(!FileManager.default.fileExists(atPath: file.path(percentEncoded: false)))
        try Data("not json".utf8).write(to: file)
        #expect(cache.read([String].self, key: "food.b") == nil)
    }

    @Test func keysMatchTheOtherClients() {
        #expect(OfflineCache.Key.bubbles == "bubbles")
        #expect(OfflineCache.Key.chat(bubble) == "chat.aaaaaaaa-0000-0000-0000-000000000001")
        #expect(OfflineCache.Key.members(bubble) == "members.aaaaaaaa-0000-0000-0000-000000000001")
        #expect(OfflineCache.Key.home(bubble).hasPrefix("home."))
    }

    @Test func snapshotsKeepStoragePathsNotSignedURLs() throws {
        let cache = OfflineCache(root: tempRoot())
        cache.currentUser = alice
        let item = message("photo", at: 1)
        cache.write([item], key: "chat.y")
        let file = cache.root.appending(path: alice.uuidString.lowercased()).appending(path: "chat.y.json")
        let text = try String(contentsOf: file, encoding: .utf8)
        #expect(text.contains("a.jpg"))
        #expect(!text.contains("token="), "never a signed URL")
    }
}

@Suite("Offline: chat outbox")
@MainActor
struct ChatOutboxTests {
    private let alice = UUID(uuidString: "11111111-1111-1111-1111-111111111111")!
    private let bubble = UUID(uuidString: "aaaaaaaa-0000-0000-0000-000000000001")!
    private let other = UUID(uuidString: "aaaaaaaa-0000-0000-0000-000000000002")!

    private func outbox(_ dir: URL? = nil) -> ChatOutbox {
        let box = ChatOutbox(directory: dir ?? FileManager.default.temporaryDirectory
            .appending(path: "outbox-tests-\(UUID().uuidString)", directoryHint: .isDirectory))
        box.activate(user: alice)
        return box
    }

    private func row(_ m: PendingMessage) -> ChatMessage {
        ChatMessage(id: m.id, bubbleId: m.bubbleId, senderId: m.senderId, content: m.content, createdAt: m.createdAt)
    }

    @Test func onlineSendIsConfirmedAndMerged() async {
        let box = outbox()
        let merged = Recorder<ChatMessage>()
        box.deliver = { .sent(self.row($0)) }
        box.onSent = { merged.values.append($0) }
        let m = await box.enqueue(bubbleID: bubble, senderID: alice, text: "hi", photo: nil, online: true)
        #expect(box.items.isEmpty)
        #expect(merged.values.map(\.id) == [m.id], "the server row carries the client id")
    }

    @Test func failureIsKeptAsNotSentThenRetried() async {
        let box = outbox()
        let answers = Recorder<DeliveryOutcome>()
        box.deliver = { _ in answers.values.append(answers.values.isEmpty ? .failed : .sent(nil)); return answers.values.last! }
        let m = await box.enqueue(bubbleID: bubble, senderID: alice, text: "hi", photo: nil, online: true)
        #expect(box.items.map(\.state) == [.failed], "no silent loss")
        // The retry answers "sent" (e.g. 23505: the first attempt had reached the server).
        await box.retry(m.id)
        #expect(box.items.isEmpty)
        #expect(answers.values.count == 2)
    }

    @Test func offlineMessagesWaitAndFlushInOrder() async {
        let box = outbox()
        let order = Recorder<String>()
        box.deliver = { order.values.append($0.content); return .sent(nil) }
        let t0 = Date(timeIntervalSince1970: 100)
        await box.enqueue(bubbleID: bubble, senderID: alice, text: "second", photo: nil, online: false,
                          now: t0.addingTimeInterval(1))
        await box.enqueue(bubbleID: bubble, senderID: alice, text: "first", photo: nil, online: false, now: t0)
        #expect(box.items.allSatisfy { $0.state == .sending })
        #expect(order.values.isEmpty)
        await box.flush()
        #expect(order.values == ["first", "second"])
        #expect(box.items.isEmpty)
    }

    @Test func flushSkipsFailedMessages() async {
        let box = outbox()
        box.deliver = { _ in .failed }
        await box.enqueue(bubbleID: bubble, senderID: alice, text: "a", photo: nil, online: true)
        let calls = Recorder<Int>()
        box.deliver = { _ in calls.values.append(1); return .sent(nil) }
        await box.flush()
        #expect(calls.values.isEmpty, "failed messages wait for a tap")
        #expect(box.items.count == 1)
    }

    @Test func pendingHidesServerEchoesAndOtherBubbles() async {
        let box = outbox()
        box.deliver = nil
        let a = await box.enqueue(bubbleID: bubble, senderID: alice, text: "a", photo: nil, online: false,
                                  now: Date(timeIntervalSince1970: 2))
        let b = await box.enqueue(bubbleID: bubble, senderID: alice, text: "b", photo: nil, online: false,
                                  now: Date(timeIntervalSince1970: 1))
        await box.enqueue(bubbleID: other, senderID: alice, text: "c", photo: nil, online: false)
        #expect(box.pending(in: bubble).map(\.id) == [b.id, a.id])
        #expect(box.pending(in: bubble, excluding: [a.id]).map(\.id) == [b.id], "the realtime echo arrived first")
    }

    @Test func textIsPersistedAndRestoredAsNotSent() async {
        let dir = FileManager.default.temporaryDirectory.appending(path: "outbox-tests-\(UUID().uuidString)", directoryHint: .isDirectory)
        let box = outbox(dir)
        box.deliver = nil
        let text = await box.enqueue(bubbleID: bubble, senderID: alice, text: "keep me", photo: nil, online: false)
        await box.enqueue(bubbleID: bubble, senderID: alice, text: "caption", photo: Data([0xFF, 0xD8]), online: false)

        let restarted = outbox(dir)
        #expect(restarted.items.map(\.id) == [text.id], "photo messages are memory-only")
        #expect(restarted.items.first?.state == .failed, "no surprise sends after a restart")
        #expect(restarted.items.first?.content == "keep me")
    }

    @Test func discardAndSignOut() async {
        let dir = FileManager.default.temporaryDirectory.appending(path: "outbox-tests-\(UUID().uuidString)", directoryHint: .isDirectory)
        let box = outbox(dir)
        box.deliver = nil
        let m = await box.enqueue(bubbleID: bubble, senderID: alice, text: "x", photo: nil, online: false)
        #expect(box.discard(m.id)?.id == m.id)
        #expect(box.items.isEmpty)
        await box.enqueue(bubbleID: bubble, senderID: alice, text: "y", photo: nil, online: false)
        box.clearAll()
        #expect(box.items.isEmpty)
        #expect(!FileManager.default.fileExists(atPath: dir.path(percentEncoded: false)))
        #expect(outbox(dir).items.isEmpty)
    }

    @Test func anotherUserNeverSeesTheOutbox() async {
        let dir = FileManager.default.temporaryDirectory.appending(path: "outbox-tests-\(UUID().uuidString)", directoryHint: .isDirectory)
        let box = outbox(dir)
        box.deliver = nil
        await box.enqueue(bubbleID: bubble, senderID: alice, text: "secret", photo: nil, online: false)
        let bobBox = ChatOutbox(directory: dir)
        bobBox.activate(user: UUID(uuidString: "22222222-2222-2222-2222-222222222222")!)
        #expect(bobBox.items.isEmpty)
        #expect(outbox(dir).items.isEmpty, "Alice's file was deleted when Bob signed in")
    }

    @Test func photoPathUsesTheClientID() {
        let m = PendingMessage(id: UUID(uuidString: "00000000-0000-0000-0000-0000000000AB")!, bubbleId: bubble, senderId: alice,
                               content: "", createdAt: .now, state: .sending, photo: Data([1]))
        #expect(m.photoPath == "11111111-1111-1111-1111-111111111111/00000000-0000-0000-0000-0000000000ab.jpg")
    }

    @Test func duplicateErrorsCountAsDone() {
        #expect(ChatOutbox.isDuplicate(PostgrestError(code: "23505", message: "duplicate key value violates unique constraint")))
        #expect(!ChatOutbox.isDuplicate(PostgrestError(code: "42501", message: "new row violates row-level security policy")))
        #expect(!ChatOutbox.isDuplicate(URLError(.timedOut)))
        #expect(ChatOutbox.isAlreadyUploaded(StorageError(statusCode: "409", message: "The resource already exists", error: "Duplicate")))
        #expect(ChatOutbox.isAlreadyUploaded(StorageError(statusCode: "400", message: "The resource already exists")))
        #expect(!ChatOutbox.isAlreadyUploaded(StorageError(statusCode: "413", message: "Payload too large")))
    }

    @Test func insertCarriesTheClientID() throws {
        let id = UUID()
        let with = try JSONSerialization.jsonObject(with: JSONEncoder().encode(
            NewChatMessage(id: id, bubbleId: bubble, senderId: alice, content: "hi"))) as? [String: Any]
        #expect((with?["id"] as? String)?.lowercased() == id.uuidString.lowercased())
        let without = try JSONSerialization.jsonObject(with: JSONEncoder().encode(
            NewChatMessage(bubbleId: bubble, senderId: alice, content: "hi"))) as? [String: Any]
        #expect(without?["id"] == nil, "no id: the database generates one")
    }
}

/// Collects values from the outbox's main-actor callbacks.
@MainActor
private final class Recorder<T> {
    var values: [T] = []
}

private final class TestClock: @unchecked Sendable {
    var now: Date
    init(_ now: Date) { self.now = now }
}
