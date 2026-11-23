import XCTest

/// Offline and poor network (docs/boolaa-spec.md): cached last view, the offline banner, the chat outbox and
/// the inline error with Try again. Uses the DEBUG hook `-UITestSimulateOffline YES` (Supabase HTTP requests
/// fail fast, the monitor reports no network) and its hidden `debug-network-toggle` button to come back.
/// Needs the local stack (seeded Alice in Flatmates).
final class OfflineUITests: XCTestCase {
    @MainActor
    private func app(_ extra: [String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-UITestAutoLogin", "alice@boolaa.test", "-UITestDeviceID", "boolaa-test-device",
                               "-UITestBubble", "Flatmates", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"] + extra
        return app
    }

    /// Taps the hidden network switch and checks its label flipped (the tap reached the app).
    @MainActor
    private func toggleNetwork(_ app: XCUIApplication) {
        let toggle = app.buttons.matching(identifier: "debug-network-toggle").firstMatch
        XCTAssertTrue(toggle.waitForExistence(timeout: 5))
        let before = toggle.label
        toggle.tap()
        let flipped = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label != %@", before), object: toggle)
        XCTAssertEqual(XCTWaiter().wait(for: [flipped], timeout: 5), .completed, "the network switch flipped")
    }

    /// Online first (fills the cache), then a cold start offline: the chat shows what was seen last, a message
    /// typed offline shows "Sending…" and arrives exactly once when the network comes back.
    @MainActor
    func testCachedChatAndOfflineSend() throws {
        let online = app(["-UITestOpen", "chat"])
        online.launch()
        XCTAssertTrue(online.textViews["chat-input"].waitForExistence(timeout: 30) || online.textFields["chat-input"].waitForExistence(timeout: 5))
        let messages = online.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'message-'"))
        XCTAssertTrue(messages.firstMatch.waitForExistence(timeout: 15), "seeded chat loaded")
        sleep(2) // the cache is written off the main thread
        online.terminate()

        let offline = app(["-UITestOpen", "chat", "-UITestSimulateOffline", "YES"])
        offline.launch()
        XCTAssertTrue(offline.descendants(matching: .any)["offline-banner"].waitForExistence(timeout: 30))
        let cached = offline.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'message-'"))
        XCTAssertTrue(cached.firstMatch.waitForExistence(timeout: 10), "the cached page shows offline")
        XCTAssertFalse(offline.descendants(matching: .any)["load-failed"].exists)

        let text = "offline \(UUID().uuidString.prefix(6))"
        let input = offline.textViews["chat-input"].exists ? offline.textViews["chat-input"] : offline.textFields["chat-input"]
        input.tap()
        input.typeText(text)
        offline.buttons["chat-send"].tap()
        XCTAssertTrue(offline.descendants(matching: .any)["chat-sending"].waitForExistence(timeout: 5), "queued as Sending…")

        toggleNetwork(offline)
        // "Back online" shows for only 2.5 s, which a slow accessibility snapshot can miss: accept either the
        // pill or the offline banner having gone (the reconnect happened).
        let backOnline = offline.descendants(matching: .any)["back-online"]
        let banner = offline.descendants(matching: .any)["offline-banner"]
        let reconnected = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in backOnline.exists || !banner.exists }, object: nil)
        XCTAssertEqual(XCTWaiter().wait(for: [reconnected], timeout: 10), .completed, "back online")
        let sending = offline.descendants(matching: .any)["chat-sending"]
        let gone = NSPredicate(format: "exists == false")
        expectation(for: gone, evaluatedWith: sending)
        waitForExpectations(timeout: 20)
        let sent = offline.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", text))
        XCTAssertEqual(sent.count, 1, "delivered exactly once (client id + 23505 dedupe)")
    }

    /// A screen with nothing cached shows the inline error with Try again instead of an empty state, and
    /// loads once the network is back.
    @MainActor
    func testUncachedScreenShowsRetry() throws {
        // A fresh sign-in empties the cache (sign-out clears it).
        let reset = app(["-UITestSignOut", "YES"])
        reset.launch()
        reset.terminate()
        let signIn = app(["-UITestTab", "home"])
        signIn.launch()
        XCTAssertTrue(signIn.staticTexts["What's new"].waitForExistence(timeout: 30))
        signIn.terminate()

        let offline = app(["-UITestOpen", "links", "-UITestSimulateOffline", "YES"])
        offline.launch()
        let failed = offline.descendants(matching: .any)["load-failed"]
        XCTAssertTrue(failed.waitForExistence(timeout: 30), "Links was never loaded: inline error, not an empty list")
        XCTAssertTrue(offline.buttons.matching(identifier: "retry").firstMatch.exists)
        XCTAssertTrue(offline.descendants(matching: .any)["offline-banner"].exists)

        toggleNetwork(offline)
        let gone = NSPredicate(format: "exists == false")
        expectation(for: gone, evaluatedWith: failed)
        waitForExpectations(timeout: 20)
    }
}
