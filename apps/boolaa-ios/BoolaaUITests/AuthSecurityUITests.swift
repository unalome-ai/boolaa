import XCTest

/// Auth-security flows end to end against the local stack, reading emailed codes from Mailpit
/// (docs/auth-security.md §8). Each test uses a throwaway user and deletes it afterwards. Tests that turn on
/// device-verification enforcement keep it on only around the step that needs it and always turn it off in teardown.
final class AuthSecurityUITests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    @MainActor
    private func launch(_ extra: [String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"] + extra
        app.launch()
        return app
    }

    @MainActor
    private func throwaway(_ prefix: String) async throws -> LocalStack.User {
        let user = try await LocalStack.createUser(prefix: prefix)
        addTeardownBlock { await LocalStack.deleteUser(user) }
        return user
    }

    @MainActor
    private func enforcementOn() async throws {
        addTeardownBlock { try? await LocalStack.setEnforcement(false) }
        try await LocalStack.setEnforcement(true)
    }

    @MainActor
    private func signIn(_ app: XCUIApplication, _ email: String, _ password: String) {
        let field = app.textFields["auth-email"]
        XCTAssertTrue(field.waitForExistence(timeout: 15))
        field.tap()
        field.typeText(email)
        let secure = app.secureTextFields["auth-password"]
        secure.tap()
        secure.typeText(password)
        app.buttons["auth-submit"].tap()
    }

    @MainActor
    private func enterCode(_ app: XCUIApplication, _ code: String) {
        let input = app.textFields["code-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 10))
        input.tap()
        input.typeText(code)
    }

    /// Onboarding (no bubbles yet): avatar menu → Profile.
    @MainActor
    private func openProfileFromOnboarding(_ app: XCUIApplication) {
        let avatar = app.buttons["onboarding-profile"]
        XCTAssertTrue(avatar.waitForExistence(timeout: 20))
        avatar.tap()
        let item = app.buttons["onboarding-open-profile"]
        XCTAssertTrue(item.waitForExistence(timeout: 5))
        item.tap()
    }

    @MainActor
    private func dismissSavePasswordPrompt(_ app: XCUIApplication) {
        let notNow = app.buttons["Not Now"]
        if notNow.waitForExistence(timeout: 4) { notNow.tap() }
    }

    @MainActor
    private func attach(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    // MARK: Forgot password

    @MainActor
    func testForgotPasswordWithEmailedCode() async throws {
        let user = try await throwaway("reset")
        let app = launch(["-UITestSignOut", "YES"])

        let forgot = app.buttons["forgot-password"]
        XCTAssertTrue(forgot.waitForExistence(timeout: 15))
        forgot.tap()
        let emailField = app.textFields["reset-email-field"]
        XCTAssertTrue(emailField.waitForExistence(timeout: 5))
        emailField.tap()
        emailField.typeText(user.email)
        let since = Date.now
        app.buttons["reset-send-code"].tap()

        XCTAssertTrue(app.textFields["code-input"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["resend-code"].exists)
        XCTAssertFalse(app.buttons["resend-code"].isEnabled, "resend waits 60 s")
        attach(app, "reset-code")
        let code = try await LocalStack.waitForCode(to: user.email, after: since)
        enterCode(app, code)

        let newPassword = app.secureTextFields["new-password"]
        XCTAssertTrue(newPassword.waitForExistence(timeout: 15))
        newPassword.tap()
        newPassword.typeText("newpassword456")
        app.buttons["save-password"].tap()

        // Signed in through the gate: a throwaway user has no bubbles yet.
        XCTAssertTrue(app.buttons["onboarding-profile"].waitForExistence(timeout: 20))
        let token = try await LocalStack.signIn(user.email, password: "newpassword456")
        XCTAssertNotNil(token, "the new password works")
        let old = try await LocalStack.signIn(user.email, password: user.password)
        XCTAssertNil(old, "the old password no longer works")
    }

    // MARK: Device verification

    @MainActor
    func testNewDeviceNeedsTheEmailedCodeWhenEnforced() async throws {
        let user = try await throwaway("device")
        let app = launch(["-UITestSignOut", "YES", "-UITestDeviceID", "uitest-\(UUID().uuidString)"])
        XCTAssertTrue(app.textFields["auth-email"].waitForExistence(timeout: 15))

        try await enforcementOn()
        let since = Date.now
        signIn(app, user.email, user.password)

        XCTAssertTrue(app.otherElements["device-code"].waitForExistence(timeout: 15) || app.textFields["code-input"].waitForExistence(timeout: 5))
        dismissSavePasswordPrompt(app)
        let code = try await LocalStack.waitForCode(to: user.email, after: since)
        attach(app, "device-code")

        // A wrong code: error with the tries left, the field clears.
        let wrong = code == "000000" ? "111111" : "000000"
        enterCode(app, wrong)
        let error = app.staticTexts.containing(NSPredicate(format: "label CONTAINS[c] %@", "tries left")).firstMatch
        XCTAssertTrue(error.waitForExistence(timeout: 10))
        XCTAssertTrue(error.label.contains("4 tries left"), error.label)
        attach(app, "device-code-wrong")

        enterCode(app, code)
        XCTAssertTrue(app.buttons["onboarding-profile"].waitForExistence(timeout: 20))
        try await LocalStack.setEnforcement(false)
    }

    @MainActor
    func testTrustedDeviceSkipsTheCode() async throws {
        try await enforcementOn()
        let app = launch(["-UITestSignOut", "YES", "-UITestDeviceID", "boolaa-test-device"])
        signIn(app, "alice@boolaa.test", "password123")
        XCTAssertTrue(app.buttons["bubble-chip-Flatmates"].waitForExistence(timeout: 20), "seeded device is trusted: straight to Home")
        XCTAssertFalse(app.textFields["code-input"].exists)
        try await LocalStack.setEnforcement(false)
        dismissSavePasswordPrompt(app)
    }

    @MainActor
    func testRevokeAnotherDevice() async throws {
        let user = try await throwaway("revoke")
        let signedIn = try await LocalStack.signIn(user.email, password: user.password)
        let token = try XCTUnwrap(signedIn)
        let phone = "uitest-phone-\(UUID().uuidString)"
        try await LocalStack.trustDevice(user, token: token, deviceID: phone, label: "iPhone · iOS 27")
        try await LocalStack.trustDevice(user, token: token, deviceID: "uitest-laptop-\(UUID().uuidString)", label: "Chrome on macOS")

        let app = launch(["-UITestDeviceID", phone, "-UITestAutoLogin", user.email])
        openProfileFromOnboarding(app)
        let security = app.buttons["security-row"]
        XCTAssertTrue(security.waitForExistence(timeout: 5))
        security.tap()

        XCTAssertTrue(app.staticTexts["this-device"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Chrome on macOS"].exists)
        XCTAssertEqual(app.buttons.matching(identifier: "revoke-device").count, 1, "no revoke on this device")
        attach(app, "devices")
        app.buttons["revoke-device"].tap()
        let confirm = app.alerts.buttons["Remove device"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        attach(app, "revoke-confirm")
        confirm.tap()

        let gone = NSPredicate(format: "exists == false")
        await fulfillment(of: [XCTNSPredicateExpectation(predicate: gone, object: app.staticTexts["Chrome on macOS"])], timeout: 10)
        XCTAssertTrue(app.staticTexts["this-device"].exists)
        let (_, data) = try await LocalStack.rpc("list_my_devices", token: token)
        let rows = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] ?? []
        XCTAssertEqual(rows.count, 1)
    }

    // MARK: Delete account

    @MainActor
    func testDeleteAccountNeedsTheEmailedCode() async throws {
        let user = try await throwaway("delete")
        let app = launch(["-UITestDeviceID", "uitest-\(UUID().uuidString)", "-UITestAutoLogin", user.email])
        openProfileFromOnboarding(app)
        let delete = app.buttons["delete-account"]
        XCTAssertTrue(delete.waitForExistence(timeout: 5))
        delete.tap()

        let word = app.textFields["delete-confirm-field"]
        XCTAssertTrue(word.waitForExistence(timeout: 5))
        word.tap()
        word.typeText("DELETE")
        let since = Date.now
        app.buttons["delete-account-confirm"].tap()
        XCTAssertTrue(app.staticTexts["delete-code-sent"].waitForExistence(timeout: 10))
        attach(app, "delete-code")
        let existsBefore = try await LocalStack.userExists(user)
        XCTAssertTrue(existsBefore, "nothing is deleted before the code")

        let code = try await LocalStack.waitForCode(to: user.email, after: since)
        enterCode(app, code)
        XCTAssertTrue(app.textFields["auth-email"].waitForExistence(timeout: 20), "signed out after deletion")
        let exists = try await LocalStack.userExists(user)
        XCTAssertFalse(exists)
    }

    // MARK: Suspended

    @MainActor
    func testSuspendedAccountSeesReasonDateAndAppeal() async throws {
        let user = try await throwaway("suspended")
        try await LocalStack.suspend(user, until: Date.now.addingTimeInterval(7 * 86_400), reason: "spam")
        let app = launch(["-UITestDeviceID", "uitest-\(UUID().uuidString)", "-UITestAutoLogin", user.email])

        XCTAssertTrue(app.staticTexts["Your account is suspended"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["suspended-until"].exists)
        XCTAssertTrue(app.staticTexts["suspended-reason"].label.contains("Spam or scam"))
        XCTAssertTrue(app.staticTexts["suspended-appeal"].label.contains("privacy@boolaa.ro"))
        XCTAssertTrue(app.buttons["suspended-delete"].exists)
        attach(app, "suspended")
        app.buttons["suspended-sign-out"].tap()
        XCTAssertTrue(app.textFields["auth-email"].waitForExistence(timeout: 10))

        // Banned at the Auth level: sign-in answers user_banned → the same screen without details.
        try await LocalStack.ban(user, hours: 24)
        signIn(app, user.email, user.password)
        XCTAssertTrue(app.buttons["suspended-back"].waitForExistence(timeout: 15))
        // iOS may offer to save the password after the submitted sign-in; its sheet blocks the tap below.
        dismissSavePasswordPrompt(app)
        XCTAssertTrue(app.staticTexts["This account can't sign in right now: it's suspended or banned."].exists)
        attach(app, "sign-in-blocked")
        // The dismissed password sheet may still be sliding away: wait until the button can take the tap.
        let back = app.buttons["suspended-back"]
        let hittable = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isHittable == true"), object: back)
        _ = await XCTWaiter().fulfillment(of: [hittable], timeout: 5)
        back.tap()
        XCTAssertTrue(app.textFields["auth-email"].waitForExistence(timeout: 5))
    }
}
