import Foundation
import Supabase
import Testing
@testable import Boolaa

@Suite("Device identity")
struct DeviceIdentityTests {
    @Test func createsA43CharBase64URLIdOnceAndKeepsIt() {
        let store = MemoryDeviceSecretStore()
        let first = DeviceIdentity.load(store: store, label: "iPhone · iOS 27")
        #expect(first.id.count == 43)
        #expect(first.id.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil)
        #expect(store.read() == first.id)
        let again = DeviceIdentity.load(store: store, label: "iPhone · iOS 27")
        #expect(again.id == first.id)
        #expect(DeviceIdentity.load(store: MemoryDeviceSecretStore(), label: "x").id != first.id)
    }

    @Test func replacesAnInvalidStoredIdAndHonoursTheTestOverride() {
        let store = MemoryDeviceSecretStore("short")
        let fresh = DeviceIdentity.load(store: store, label: "x")
        #expect(fresh.id.count == 43 && store.read() == fresh.id)
        let seeded = DeviceIdentity.load(store: store, label: "x", override: "boolaa-test-device")
        #expect(seeded.id == "boolaa-test-device")
        #expect(store.read() == fresh.id, "the override never overwrites the stored id")
    }

    /// The real Keychain item (simulator test host): written once, read back, survives a new load.
    @Test func keychainStoreRoundTrip() {
        let store = KeychainDeviceSecretStore(service: "ro.boolaa.app.tests.device.\(UUID().uuidString)")
        defer { store.delete() }
        #expect(store.read() == nil)
        let created = DeviceIdentity.load(store: store, label: "x")
        #expect(store.read() == created.id)
        #expect(DeviceIdentity.load(store: store, label: "x").id == created.id)
        store.delete()
        #expect(store.read() == nil)
    }

    @Test func hashMatchesTheServerFormat() {
        // sha256("abc"), lowercase hex, as `device_hash_of` stores it.
        #expect(DeviceIdentity.sha256Hex("abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        #expect(DeviceIdentity(id: "boolaa-test-device", label: "").hash.count == 64)
    }

    @Test func labelIsModelAndOSMajor() {
        #expect(DeviceIdentity.makeLabel(model: "iPhone", systemVersion: "27.0.1") == "iPhone · iOS 27")
        #expect(DeviceIdentity.makeLabel(model: "iPad", systemVersion: "26") == "iPad · iOS 26")
        #expect(DeviceIdentity.makeLabel(model: String(repeating: "x", count: 200), systemVersion: "27").count == 120)
    }

    @Test func oauthNonceIsHashedForTheProvider() {
        let raw = OAuthNonce.random()
        #expect(raw.count == 43 && raw != OAuthNonce.random())
        #expect(OAuthNonce.sha256(raw).range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil)
    }
}

@Suite("Device gate decision")
struct DeviceGateDecisionTests {
    let active = AccountStatusRow(status: "active", ageConfirmedAt: .now)

    @Test func verifiedDeviceGoesOn() {
        #expect(DeviceGateDecision.decide(check: .init(status: .verified), deviceVerified: nil, account: active, isOAuthUser: false) == .ok)
    }

    @Test func codeRequiredBlocksOnlyWhileEnforced() {
        let check = DeviceCheck(status: .codeRequired)
        // Enforcement on: is_device_verified() is false → code screen.
        #expect(DeviceGateDecision.decide(check: check, deviceVerified: false, account: nil, isOAuthUser: false) == .code)
        // Couldn't ask → stay closed.
        #expect(DeviceGateDecision.decide(check: check, deviceVerified: nil, account: nil, isOAuthUser: false) == .code)
        // Enforcement off: is_device_verified() is true → through, like the web gate.
        #expect(DeviceGateDecision.decide(check: check, deviceVerified: true, account: active, isOAuthUser: false) == .ok)
    }

    @Test func ageScreenWhenTheServerAsksOrAfterAFirstOAuthSignIn() {
        #expect(DeviceGateDecision.decide(check: .init(status: .verified, needsAgeConfirmation: true), deviceVerified: nil, account: active, isOAuthUser: false) == .age)
        let unconfirmed = AccountStatusRow(status: "active", ageConfirmedAt: nil)
        #expect(DeviceGateDecision.decide(check: .init(status: .verified), deviceVerified: nil, account: unconfirmed, isOAuthUser: true) == .age)
        // Email accounts from before the change aren't asked until the flag says so.
        #expect(DeviceGateDecision.decide(check: .init(status: .verified), deviceVerified: nil, account: unconfirmed, isOAuthUser: false) == .ok)
    }

