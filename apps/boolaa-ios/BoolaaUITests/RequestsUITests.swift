import XCTest

/// "I want it", the owner's pick and the hand-over, and the food expiry label (docs/boolaa-spec.md, "Requests and
/// picking", "Food expiry"), end to end against the local stack. Each test makes two throwaway users (an owner and a
/// member of the owner's new bubble) and deletes them afterwards; their bubble goes with its last member.
final class RequestsUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    struct Pair {
        let owner: LocalStack.User, ownerToken: String
        let asker: LocalStack.User, askerToken: String
        let bubbleID: String, bubbleName: String
    }

    @MainActor
    private func pair() async throws -> Pair {
        let owner = try await LocalStack.createUser(prefix: "req-owner")
        addTeardownBlock { await LocalStack.deleteUser(owner) }
        let asker = try await LocalStack.createUser(prefix: "req-asker")
        addTeardownBlock { await LocalStack.deleteUser(asker) }
        let ownerSignIn = try await LocalStack.signIn(owner.email, password: owner.password)
        let ownerToken = try XCTUnwrap(ownerSignIn)
        let askerSignIn = try await LocalStack.signIn(asker.email, password: asker.password)
        let askerToken = try XCTUnwrap(askerSignIn)
        let name = "Requests \(UUID().uuidString.prefix(6))"
        let (created, bubbleData) = try await LocalStack.rpc("create_bubble", token: ownerToken, params: ["p_name": name])
        XCTAssertEqual(created, 200, String(decoding: bubbleData, as: UTF8.self))
        let bubble = LocalStack.object(bubbleData)
        let bubbleID = try XCTUnwrap(bubble["id"] as? String), code = try XCTUnwrap(bubble["invite_code"] as? String)
        let (joined, joinData) = try await LocalStack.rpc("request_to_join", token: askerToken, params: ["p_invite_code": code])
        XCTAssertEqual(joined, 200, String(decoding: joinData, as: UTF8.self))
        let requestID = try XCTUnwrap(LocalStack.object(joinData)["id"] as? String)
        let (approved, approveData) = try await LocalStack.rpc("approve_join_request", token: ownerToken, params: ["p_request_id": requestID])
        XCTAssertEqual(approved, 200, String(decoding: approveData, as: UTF8.self))
        return Pair(owner: owner, ownerToken: ownerToken, asker: asker, askerToken: askerToken, bubbleID: bubbleID, bubbleName: name)
    }

    /// Inserts a row as `token`'s user through PostgREST and returns its id.
    @MainActor
    private func insert(_ table: String, token: String, _ row: [String: String]) async throws -> String {
        let keys = try LocalStack.requireKeys()
        let (status, data) = try await LocalStack.request("POST", LocalStack.api.appending(path: "rest/v1/\(table)"), key: keys.anon,
                                                          bearer: token, json: row, headers: ["Prefer": "return=representation"])
        XCTAssertEqual(status, 201, String(decoding: data, as: UTF8.self))
        let rows = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]]
        return try XCTUnwrap(rows?.first?["id"] as? String)
    }

    /// The caller's view of `item_requests` for one item.
    @MainActor
    private func requests(item: String, token: String) async throws -> [[String: Any]] {
        let keys = try LocalStack.requireKeys()
        var url = URLComponents(url: LocalStack.api.appending(path: "rest/v1/item_requests"), resolvingAgainstBaseURL: false)!
        url.queryItems = [URLQueryItem(name: "item_id", value: "eq.\(item)"), URLQueryItem(name: "select", value: "status,note")]
        let (_, data) = try await LocalStack.request("GET", url.url!, key: keys.anon, bearer: token)
        return (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] ?? []
    }

    @MainActor
    private func launch(_ user: LocalStack.User, _ pair: Pair, tab: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-UITestAutoLogin", user.email, "-UITestPassword", user.password,
                               "-UITestDeviceID", "uitest-\(UUID().uuidString)", "-UITestBubble", pair.bubbleName,
                               "-UITestTab", tab, "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        return app
    }

    @MainActor
    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    @MainActor
    private func card(_ app: XCUIApplication, _ title: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "market-item-\(title)")).firstMatch
    }

    /// A member asks with a note, sees "Requested", withdraws without a confirmation and can ask again.
    @MainActor
    func testMemberRequestsAndWithdraws() async throws {
        let p = try await pair()
        let title = "Lamp \(UUID().uuidString.prefix(4))"
        let item = try await insert("market_items", token: p.ownerToken, ["bubble_id": p.bubbleID, "owner_id": p.owner.id,
                                                                          "image": "", "title": title, "status": "free"])
        let app = launch(p.asker, p, tab: "marketplace")
        XCTAssertTrue(card(app, title).waitForExistence(timeout: 30))
        card(app, title).tap()
        let want = app.buttons["request-i-want-it"].firstMatch
        XCTAssertTrue(want.waitForExistence(timeout: 10))
        XCTAssertEqual(want.label, "I want it: \(title)")
        want.tap()
        let note = element(app, "request-note")
        XCTAssertTrue(note.waitForExistence(timeout: 5))
        note.typeText("Is it still free?")
        app.buttons["request-send"].firstMatch.tap()
        XCTAssertTrue(element(app, "request-requested").waitForExistence(timeout: 10), "Requested chip")
        let owners = try await requests(item: item, token: p.ownerToken)
        XCTAssertEqual(owners.count, 1)
        XCTAssertEqual(owners.first?["note"] as? String, "Is it still free?")
        XCTAssertEqual(owners.first?["status"] as? String, "pending")

        app.buttons["request-withdraw"].firstMatch.tap()
        XCTAssertTrue(app.buttons["request-i-want-it"].firstMatch.waitForExistence(timeout: 10), "back to I want it")
        let after = try await requests(item: item, token: p.ownerToken)
        XCTAssertTrue(after.isEmpty)
    }

    /// The owner sees the request count, opens Requests, picks (badge "Reserved for …"), then hands over (Taken);
    /// the asker's request becomes received.
    @MainActor
    func testOwnerPicksAndHandsOver() async throws {
        let p = try await pair()
        let title = "Chair \(UUID().uuidString.prefix(4))"
        let item = try await insert("market_items", token: p.ownerToken, ["bubble_id": p.bubbleID, "owner_id": p.owner.id,
                                                                          "image": "", "title": title, "status": "free"])
        let (asked, body) = try await LocalStack.rpc("request_item", token: p.askerToken,
                                                     params: ["p_kind": "market", "p_item_id": item, "p_note": "Tonight?"])
        XCTAssertEqual(asked, 200, String(decoding: body, as: UTF8.self))

        let app = launch(p.owner, p, tab: "marketplace")
        XCTAssertTrue(card(app, title).waitForExistence(timeout: 30))
        XCTAssertTrue(card(app, title).label.contains("1 request"), card(app, title).label)
        card(app, title).tap()
        let open = app.buttons["owner-requests"].firstMatch
        XCTAssertTrue(open.waitForExistence(timeout: 10))
        open.tap()
        XCTAssertTrue(app.staticTexts["Tonight?"].waitForExistence(timeout: 10), "the note")
        let pick = app.buttons["requests-pick"].firstMatch
        XCTAssertEqual(pick.label, "Pick: UI req-asker") // createUser names users "UI <prefix>"
        pick.tap()
        XCTAssertTrue(app.buttons["requests-hand-over"].firstMatch.waitForExistence(timeout: 10), "the pick pinned with hand-over")
        XCTAssertTrue(element(app, "badge-reserved-for").exists || element(app, "badge-reserved-for").waitForExistence(timeout: 5))
        app.buttons["requests-hand-over"].firstMatch.tap()
        let confirm = app.buttons["requests-hand-over-confirm"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        confirm.tap()
        XCTAssertTrue(element(app, "availability-taken").waitForExistence(timeout: 10), "Taken after the hand-over")
        let mine = try await requests(item: item, token: p.askerToken)
        XCTAssertEqual(mine.first?["status"] as? String, "received")
    }

    /// Food: the card shows its expiry and the member's "I want it" works on the card itself.
    @MainActor
    func testFoodExpiryLabelAndRequest() async throws {
        let p = try await pair()
        let expires = ISO8601DateFormatter().string(from: Date().addingTimeInterval(3 * 3600 - 60))
        let post = try await insert("food_posts", token: p.ownerToken, ["bubble_id": p.bubbleID, "user_id": p.owner.id, "image": "",
                                                                       "description": "Soup for two", "expires_at": expires])
        let app = launch(p.asker, p, tab: "food")
        let label = element(app, "food-expiry")
        XCTAssertTrue(label.waitForExistence(timeout: 30))
        XCTAssertEqual(label.label, "Expires in 2 hours")
        let want = app.buttons["request-i-want-it"].firstMatch
        XCTAssertTrue(want.waitForExistence(timeout: 5))
        want.tap()
        XCTAssertTrue(element(app, "request-note").waitForExistence(timeout: 5))
        app.buttons["request-send"].firstMatch.tap()
        XCTAssertTrue(element(app, "request-requested").waitForExistence(timeout: 10))
        let owners = try await requests(item: post, token: p.ownerToken)
        XCTAssertEqual(owners.count, 1)
    }
}
