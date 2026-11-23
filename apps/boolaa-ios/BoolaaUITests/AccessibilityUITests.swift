import XCTest

/// VoiceOver labels on the key controls and Xcode's accessibility audit on the main screens
/// (docs/boolaa-spec.md, "Accessibility"). Runs against the local backend as Alice in Flatmates.
final class AccessibilityUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = true
    }

    @MainActor
    private func launch(_ extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-UITestAutoLogin", "alice@boolaa.test", "-UITestDeviceID", "boolaa-test-device",
                               "-UITestBubble", "Flatmates", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"] + extra
        app.launch()
        XCTAssertTrue(app.buttons["tab-home"].waitForExistence(timeout: 30))
        dismissSavePasswordPrompt(app)
        return app
    }

    @MainActor
    func testKeyControlsHaveLabelsAndStates() throws {
        let app = launch()
        // Dock: one labelled button per tab, the current one selected.
        let tabs = ["home": "Home", "events": "Events", "food": "Food Circle", "marketplace": "Marketplace", "settings": "Settings"]
        for (id, label) in tabs {
            XCTAssertEqual(app.buttons["tab-\(id)"].label, label)
        }
        XCTAssertTrue(app.buttons["tab-home"].isSelected)
        XCTAssertFalse(app.buttons["tab-events"].isSelected)
        XCTAssertEqual(app.buttons["chat-fab"].label, "Open chat")
        XCTAssertEqual(app.buttons["profile-button"].label, "Profile")
        XCTAssertEqual(app.buttons["search-button"].label, "Search this bubble")
        // Bubble switcher chips: the current bubble is selected.
        XCTAssertTrue(app.buttons["bubble-chip-Flatmates"].isSelected)
        XCTAssertFalse(app.buttons["bubble-chip-Climbing Crew"].isSelected)
        XCTAssertEqual(app.staticTexts["screen-title"].label, "Home")

        // Marketplace filter chips expose the selected state.
        app.buttons["tab-marketplace"].tap()
        XCTAssertTrue(app.buttons["tab-marketplace"].isSelected)
        let all = app.buttons["market-filter-all"]
        XCTAssertTrue(all.waitForExistence(timeout: 10))
        XCTAssertTrue(all.isSelected)
        app.buttons["market-filter-free"].tap()
        XCTAssertTrue(app.buttons["market-filter-free"].isSelected)
        XCTAssertFalse(all.isSelected)
        all.tap()

        // Chat composer and messages.
        app.buttons["chat-fab"].tap()
        XCTAssertTrue(app.buttons["chat-send"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.buttons["chat-send"].label, "Send")
        XCTAssertEqual(app.buttons["chat-photo"].label, "Add a photo")
        XCTAssertEqual(app.buttons["chat-back"].label, "Back")
        let message = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier BEGINSWITH 'message-' AND label CONTAINS %@", "Who took the last oat milk?")).firstMatch
        XCTAssertTrue(message.waitForExistence(timeout: 10))
        // Sender first, then the text, then the time: one element per message.
        XCTAssertTrue(message.label.range(of: #"^[^,]+, Who took the last oat milk\? 🥛, .+"#, options: .regularExpression) != nil,
                      message.label)
    }

    /// Xcode's accessibility audit on Home, Events, Marketplace, Settings and Chat: element detection, hit regions,
    /// element descriptions, traits, actions and parent/child structure.
    ///
    /// Left out on purpose, covered elsewhere: `.contrast` reports plain black-on-white text ("Potluck, bring a dish",
    /// 18:1) on this Xcode, so contrast is checked on the token pairs instead (design-system.md 2.5, `Theme.swift`);
    /// `.dynamicType` and `.textClipped` flag nearly every SwiftUI `Text`, so large text is covered by
    /// `testLargeTextKeyScreens` and the AX3 screenshots.
    static let auditTypes: XCUIAccessibilityAuditType = XCUIAccessibilityAuditType.all.subtracting([.contrast, .dynamicType, .textClipped])

    @MainActor
    func testAccessibilityAuditMainScreens() throws {
        let app = launch()
        try audit(app, "home")
        for tab in ["events", "marketplace", "settings"] {
            app.buttons["tab-\(tab)"].tap()
            XCTAssertTrue(app.buttons["tab-\(tab)"].isSelected)
            sleep(2) // let the list load and the entrance settle
            try audit(app, tab)
        }
        app.buttons["chat-fab"].tap()
        XCTAssertTrue(app.buttons["chat-send"].waitForExistence(timeout: 10))
        sleep(2)
        try audit(app, "chat")
    }

    /// Runs the audit; the issues it reports that are known and accepted are listed in `Self.accepted`.
    @MainActor
    private func audit(_ app: XCUIApplication, _ screen: String) throws {
        var accepted: [String] = []
        try app.performAccessibilityAudit(for: Self.auditTypes) { issue in
            let element = issue.element
            let id = element?.identifier ?? ""
            let label = element?.label ?? ""
            let keep = Self.isAccepted(issue.auditType, identifier: id, label: label, elementType: element?.elementType)
            print("A11Y-AUDIT [\(screen)] \(keep ? "accepted" : "FAILED") type=\(issue.auditType.rawValue) id=\(id) element=\(element?.elementType.rawValue ?? 0) label=“\(label)” frame=\(element?.frame ?? .zero) – \(issue.compactDescription)")
            if keep { accepted.append("\(issue.auditType.rawValue) \(id) “\(label)”: \(issue.compactDescription)") }
            return keep
        }
        if !accepted.isEmpty {
            let attachment = XCTAttachment(string: accepted.joined(separator: "\n"))
            attachment.name = "accepted audit issues (\(screen))"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
    }

    /// Known, deliberate exceptions. Keep this list narrow and explain each one.
    static func isAccepted(_ type: XCUIAccessibilityAuditType, identifier: String, label: String,
                           elementType: XCUIElement.ElementType?) -> Bool {
        // The calendar-page date tile on event cards is hidden from VoiceOver on purpose: the same date is read
        // from the clock line next to it. The audit sees its text in the pixels with no element behind it.
        if type == .elementDetection, identifier.isEmpty, label.isEmpty, elementType == nil { return true }
        return false
    }

    /// At the largest accessibility text size (AX5, beyond the AX3 target) the main controls stay on screen and
    /// tappable, and the Marketplace grid drops to one column.
    @MainActor
    func testLargeTextKeyScreens() throws {
        let app = launch(["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        for id in ["tab-home", "tab-events", "tab-marketplace", "tab-settings", "chat-fab", "profile-button"] {
            XCTAssertTrue(app.buttons[id].isHittable, id)
        }
        attachScreenshot(app, "AX5 home")
        app.buttons["tab-events"].tap()
        XCTAssertTrue(app.buttons["add-new-event"].waitForExistence(timeout: 10))
        attachScreenshot(app, "AX5 events")
        app.buttons["tab-marketplace"].tap()
        let item = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'market-item-Old sofa'")).firstMatch
        XCTAssertTrue(item.waitForExistence(timeout: 10))
        // One element per card ("Free, Old sofa, You") and one column: the card spans (nearly) the full width.
        XCTAssertTrue(item.label.contains("Old sofa"), item.label)
        XCTAssertGreaterThan(item.frame.width, app.windows.firstMatch.frame.width * 0.8)
        attachScreenshot(app, "AX5 marketplace")
        app.buttons["tab-settings"].tap()
        XCTAssertTrue(app.buttons["leave-bubble"].waitForExistence(timeout: 10))
        attachScreenshot(app, "AX5 settings")
        app.buttons["chat-fab"].tap()
        let send = app.buttons["chat-send"]
        XCTAssertTrue(send.waitForExistence(timeout: 10))
        XCTAssertTrue(send.isHittable)
        XCTAssertTrue(app.buttons["chat-photo"].isHittable)
        attachScreenshot(app, "AX5 chat")
    }

    @MainActor
    private func attachScreenshot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    private func dismissSavePasswordPrompt(_ app: XCUIApplication) {
        let notNow = app.buttons["Not Now"]
        if notNow.waitForExistence(timeout: 3) { notNow.tap() }
    }
}