    @Test func suspendedAccountWinsOverAge() {
        let until = Date.now.addingTimeInterval(86_400)
        let row = AccountStatusRow(status: "suspended", statusReason: "spam", statusUntil: until, ageConfirmedAt: nil)
        let decision = DeviceGateDecision.decide(check: .init(status: .verified, needsAgeConfirmation: true), deviceVerified: nil, account: row, isOAuthUser: true)
        #expect(decision == .suspended(Suspension(kind: .suspended, until: until, reason: .spam)))
    }

    @Test func suspensionEndsByItself() {
        let now = Date.now
        #expect(Suspension.from(.init(status: "suspended", statusUntil: now.addingTimeInterval(-1)), now: now) == nil)
        #expect(Suspension.from(.init(status: "suspended", statusUntil: nil), now: now)?.kind == .suspended)
        #expect(Suspension.from(.init(status: "banned", statusReason: "hate"), now: now) == Suspension(kind: .banned, until: nil, reason: .hate))
        #expect(Suspension.from(.init(status: "active"), now: now) == nil)
        #expect(Suspension.from(.init(status: "suspended", statusReason: "unknown-reason", statusUntil: nil), now: now)?.reason == nil)
    }

    @Test func decodesTheRPCResult() throws {
        let verified = try JSONDecoder().decode(DeviceCheck.self, from: Data(#"{"status":"verified","needs_age_confirmation":true}"#.utf8))
        #expect(verified == DeviceCheck(status: .verified, needsAgeConfirmation: true))
        let odd = try JSONDecoder().decode(DeviceCheck.self, from: Data(#"{"status":"something"}"#.utf8))
        #expect(odd == DeviceCheck(status: .codeRequired, needsAgeConfirmation: false))
    }
}

@Suite("Routing gate: auth security")
struct AuthRoutingTests {
    typealias Input = RouteGate.Input
    private func route(_ configure: (inout Input) -> Void) -> AppRoute {
        var input = Input(isRestoringSession: false, isSignedIn: true, approvedBubbleCount: 2)
        configure(&input)
        return RouteGate.resolve(input)
    }

    @Test func unverifiedSessionsNeverReachBubbles() {
        #expect(route { $0.deviceGate = .checking } == .launching)
        #expect(route { $0.deviceGate = .codeRequired } == .deviceCode)
        #expect(route { $0.deviceGate = .failed } == .deviceCode)
        #expect(route { $0.deviceGate = .verified } == .main)
    }

    @Test func ageThenSuspendedThenReset() {
        #expect(route { $0.needsAgeConfirmation = true } == .ageConfirmation)
        #expect(route { $0.suspended = true; $0.needsAgeConfirmation = true } == .suspended)
        #expect(route { $0.recoveringPassword = true; $0.deviceGate = .codeRequired } == .resetPassword)
        // Device code comes before the account status (the row can't be read yet).
        #expect(route { $0.suspended = true; $0.deviceGate = .codeRequired } == .deviceCode)
    }

    @Test func blockedSignInShowsTheSuspendedScreenSignedOut() {
        #expect(RouteGate.resolve(Input(isRestoringSession: false, isSignedIn: false, approvedBubbleCount: nil, suspended: true)) == .suspended)
    }

    @Test func resendCooldown() {
        let now = Date.now
        #expect(RouteGate.shouldAutoSend(lastSentAt: nil, now: now))
        #expect(!RouteGate.shouldAutoSend(lastSentAt: now.addingTimeInterval(-30), now: now))
        #expect(RouteGate.shouldAutoSend(lastSentAt: now.addingTimeInterval(-60), now: now))
        #expect(RouteGate.resendSecondsLeft(lastSentAt: now.addingTimeInterval(-0.5), now: now) == 60)
        #expect(RouteGate.resendSecondsLeft(lastSentAt: now.addingTimeInterval(-59.2), now: now) == 1)
        #expect(RouteGate.resendSecondsLeft(lastSentAt: now.addingTimeInterval(-61), now: now) == 0)
        #expect(RouteGate.resendSecondsLeft(lastSentAt: nil, now: now) == 0)
    }

    @Test func codeInputKeepsSixDigits() {
        #expect(CodeInput.sanitize("123 456") == "123456")
        #expect(CodeInput.sanitize("Your code: 12-34-56-78") == "123456")
        #expect(CodeInput.sanitize("١٢٣") == "", "only ASCII digits")
    }
}

@Suite("Auth security wire format and errors")
struct AuthSecurityContractTests {
    let device = DeviceIdentity(id: "boolaa-test-device", label: "iPhone · iOS 27")

    @Test func deviceCodeBodies() {
        #expect(BoolaaAPI.DeviceCodeBody.sendDevice(device, locale: "ro") ==
                ["action": "send", "purpose": "device", "device_id": "boolaa-test-device", "label": "iPhone · iOS 27", "locale": "ro"])
        #expect(BoolaaAPI.DeviceCodeBody.verifyDevice(device, code: "123456")["code"] == "123456")
        #expect(BoolaaAPI.DeviceCodeBody.sendSensitive(.deleteAccount, locale: "en")["sensitive_action"] == "delete_account")
        #expect(BoolaaAPI.DeviceCodeBody.sendSensitive(.generic, locale: "en")["purpose"] == "sensitive_action")
        #expect(BoolaaAPI.DeviceCodeBody.verifySensitive(code: "000111") == ["action": "verify", "purpose": "sensitive_action", "code": "000111"])
    }

    @Test @MainActor func signUpMetadata() {
        let data = SessionStore.signUpMetadata(name: " Ana ", locale: "ro")
        #expect(data == ["name": .string("Ana"), "locale": .string("ro"), "age_confirmed": .bool(true), "terms_version": .string("2026-11-22")])
    }

    @Test(arguments: [
        (400, #"{"error":"invalid_request"}"#, UserFacingError.codeFormat),
        (400, #"{"error":"invalid_code","attempts_left":3}"#, .codeWrong(attemptsLeft: 3)),
        (400, #"{"error":"invalid_code"}"#, .codeWrongOrExpired),
        (401, "not json", .notAuthenticated),
        (404, #"{"error":"no_active_code"}"#, .noActiveCode),
        (410, #"{"error":"code_expired"}"#, .codeExpired),
        (423, #"{"error":"too_many_attempts"}"#, .tooManyCodeAttempts),
        (429, #"{"error":"rate_limited"}"#, .tooManyCodes),
        (502, #"{"error":"email_failed"}"#, .emailSendFailed),
        (500, #"{"error":"server_error"}"#, .generic),
    ])
    func functionErrors(status: Int, body: String, expected: UserFacingError) {
        let error = DeviceCodeError.from(status: status, body: Data(body.utf8))
        #expect(UserFacingError.classify(error) == expected)
    }

    @Test(arguments: [
        ("session not verified", UserFacingError.sessionNotVerified),
        ("age confirmation required", .ageConfirmationRequired),
        ("reauthentication required", .reauthenticationRequired),
        ("invalid device id", .invalidDeviceId),
        ("invalid terms version", .invalidTermsVersion),
        ("account suspended", .accountSuspended),
    ])
    func rpcErrors(message: String, expected: UserFacingError) {
        #expect(UserFacingError.classify(PostgrestError(code: "42501", message: message)) == expected)
    }

    @Test func authErrors() {
        let cases: [(ErrorCode, UserFacingError)] = [
            (.otpExpired, .codeWrongOrExpired), (.reauthenticationNotValid, .codeWrongOrExpired),
            (.reauthenticationNeeded, .reauthenticationRequired), (.overEmailSendRateLimit, .emailRateLimited),
            (.samePassword, .samePassword), (.userBanned, .userBanned),
        ]
        for (code, expected) in cases {
            let error = AuthError.api(message: "raw English", errorCode: code, underlyingData: Data(),
                                      underlyingResponse: HTTPURLResponse(url: URL(string: "http://x")!, statusCode: 400, httpVersion: nil, headerFields: nil)!)
            #expect(UserFacingError.classify(error) == expected, "\(code.rawValue)")
        }
    }

    /// "N tries left" uses real plural forms (glossary: Romanian one/few/other).
    @Test func triesLeftPlurals() throws {
        func text(_ n: Int, _ lang: String) throws -> String {
            let path = try #require(Bundle.main.path(forResource: lang, ofType: "lproj"))
            let bundle: Bundle? = Bundle(path: path)
            return String(localized: "That code isn't right. \(n) tries left.", bundle: try #require(bundle), locale: Locale(identifier: lang))
        }
        #expect(try text(1, "en") == "That code isn't right. 1 try left.")
        #expect(try text(4, "en") == "That code isn't right. 4 tries left.")
        #expect(try text(1, "ro") == "Codul nu e corect. Mai ai 1 încercare.")
        #expect(try text(3, "ro") == "Codul nu e corect. Mai ai 3 încercări.")
        #expect(try text(20, "ro") == "Codul nu e corect. Mai ai 20 de încercări.")
        #expect(try text(1, "fr") == "Ce code n'est pas bon. Il te reste 1 essai.")
        #expect(try text(2, "es") == "Ese código no es correcto. Te quedan 2 intentos.")
        #expect(try text(1, "it") == "Il codice non è corretto. Ti resta 1 tentativo.")
    }
}
