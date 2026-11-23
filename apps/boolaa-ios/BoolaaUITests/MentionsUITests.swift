import XCTest

/// Chat @mentions end to end (docs/boolaa-spec.md, "Mentions"): type "@", pick a member, a token deletes as one
/// unit, the stored row carries the span; a message from someone else that mentions me reads "… mentioned you".
/// Two throwaway users share a new bubble; both are deleted afterwards.
final class MentionsUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    @MainActor
    func testPickTokenBackspaceSendAndMentionedYou() async throws {
        let me = try await LocalStack.createUser(prefix: "mention-me")
        addTeardownBlock { await LocalStack.deleteUser(me) }
        let ana = try await LocalStack.createUser(prefix: "mention-ana")
        addTeardownBlock { await LocalStack.deleteUser(ana) }
        let mySignIn = try await LocalStack.signIn(me.email, password: me.password)
        let myToken = try XCTUnwrap(mySignIn)
        let anaSignIn = try await LocalStack.signIn(ana.email, password: ana.password)
        let anaToken = try XCTUnwrap(anaSignIn)
        let name = "Mentions \(UUID().uuidString.prefix(6))"
        let (created, bubbleData) = try await LocalStack.rpc("create_bubble", token: myToken, params: ["p_name": name])
        XCTAssertEqual(created, 200, String(decoding: bubbleData, as: UTF8.self))
        let bubble = LocalStack.object(bubbleData)
        let bubbleID = try XCTUnwrap(bubble["id"] as? String), code = try XCTUnwrap(bubble["invite_code"] as? String)
        let (_, joinData) = try await LocalStack.rpc("request_to_join", token: anaToken, params: ["p_invite_code": code])
        let requestID = try XCTUnwrap(LocalStack.object(joinData)["id"] as? String)
        let (approved, approveData) = try await LocalStack.rpc("approve_join_request", token: myToken, params: ["p_request_id": requestID])
        XCTAssertEqual(approved, 200, String(decoding: approveData, as: UTF8.self))
        let anaName = "UI mention-ana" // createUser names users "UI <prefix>"

        let app = XCUIApplication()
        app.launchArguments = ["-UITestAutoLogin", me.email, "-UITestPassword", me.password,
                               "-UITestDeviceID", "uitest-\(UUID().uuidString)", "-UITestBubble", name,
                               "-UITestOpen", "chat", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        let input = app.textViews["chat-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 30))
        focus(input)

        // "@" lists the member; a row is a button "Mention <name>".
        input.typeText("Hi @ana")
        let row = app.buttons["mention-row-\(anaName)"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), "the mention list")
        XCTAssertEqual(row.label, "Mention \(anaName)")
        XCTAssertTrue(app.descendants(matching: .any)["mention-list"].exists)
        row.tap()
        XCTAssertEqual(input.value as? String, "Hi @\(anaName) ")

        // Backspace twice: the space, then the whole token in one keystroke.
        input.typeText(XCUIKeyboardKey.delete.rawValue)
        input.typeText(XCUIKeyboardKey.delete.rawValue)
        XCTAssertEqual(input.value as? String, "Hi ")

        // Pick again and send.
        input.typeText("@")
        XCTAssertEqual(input.value as? String, "Hi @")
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        // The keyboard's autocorrect "undo" bubble can float over the right end of the row: tap its leading part.
        row.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.5)).tap()
        XCTAssertEqual(input.value as? String, "Hi @\(anaName) ")
        input.typeText("can you buy milk?")
        XCTAssertEqual(input.value as? String, "Hi @\(anaName) can you buy milk?")
        app.buttons["chat-send"].tap()
        let sentText = "Hi @\(anaName) can you buy milk?"
        let sent = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier BEGINSWITH 'message-' AND label CONTAINS %@", sentText)).firstMatch
        XCTAssertTrue(sent.waitForExistence(timeout: 15), app.debugDescription)

        // The stored row carries the span in code points.
        let rows = try await messages(bubbleID, token: anaToken)
        let mine = try XCTUnwrap(rows.first { ($0["content"] as? String) == sentText })
        let spans = try XCTUnwrap(mine["mentions"] as? [[String: Any]])
        XCTAssertEqual(spans.count, 1)
        XCTAssertEqual(spans.first?["start"] as? Int, 3)
        XCTAssertEqual(spans.first?["length"] as? Int, anaName.count + 1)
        XCTAssertEqual((spans.first?["user_id"] as? String)?.lowercased(), ana.id.lowercased())

        // Ana mentions me: the message reads "<Ana> mentioned you" first.
        let text = "@UI mention-me look 🍕"
        let keys = try LocalStack.requireKeys()
        let (status, body) = try await LocalStack.request("POST", LocalStack.api.appending(path: "rest/v1/chat_messages"), key: keys.anon,
                                                          bearer: anaToken, json: Self.message(bubbleID, ana.id, text, me.id))
        XCTAssertEqual(status, 201, String(decoding: body, as: UTF8.self))
        let mention = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier BEGINSWITH 'message-' AND label BEGINSWITH %@", "\(anaName) mentioned you")).firstMatch
        XCTAssertTrue(mention.waitForExistence(timeout: 15), "live message that mentions me")
        XCTAssertTrue(mention.label.contains(text), mention.label)
    }

    /// The insert body (plain strings and numbers only, so it stays Sendable).
    private static func message(_ bubble: String, _ sender: String, _ text: String, _ mentioned: String) -> [String: any Sendable] {
        let span: [String: any Sendable] = ["start": 0, "length": 14, "user_id": mentioned]
        let spans: [any Sendable] = [span]
        return ["bubble_id": bubble, "sender_id": sender, "content": text, "mentions": spans]
    }

    @MainActor
    private func messages(_ bubble: String, token: String) async throws -> [[String: Any]] {
        let keys = try LocalStack.requireKeys()
        var url = URLComponents(url: LocalStack.api.appending(path: "rest/v1/chat_messages"), resolvingAgainstBaseURL: false)!
        url.queryItems = [URLQueryItem(name: "bubble_id", value: "eq.\(bubble)"), URLQueryItem(name: "select", value: "content,mentions")]
        let (_, data) = try await LocalStack.request("GET", url.url!, key: keys.anon, bearer: token)
        return (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] ?? []
    }

    @MainActor
    private func focus(_ element: XCUIElement) {
        for _ in 0..<5 {
            element.tap()
            if (element.value(forKey: "hasKeyboardFocus") as? Bool) == true { return }
            sleep(1)
        }
        XCTFail("Could not focus \(element)")
    }
}
