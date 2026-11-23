import XCTest

/// Drives the real app against the local backend: log in, chat, switch bubble, open Settings.
final class BoolaaUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    func testLoginChatSwitchBubbleSettings() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-UITestSignOut", "YES", "-UITestDeviceID", "boolaa-test-device", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()

        // Login
        let email = app.textFields["auth-email"]
        XCTAssertTrue(email.waitForExistence(timeout: 15))
        email.tap()
        email.typeText("alice@boolaa.test")
        let password = app.secureTextFields["auth-password"]
        password.tap()
        password.typeText("password123")
        app.buttons["auth-submit"].tap()

        // Home with bubble chips
        let flatChip = app.buttons["bubble-chip-Flatmates"]
        XCTAssertTrue(flatChip.waitForExistence(timeout: 15))
        dismissSavePasswordPrompt(app)
        flatChip.tap()
        XCTAssertTrue(app.staticTexts["Home"].exists)
        attach(app, "home")

        // Chat: send a message and see it appear
        app.buttons["chat-fab"].tap()
        let input = app.textFields["chat-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 10))
        // Each message is one VoiceOver element: "<sender>, <text>, <time>…".
        XCTAssertTrue(chatMessage(app, containing: "Who took the last oat milk? 🥛").waitForExistence(timeout: 10))
        let text = "Hello from UI test \(Int.random(in: 1000...9999))"
        focus(input)
        input.typeText(text)
        app.buttons["chat-send"].tap()
        let sent = chatMessage(app, containing: text)
        XCTAssertTrue(sent.waitForExistence(timeout: 10))
        XCTAssertTrue(sent.label.hasPrefix("You, \(text), "), sent.label)
        attach(app, "chat")
        app.buttons["chat-back"].tap()

        // Switch bubble
        let climbing = app.buttons["bubble-chip-Climbing Crew"]
        XCTAssertTrue(climbing.waitForExistence(timeout: 5))
        climbing.tap()
        XCTAssertTrue(climbing.isSelected)

        // Settings shows the Climbing Crew invite code
        app.buttons["tab-settings"].tap()
        XCTAssertTrue(app.staticTexts["CLIMB123"].waitForExistence(timeout: 10))
        attach(app, "settings")

        // Restore Flatmates as the current bubble for later runs.
        flatChip.tap()
    }

    /// A chat message row (one accessibility element) whose label contains `text`.
    @MainActor
    private func chatMessage(_ app: XCUIApplication, containing text: String) -> XCUIElement {
        app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier BEGINSWITH 'message-' AND label CONTAINS %@", text)).firstMatch
    }

    /// iOS offers to save the password a few seconds after login; its sheet blocks taps until dismissed.
    @MainActor
    private func dismissSavePasswordPrompt(_ app: XCUIApplication) {
        let notNow = app.buttons["Not Now"]
        if notNow.waitForExistence(timeout: 10) { notNow.tap() }
    }

    /// Taps until the field owns keyboard focus (the chat field can miss the first tap while the list auto-scrolls).
    @MainActor
    private func focus(_ element: XCUIElement) {
        for _ in 0..<5 {
            element.tap()
            let focused = NSPredicate(format: "hasKeyboardFocus == true")
            if XCTWaiter().wait(for: [expectation(for: focused, evaluatedWith: element)], timeout: 2) == .completed { return }
        }
        XCTFail("Could not focus \(element)")
    }

    @MainActor
    private func attach(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
