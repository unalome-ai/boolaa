import XCTest

/// "Take photo" next to "Choose from gallery" (docs/boolaa-spec.md, Images → Camera). The simulator has no camera,
/// so the DEBUG hook `-UITestCamera fixture` feeds a stand-in photo through the camera path and
/// `-UITestCamera denied` shows the permission message. Needs the local stack (seeded Alice in Flatmates).
final class CameraUITests: XCTestCase {
    @MainActor
    private func chat(_ extra: [String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-UITestAutoLogin", "alice@boolaa.test", "-UITestDeviceID", "boolaa-test-device",
                               "-UITestBubble", "Flatmates", "-UITestOpen", "chat",
                               "-AppleLanguages", "(en)", "-AppleLocale", "en_US"] + extra
        app.launch()
        XCTAssertTrue(app.buttons["chat-photo"].waitForExistence(timeout: 30))
        return app
    }

    /// The camera photo lands in the composer preview through the shared image pipeline; nothing is sent.
    @MainActor
    func testTakePhotoFillsTheComposer() throws {
        let app = chat(["-UITestCamera", "fixture"])
        app.buttons["chat-photo"].tap()
        let camera = app.buttons["photo-source-camera"].firstMatch
        XCTAssertTrue(camera.waitForExistence(timeout: 5))
        XCTAssertEqual(camera.label, "Take photo")
        XCTAssertTrue(app.buttons["photo-source-gallery"].firstMatch.exists)
        camera.tap()
        XCTAssertTrue(app.descendants(matching: .any)["chat-photo-preview"].waitForExistence(timeout: 10))
        app.buttons["chat-photo-remove"].tap()
    }

    @MainActor
    func testDeniedCameraPointsToSettings() throws {
        let app = chat(["-UITestCamera", "denied"])
        app.buttons["chat-photo"].tap()
        let camera = app.buttons["photo-source-camera"].firstMatch
        XCTAssertTrue(camera.waitForExistence(timeout: 5))
        camera.tap()
        let alert = app.alerts.firstMatch
        XCTAssertTrue(alert.waitForExistence(timeout: 5))
        XCTAssertTrue(alert.staticTexts["Allow camera access in Settings to take photos."].exists)
        XCTAssertTrue(alert.buttons["Open Settings"].exists)
        alert.buttons["Not now"].tap()
        XCTAssertFalse(app.descendants(matching: .any)["chat-photo-preview"].exists)
    }

    /// No camera (the simulator without the hook): no menu, the gallery opens straight away.
    @MainActor
    func testNoCameraSkipsTheMenu() throws {
        let app = chat([])
        app.buttons["chat-photo"].tap()
        XCTAssertFalse(app.buttons["photo-source-camera"].firstMatch.waitForExistence(timeout: 3))
    }
}
