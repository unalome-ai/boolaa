import Foundation
import Supabase
import Testing
@testable import Boolaa

/// Device check, devices, error mapping and the sign-up contract against the local Supabase stack, with the
/// feature flags in their local default (off). Uses in-memory session storage, never the app's Keychain session.
@Suite("Local backend: auth security", .serialized)
struct AuthSecurityIntegrationTests {
    let client: SupabaseClient
    let api: BoolaaAPI
    let seeded = DeviceIdentity(id: "boolaa-test-device", label: "iPhone · iOS 27")

    init() throws {
        client = Backend.makeClient(config: try AppConfig.load(), authStorage: InMemoryAuthStorage())
        api = BoolaaAPI(client: client)
    }

    private func signInAlice() async throws {
        _ = try await client.auth.signIn(email: "alice@boolaa.test", password: "password123")
    }

    @Test func seededTrustedDevicePassesAndIsListedAsThisDevice() async throws {
        try await signInAlice()
        let check = try await api.startDeviceCheck(seeded)
        #expect(check == DeviceCheck(status: .verified, needsAgeConfirmation: false))
        let devices = try await api.listMyDevices()
        let mine = try #require(devices.first { $0.deviceHash == seeded.hash }, "seed trusts boolaa-test-device for Alice")
        #expect(mine.lastSeenAt != nil)
        try await client.auth.signOut(scope: .local)
    }

    @Test func unknownDeviceNeedsACodeButTheGateLetsItThroughWhileEnforcementIsOff() async throws {
        try await signInAlice()
        let stranger = DeviceIdentity(id: DeviceIdentity.generateID(), label: "iPhone · iOS 27")
        let check = try await api.startDeviceCheck(stranger)
        #expect(check.status == .codeRequired)
        let deviceVerified = try await api.isDeviceVerified()
        #expect(deviceVerified, "app_settings.device_verification_enforced is off locally")
        let me = try #require(client.auth.currentUser?.id)
        let account = try await api.accountStatus(userID: me)
        #expect(DeviceGateDecision.decide(check: check, deviceVerified: deviceVerified, account: account, isOAuthUser: false) == .ok)
        // Not trusted by the check alone.
        #expect(try await api.listMyDevices().allSatisfy { $0.deviceHash != stranger.hash })
        try await client.auth.signOut(scope: .local)
    }

    @Test func backendErrorsMapToTranslatedMessages() async throws {
        try await signInAlice()
        await #expect(throws: Error.self) { _ = try await api.startDeviceCheck(DeviceIdentity(id: "short", label: "x")) }
        do { _ = try await api.startDeviceCheck(DeviceIdentity(id: "short", label: "x")) } catch {
            #expect(UserFacingError.classify(error) == .invalidDeviceId)
        }
        let stranger = DeviceIdentity(id: DeviceIdentity.generateID(), label: "x")
        do {
            try await api.deviceCode(BoolaaAPI.DeviceCodeBody.verifyDevice(stranger, code: "123456"))
            Issue.record("expected no_active_code")
        } catch {
            #expect(error as? DeviceCodeError == DeviceCodeError(status: 404, code: "no_active_code"))
            #expect(UserFacingError.classify(error) == .noActiveCode)
        }
        do {
            try await api.deviceCode(BoolaaAPI.DeviceCodeBody.verifyDevice(stranger, code: "12"))
            Issue.record("expected invalid_request")
        } catch {
            #expect(UserFacingError.classify(error) == .codeFormat)
        }
        do {
            struct Params: Encodable { let p_terms_version: String }
            try await client.rpc("confirm_age", params: Params(p_terms_version: "")).execute()
            Issue.record("expected invalid terms version")
        } catch {
            #expect(UserFacingError.classify(error) == .invalidTermsVersion)
        }
        try await client.auth.signOut(scope: .local)
    }

    /// Sign-up sends {name, locale, age_confirmed, terms_version}; the gate opens and routes to Onboarding;
    /// then the account deletes itself (allowed without a code while enforcement is off).
    @Test(.timeLimit(.minutes(1))) @MainActor
    func signUpStoresAgeAndTermsAndTheGateRoutesToOnboarding() async throws {
        let store = SessionStore(api: api, device: DeviceIdentity(id: DeviceIdentity.generateID(), label: "iPhone · iOS 27"),
                                 defaults: UserDefaults(suiteName: "auth-security-tests")!)
        let email = "ios-signup-\(UUID().uuidString.prefix(8).lowercased())@boolaa.test"
        let signedIn = try await store.signUp(name: "Ana", email: email, password: "password123")
        #expect(signedIn)
        let me = try #require(store.userID)
        while store.route == .launching { try await Task.sleep(for: .milliseconds(50)) }
        #expect(store.route == .onboarding)
        #expect(store.deviceGate == .verified)

        let row = try #require(try await api.accountStatus(userID: me))
        #expect(row.ageConfirmedAt != nil)
        #expect(row.status == "active")
        struct Terms: Decodable { let terms_version: String? }
        let terms: Terms = try await client.from("users").select("terms_version").eq("id", value: me).single().execute().value
        #expect(terms.terms_version == "2026-11-22")
        let user = try await client.auth.user()
        #expect(user.userMetadata["locale"]?.stringValue == AppLanguage.current.rawValue)

        try await store.deleteAccount()
        #expect(store.userID == nil)
        #expect(store.route == .auth)
    }
}
