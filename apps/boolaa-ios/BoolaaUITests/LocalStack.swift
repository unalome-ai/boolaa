import Foundation
import XCTest

/// Talks to the local Supabase stack (127.0.0.1:55321) and Mailpit (:55324) for UI tests: throwaway users,
/// feature flags, suspensions and emailed codes. The service-role key comes from the environment
/// (`TEST_RUNNER_BOOLAA_SERVICE_ROLE_KEY=… xcodebuild test`), never from the repo. Local stack only.
enum LocalStack {
    static let api = URL(string: "http://127.0.0.1:55321")!
    static let mailpit = URL(string: "http://127.0.0.1:55324")!

    static var serviceKey: String? { ProcessInfo.processInfo.environment["BOOLAA_SERVICE_ROLE_KEY"].flatMap { $0.isEmpty ? nil : $0 } }
    static var anonKey: String? { ProcessInfo.processInfo.environment["BOOLAA_ANON_KEY"].flatMap { $0.isEmpty ? nil : $0 } }

    static func requireKeys() throws -> (service: String, anon: String) {
        guard let service = serviceKey, let anon = anonKey else {
            throw XCTSkip("Set TEST_RUNNER_BOOLAA_SERVICE_ROLE_KEY and TEST_RUNNER_BOOLAA_ANON_KEY (from `supabase status -o env`).")
        }
        return (service, anon)
    }

    struct User: Sendable { let id: String; let email: String; let password: String }

    // MARK: HTTP

