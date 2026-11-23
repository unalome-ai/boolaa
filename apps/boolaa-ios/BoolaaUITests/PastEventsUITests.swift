import XCTest

/// Past events (docs/boolaa-spec.md "Events"): after the upcoming ones, a "Past events" section whose cards
/// show "Ended" instead of RSVP. Needs an ended event in Flatmates (the seed has none: skipped on a fresh seed).
/// With TEST_RUNNER_SHOT_DIR set, saves a screenshot there.
final class PastEventsUITests: XCTestCase {
    @MainActor
    func testPastEventsHaveNoRSVP() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-UITestAutoLogin", "alice@boolaa.test", "-UITestDeviceID", "boolaa-test-device",
                               "-UITestBubble", "Flatmates", "-UITestTab", "events", "-UITestShowPast", "YES",
                               "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        XCTAssertTrue(app.staticTexts["My events"].waitForExistence(timeout: 30))
        let header = app.buttons["past-events"]
        for _ in 0..<6 where !header.exists { app.swipeUp() }
        guard header.waitForExistence(timeout: 3) else { throw XCTSkip("No ended event in Flatmates") }
        app.swipeUp()
        let ended = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'rsvp-ended-'"))
        XCTAssertTrue(ended.firstMatch.waitForExistence(timeout: 5))
        for i in 0..<ended.count {
            let title = ended.element(boundBy: i).identifier.replacingOccurrences(of: "rsvp-ended-", with: "")
            XCTAssertFalse(app.buttons["rsvp-\(title)"].exists, "past event \(title) has no RSVP button")
        }
        let shot = app.screenshot()
        if let dir = ProcessInfo.processInfo.environment["SHOT_DIR"], !dir.isEmpty {
            try shot.pngRepresentation.write(to: URL(fileURLWithPath: dir).appending(path: "ios-past-events.png"))
        }
        let attachment = XCTAttachment(screenshot: shot)
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
