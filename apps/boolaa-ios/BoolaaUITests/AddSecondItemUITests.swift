import XCTest

/// TestFlight bug: after adding one marketplace item (or food post), tapping "New item" / "Share food" again
/// must open an EMPTY editor, so a second one can be added. Mirrors production: a fresh user in a fresh bubble
/// (so the first save also plays the "first item" cheer). The photo comes through the camera path with the
/// DEBUG hook `-UITestCamera fixture` (the simulator has no camera and the gallery runs out of process).
/// Needs the local stack; the throwaway user is deleted afterwards (its bubble goes with its last member).
final class AddSecondItemUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    @MainActor
    private func launch(tab: String) async throws -> XCUIApplication {
        let user = try await LocalStack.createUser(prefix: "second-\(tab)")
        addTeardownBlock { await LocalStack.deleteUser(user) }
        let signedIn = try await LocalStack.signIn(user.email, password: user.password)
        let token = try XCTUnwrap(signedIn)
        let (status, body) = try await LocalStack.rpc("create_bubble", token: token, params: ["p_name": "Second \(tab)"])
        XCTAssertEqual(status, 200, String(decoding: body, as: UTF8.self))

        let app = XCUIApplication()
        app.launchArguments = ["-UITestAutoLogin", user.email, "-UITestPassword", user.password,
                               "-UITestDeviceID", "uitest-\(UUID().uuidString)", "-UITestTab", tab,
                               "-UITestCamera", "fixture", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        return app
    }

    /// Photo slot → "Take photo" (the stand-in camera photo) or "Choose from gallery" (the simulator's sample
    /// photos in the system picker, as production users did before the camera existed).
    @MainActor
    private func takePhoto(_ app: XCUIApplication, gallery: Bool = false) {
        let slot = app.buttons["photo-picker"]
        XCTAssertTrue(slot.waitForExistence(timeout: 10))
        slot.tap()
        let source = app.buttons[gallery ? "photo-source-gallery" : "photo-source-camera"].firstMatch
        if source.waitForExistence(timeout: 3) { source.tap() } else { XCTAssertTrue(gallery, "camera option missing") }
        guard gallery else { return }
        let photo = app.images.matching(NSPredicate(format: "label BEGINSWITH 'Photo'")).firstMatch
        XCTAssertTrue(photo.waitForExistence(timeout: 15), "system photo picker")
        photo.tap()
    }

    /// The system photo picker keeps an empty window on top while it slides away: tap until the field has focus.
    @MainActor
    private func focus(_ field: XCUIElement) {
        for _ in 0..<10 {
            field.tap()
            if (field.value(forKey: "hasKeyboardFocus") as? Bool) == true { return }
            sleep(1)
        }
        XCTFail("the field never got keyboard focus")
    }

    @MainActor
    private func save(_ app: XCUIApplication) {
        let save = app.navigationBars.buttons["Save"]
        let enabled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isEnabled == true"), object: save)
        XCTAssertEqual(XCTWaiter().wait(for: [enabled], timeout: 15), .completed, "Save enabled (photo processed)")
        save.tap()
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: save)
        XCTAssertEqual(XCTWaiter().wait(for: [gone], timeout: 20), .completed, "editor closed after saving")
    }

    @MainActor
    private func listItem(_ app: XCUIApplication, title: String, gallery: Bool = false) {
        let add = app.buttons["add-list-item"].firstMatch
        XCTAssertTrue(add.waitForExistence(timeout: 30))
        add.tap()
        XCTAssertTrue(app.navigationBars["List an item"].waitForExistence(timeout: 5), "an empty editor for a NEW item opened")
        let field = app.textFields["Title"]
        XCTAssertTrue(field.exists)
        XCTAssertEqual(field.value as? String ?? "", "Title", "title starts empty (placeholder shown)")
        XCTAssertFalse(app.buttons["market-mark-as"].exists, "not the detail of an existing item")
        takePhoto(app, gallery: gallery)
        focus(field)
        field.typeText(title)
        save(app)
        let card = marketCard(app, title)
        XCTAssertTrue(card.waitForExistence(timeout: 15), "\(title) listed")
    }

    /// The card button's identifier repeats its children's ("market-item-X-market-item-X…").
    @MainActor
    private func marketCard(_ app: XCUIApplication, _ title: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "market-item-\(title)")).firstMatch
    }

    @MainActor
    func testMarketplaceSecondItemOpensEmptyEditor() async throws {
        let app = try await launch(tab: "marketplace")
        listItem(app, title: "First lamp")
        sleep(1) // the cheer and the new card's entrance are still running, as when a user taps right away
        listItem(app, title: "Second lamp")
        XCTAssertTrue(marketCard(app, "First lamp").exists)
    }

    @MainActor
    func testMarketplaceSecondItemViaGallery() async throws {
        let app = try await launch(tab: "marketplace")
        listItem(app, title: "First chair", gallery: true)
        sleep(1)
        listItem(app, title: "Second chair", gallery: true)
        XCTAssertTrue(marketCard(app, "First chair").exists)
    }

    @MainActor
    private func sharePost(_ app: XCUIApplication, text: String, gallery: Bool = false) {
        let add = app.buttons["add-share-food"].firstMatch
        XCTAssertTrue(add.waitForExistence(timeout: 30))
        add.tap()
        XCTAssertTrue(app.navigationBars["Share food"].waitForExistence(timeout: 5), "an empty editor for a NEW post opened")
        XCTAssertFalse(app.navigationBars["Edit post"].exists)
        takePhoto(app, gallery: gallery)
        let field = app.textViews["What are you sharing?"].exists ? app.textViews["What are you sharing?"] : app.textFields["What are you sharing?"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        focus(field)
        field.typeText(text)
        save(app)
        XCTAssertTrue(app.staticTexts[text].waitForExistence(timeout: 15), "\(text) shared")
    }

    @MainActor
    func testFoodSecondPostOpensEmptyEditor() async throws {
        let app = try await launch(tab: "food")
        sharePost(app, text: "First soup")
        sleep(1)
        sharePost(app, text: "Second soup")
        XCTAssertTrue(app.staticTexts["First soup"].exists)
    }

    @MainActor
    func testFoodSecondPostViaGallery() async throws {
        let app = try await launch(tab: "food")
        sharePost(app, text: "First stew", gallery: true)
        sleep(1)
        sharePost(app, text: "Second stew", gallery: true)
        XCTAssertTrue(app.staticTexts["First stew"].exists)
    }
}