    @discardableResult
    static func request(_ method: String, _ url: URL, key: String, bearer: String? = nil, json: Any? = nil,
                        headers: [String: String] = [:]) async throws -> (Int, Data) {
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue(key, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(bearer ?? key)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        if let json { req.httpBody = try JSONSerialization.data(withJSONObject: json) }
        let (data, response) = try await URLSession.shared.data(for: req)
        return ((response as? HTTPURLResponse)?.statusCode ?? 0, data)
    }

    static func object(_ data: Data) -> [String: Any] { (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:] }

    // MARK: Users

    /// A confirmed throwaway user with the sign-up metadata (16+ confirmed), no bubbles.
    static func createUser(prefix: String) async throws -> User {
        let keys = try requireKeys()
        let email = "ios-\(prefix)-\(UUID().uuidString.prefix(8).lowercased())@boolaa.test"
        let (status, data) = try await request("POST", api.appending(path: "auth/v1/admin/users"), key: keys.service, json: [
            "email": email, "password": "password123", "email_confirm": true,
            "user_metadata": ["name": "UI \(prefix)", "locale": "en", "age_confirmed": true, "terms_version": "2026-11-22"],
        ])
        guard status == 200, let id = object(data)["id"] as? String else {
            throw NSError(domain: "LocalStack", code: status, userInfo: [NSLocalizedDescriptionKey: String(decoding: data, as: UTF8.self)])
        }
        return User(id: id, email: email, password: "password123")
    }

    static func deleteUser(_ user: User) async {
        guard let key = serviceKey else { return }
        _ = try? await request("DELETE", api.appending(path: "auth/v1/admin/users/\(user.id)"), key: key)
    }

    static func userExists(_ user: User) async throws -> Bool {
        let (status, _) = try await request("GET", api.appending(path: "auth/v1/admin/users/\(user.id)"), key: try requireKeys().service)
        return status == 200
    }

    /// Password sign-in through Auth; returns the access token, or nil (e.g. 400 user_banned / bad password).
    static func signIn(_ email: String, password: String) async throws -> String? {
        let keys = try requireKeys()
        var url = URLComponents(url: api.appending(path: "auth/v1/token"), resolvingAgainstBaseURL: false)!
        url.queryItems = [URLQueryItem(name: "grant_type", value: "password")]
        let (status, data) = try await request("POST", url.url!, key: keys.anon, bearer: keys.anon,
                                               json: ["email": email, "password": password])
        return status == 200 ? object(data)["access_token"] as? String : nil
    }

    static func rpc(_ name: String, token: String, params: [String: Any] = [:]) async throws -> (Int, Data) {
        try await request("POST", api.appending(path: "rest/v1/rpc/\(name)"), key: try requireKeys().anon, bearer: token, json: params)
    }

    static func deviceCode(token: String, _ body: [String: Any]) async throws -> (Int, Data) {
        try await request("POST", api.appending(path: "functions/v1/device-code"), key: try requireKeys().anon, bearer: token, json: body)
    }

    /// Trusts a device for the user through the real code flow (send → Mailpit → verify).
    static func trustDevice(_ user: User, token: String, deviceID: String, label: String) async throws {
        let since = Date.now
        let (sent, body) = try await deviceCode(token: token, ["action": "send", "purpose": "device", "device_id": deviceID, "label": label])
        XCTAssertEqual(sent, 200, String(decoding: body, as: UTF8.self))
        let code = try await waitForCode(to: user.email, after: since)
        let (verified, vbody) = try await deviceCode(token: token, ["action": "verify", "purpose": "device", "device_id": deviceID, "label": label, "code": code])
        XCTAssertEqual(verified, 200, String(decoding: vbody, as: UTF8.self))
    }

    // MARK: Flags and moderation (service role)

    /// Turns device-verification enforcement on or off. Keep the ON window short (the DB is shared) and always
    /// turn it off in a teardown block.
    static func setEnforcement(_ on: Bool) async throws {
        let key = try requireKeys().service
        let (status, data) = try await request("PATCH", api.appending(path: "rest/v1/app_settings").appending(queryItems: [URLQueryItem(name: "id", value: "eq.true")]),
                                               key: key, json: ["device_verification_enforced": on, "updated_at": ISO8601DateFormatter().string(from: .now)])
        XCTAssert((200..<300).contains(status), String(decoding: data, as: UTF8.self))
    }

    /// The same columns a moderator's "Suspend" sets on `users` (without the GoTrue ban, so the session keeps working).
    static func suspend(_ user: User, until: Date, reason: String) async throws {
        let key = try requireKeys().service
        let (status, data) = try await request("PATCH", api.appending(path: "rest/v1/users").appending(queryItems: [URLQueryItem(name: "id", value: "eq.\(user.id)")]),
                                               key: key, json: ["status": "suspended", "status_until": ISO8601DateFormatter().string(from: until), "status_reason": reason])
        XCTAssert((200..<300).contains(status), String(decoding: data, as: UTF8.self))
    }

    /// GoTrue ban (`banned_until`), so password sign-in answers 400 user_banned.
    static func ban(_ user: User, hours: Int) async throws {
        let key = try requireKeys().service
        let (status, data) = try await request("PUT", api.appending(path: "auth/v1/admin/users/\(user.id)"), key: key, json: ["ban_duration": "\(hours)h"])
        XCTAssertEqual(status, 200, String(decoding: data, as: UTF8.self))
    }

    // MARK: Mailpit

    /// Polls Mailpit for the newest email to `address` received after `after` and returns its 6-digit code.
    static func waitForCode(to address: String, after: Date, timeout: TimeInterval = 30) async throws -> String {
        let deadline = Date.now.addingTimeInterval(timeout)
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        while Date.now < deadline {
            var url = URLComponents(url: mailpit.appending(path: "api/v1/search"), resolvingAgainstBaseURL: false)!
            url.queryItems = [URLQueryItem(name: "query", value: "to:\"\(address)\""), URLQueryItem(name: "limit", value: "5")]
            let (data, _) = try await URLSession.shared.data(from: url.url!)
            let messages = object(data)["messages"] as? [[String: Any]] ?? []
            if let newest = messages.first(where: { m in
                guard let created = (m["Created"] as? String).flatMap(iso.date(from:)) else { return false }
                return created >= after.addingTimeInterval(-2)
            }), let id = newest["ID"] as? String {
                let (body, _) = try await URLSession.shared.data(from: mailpit.appending(path: "api/v1/message/\(id)"))
                let text = object(body)["Text"] as? String ?? ""
                if let range = text.range(of: #"\b\d{6}\b"#, options: .regularExpression) { return String(text[range]) }
            }
            try await Task.sleep(for: .milliseconds(500))
        }
        throw NSError(domain: "LocalStack", code: 1, userInfo: [NSLocalizedDescriptionKey: "No code emailed to \(address)"])
    }
}
