import Foundation
import Observation
import Supabase

/// Owns the auth session, the user's profile and bubbles, and the current bubble.
/// Injected at the root with `.environment(session)`; feature views read `session.currentBubble`.
@MainActor
@Observable
final class SessionStore {
    let api: BoolaaAPI
    private var client: SupabaseClient { api.client }

    private(set) var isRestoringSession = true
    private(set) var userID: UUID?
    private(set) var email: String?
    private(set) var profile: UserProfile?
    /// Approved memberships (bubble embedded), in join order.
    private(set) var memberships: [BubbleMember]?
    /// The caller's own pending join requests.
    private(set) var pendingRequests: [JoinRequest] = []
    private(set) var currentBubbleID: UUID?
    var lastError: String?
    /// An invite link opened in any state (even signed out). Kept through sign-in, the device gate and
    /// app restarts; the join preview shows once Onboarding or Main is reached.
    var pendingInviteCode: String? {
        didSet { defaults.set(pendingInviteCode, forKey: Self.pendingInviteKey) }
    }
    private static let pendingInviteKey = "boolaa.pendingInviteCode"

    // Device gate (docs/auth-security.md §8) and account status (docs/moderation.md)
    let device: DeviceIdentity
    private(set) var deviceGate: DeviceGateState = .checking
    private(set) var needsAgeConfirmation = false
    /// Set while the account is suspended or banned (or sign-in answered `user_banned`).
    private(set) var suspension: Suspension?
    /// The session came from a password-reset code and still needs its new password.
    private(set) var recoveringPassword = false
    /// When the last device code was sent, so re-entering the code screen doesn't send another within 60 s.
    var deviceCodeSentAt: Date?
    /// The gate couldn't run (offline, server error); the code screen offers "Try again".
    private(set) var gateError: String?
    private var gateTask: Task<Void, Never>?

    private var authTask: Task<Void, Never>?
    private var membershipWatch: Task<Void, Never>?
    private let reloads = ReloadCoalescer()
    private let defaults: UserDefaults
    private static let currentBubbleKey = "boolaa.currentBubbleID"

    init(api: BoolaaAPI, device: DeviceIdentity, defaults: UserDefaults = .standard) {
        self.api = api
        self.device = device
        self.defaults = defaults
        currentBubbleID = defaults.string(forKey: Self.currentBubbleKey).flatMap(UUID.init(uuidString:))
        pendingInviteCode = defaults.string(forKey: Self.pendingInviteKey).flatMap(InviteLink.normalize)
    }

    // MARK: Invite links

    /// Stores the code of an invite link (universal link or `boolaa://join/…`). Returns false for any other URL.
    @discardableResult
    func handleInviteURL(_ url: URL) -> Bool {
        guard let code = InviteLink.code(from: url) else { return false }
        pendingInviteCode = code
        return true
    }

    /// The join preview shows only on Onboarding or Main (never over sign-in or the device gate).
    var inviteToShow: String? {
        route == .onboarding || route == .main ? pendingInviteCode : nil
    }

    func invitePreview(code: String) async throws -> InvitePreview? {
        try await api.invitePreview(code: code)
    }

    /// Owner only. The settings screen shows the new code after the reload.
    func rotateInviteCode(bubbleID: UUID) async throws {
        _ = try await api.rotateInviteCode(bubbleID: bubbleID)
        await reload()
    }

    // MARK: Derived state

    var route: AppRoute {
        RouteGate.resolve(.init(
            isRestoringSession: isRestoringSession,
            isSignedIn: userID != nil,
            approvedBubbleCount: memberships?.count,
            deviceGate: deviceGate,
            needsAgeConfirmation: needsAgeConfirmation,
            recoveringPassword: recoveringPassword,
            suspended: suspension != nil
        ))
    }

    var bubbles: [Bubble] { (memberships ?? []).compactMap(\.bubble) }

    var currentBubble: Bubble? { RouteGate.pickCurrentBubble(stored: currentBubbleID, approved: bubbles) }

    var currentRole: MemberRole? {
        guard let id = currentBubble?.id else { return nil }
        return memberships?.first(where: { $0.bubbleId == id })?.role
    }

    // MARK: Lifecycle

    /// Listens to auth state for the lifetime of the app.
    func start() {
        guard authTask == nil else { return }
        SecurityEvents.handler = { [weak self] kind in
            guard let self, self.userID != nil else { return }
            Task { await self.recheck(kind) }
        }
        authTask = Task { [weak self] in
            guard let client = self?.client else { return }
            for await (event, session) in client.auth.authStateChanges {
                guard let self else { return }
                await self.handle(event: event, session: session)
            }
        }
    }

    private func handle(event: AuthChangeEvent, session: Session?) async {
        switch event {
        case .initialSession:
            if let session, session.isExpired {
                // Wait for the SDK's automatic refresh (emits .tokenRefreshed) or fall back to signed out.
                do { _ = try await client.auth.refreshSession() } catch {
                    // A suspended or banned account can't refresh (400 user_banned).
                    if UserFacingError.classify(error) == .userBanned { suspension = Suspension(kind: .signInBlocked) }
                    await applySignedOut()
                }
                return
            }
            if let session { await applySignedIn(session.user) } else { await applySignedOut() }
        case .signedIn, .tokenRefreshed, .userUpdated:
            guard let session else { break }
            if session.user.id != userID {
                await applySignedIn(session.user)
            } else {
                email = session.user.email
            }
        case .signedOut, .userDeleted:
            await applySignedOut()
        default:
            break
        }
    }

    private func applySignedIn(_ user: User) async {
        if userID != user.id {
            membershipWatch?.cancel(); membershipWatch = nil
            memberships = nil; profile = nil; pendingRequests = []
            deviceGate = .checking; needsAgeConfirmation = false; deviceCodeSentAt = nil; gateError = nil
            if suspension?.kind == .signInBlocked { suspension = nil }
            gateTask = nil
            currentUser = user
        }
        userID = user.id
        email = user.email
        currentUser = user
        isRestoringSession = false
        await runGate()
    }

    private func applySignedOut() async {
        membershipWatch?.cancel(); membershipWatch = nil
        reloads.cancel()
        gateTask?.cancel(); gateTask = nil
        userID = nil; email = nil; profile = nil; memberships = nil; pendingRequests = []
        deviceGate = .checking; needsAgeConfirmation = false; recoveringPassword = false; deviceCodeSentAt = nil
        gateError = nil; currentUser = nil
        if suspension?.kind != .signInBlocked { suspension = nil }
        isRestoringSession = false
    }

    private var currentUser: User?

    // MARK: Device gate

    /// Runs the gate once per session; concurrent callers wait for the same run. `force` starts a new run
    /// (after a code, the age screen, a password reset or a "session not verified" error).
    func runGate(force: Bool = false) async {
        if let gateTask, !force { await gateTask.value; return }
        let task = Task { await self.gate() }
        gateTask = task
        await task.value
    }

    /// `start_device_check` after every sign-in and session restore, before loading data (docs/auth-security.md §8);
    /// then the account status, the age screen if due, and only then realtime and the bubble data.
    private func gate() async {
        guard let userID else { return }
        gateError = nil
        do {
            let check = try await api.startDeviceCheck(device)
            guard self.userID == userID else { return }
            var deviceVerified: Bool? = nil
            if check.status == .codeRequired {
                deviceVerified = try await api.isDeviceVerified()
            }
            let gateOpen = check.status == .verified || deviceVerified == true
            let account = gateOpen ? try? await api.accountStatus(userID: userID) : nil
            guard self.userID == userID else { return }
            let decision = DeviceGateDecision.decide(check: check, deviceVerified: deviceVerified, account: account,
                                                     isOAuthUser: Self.isOAuthUser(currentUser))
            apply(decision)
            if decision != .code { syncLocaleIfNeeded() }
        } catch {
            guard self.userID == userID else { return }
            switch UserFacingError.classify(error) {
            case .notAuthenticated:
                await signOut()
            case .userBanned:
                suspension = Suspension(kind: .signInBlocked)
                await signOut()
            default:
                // Offline or a server error: show the code screen's error state with "Try again".
                gateError = error.userMessage
                deviceGate = .failed
            }
        }
    }

    private func apply(_ decision: DeviceGateDecision) {
        switch decision {
        case .code:
            stopLive()
            suspension = nil
            deviceGate = .codeRequired
        case .suspended(let s):
            stopLive()
            deviceGate = .verified
            suspension = s
        case .age:
            stopLive()
            suspension = nil
            deviceGate = .verified
            needsAgeConfirmation = true
        case .ok:
            suspension = nil
            deviceGate = .verified
            needsAgeConfirmation = false
            if let userID, membershipWatch == nil { startMembershipWatch(userID: userID) }
            Task { await reload() }
        }
    }

    private func stopLive() {
        membershipWatch?.cancel(); membershipWatch = nil
        reloads.cancel()
        memberships = nil
    }

    static func isOAuthUser(_ user: User?) -> Bool {
        guard let provider = user?.appMetadata["provider"]?.stringValue else { return false }
        return provider != "email"
    }

    /// A "session not verified" or "account suspended" error anywhere: run the gate again.
    private func recheck(_ kind: SecurityEvents.Kind) async {
        guard userID != nil, !recoveringPassword, deviceGate != .codeRequired || kind == .accountSuspended else { return }
        if kind == .accountSuspended, suspension != nil { return }
        // Never loop: if the server keeps disagreeing with start_device_check, re-check at most every 5 s.
        if let last = lastRecheck, Date.now.timeIntervalSince(last) < 5 { return }
        lastRecheck = .now
        await runGate(force: true)
    }
    private var lastRecheck: Date?

    /// Emails come in the user's language: store the app language in `user_metadata.locale` when it differs
    /// (first OAuth sign-in, a language change in Settings) (docs/auth-security.md §5).
    private func syncLocaleIfNeeded() {
        let language = AppLanguage.current.rawValue
        guard currentUser?.userMetadata["locale"]?.stringValue != language else { return }
        Task { _ = try? await client.auth.update(user: UserAttributes(data: ["locale": .string(language)])) }
    }

    /// Live updates for the signed-in user's own membership rows and join requests:
    /// admission moves them from Pending approval to Main, removal moves them to the next
    /// bubble (or Onboarding), an ownership hand-over updates the role. Bubble row updates
    /// (name, description, photo) refresh the switcher, Settings and the pending list.
    private func startMembershipWatch(userID: UUID) {
        membershipWatch?.cancel()
        let client = client
        membershipWatch = Task { [weak self] in
            await LiveChanges.observe(
                client,
                topic: "membership:\(userID.uuidString.lowercased())",
                watches: [
                    .init(table: "bubble_members", column: "user_id", equals: userID,
                          deleteMatches: { LiveChanges.record($0, "user_id", is: userID) }),
                    .init(table: "join_requests", column: "user_id", equals: userID,
                          deleteMatches: { [weak self] old in
                              guard let id = LiveChanges.id(of: old) else { return false }
                              return await self?.pendingRequests.contains { $0.id == id } ?? false
                          }),
                    // A new name, description or photo of any bubble the user can read (member or
                    // requester; RLS decides). Deletes arrive through bubble_members instead.
                    .init(table: "bubbles", column: nil, equals: nil, deleteMatches: { _ in false }),
                ],
                onChange: { [weak self] in self?.scheduleReload() }
            )
        }
    }

    private func scheduleReload() {
        reloads.schedule { [weak self] in await self?.reload() }
    }

    /// Reloads profile, memberships and pending requests.
    func reload() async {
        guard let userID else { return }
        do {
            async let p = api.profile(userID: userID)
            async let m = api.memberships(userID: userID)
            async let r = api.myJoinRequests(userID: userID)
            let (profile, members, requests) = try await (p, m, r)
            self.profile = profile
            self.memberships = members.filter(\.approved)
            self.pendingRequests = requests
            if let current = currentBubble { selectBubble(current.id) }
        } catch {
            // "session not verified" / "account suspended" re-run the gate (UserFacingError.classify raises the event).
            let mapped = UserFacingError.classify(error)
            if mapped == .sessionNotVerified || mapped == .accountSuspended { return }
            if memberships == nil { memberships = [] }
            lastError = error.localizedDescription
        }
    }

    func selectBubble(_ id: UUID) {
        currentBubbleID = id
        defaults.set(id.uuidString, forKey: Self.currentBubbleKey)
    }

    // MARK: Auth actions

    func signIn(email: String, password: String) async throws {
        do {
            let session = try await client.auth.signIn(email: email.trimmingCharacters(in: .whitespaces), password: password)
            await applySignedIn(session.user)
        } catch where UserFacingError.classify(error) == .userBanned {
            // Suspended or banned: the suspended screen, without details (there is no session to read them with).
            suspension = Suspension(kind: .signInBlocked)
        }
    }

    /// Leaves the "can't sign in" screen.
    func dismissSignInBlocked() {
        if suspension?.kind == .signInBlocked { suspension = nil }
    }

    /// The metadata every email sign-up sends (docs/auth-security.md §6).
    static func signUpMetadata(name: String, locale: String) -> [String: AnyJSON] {
        ["name": .string(name.trimmingCharacters(in: .whitespaces)), "locale": .string(locale),
         "age_confirmed": .bool(true), "terms_version": .string(termsVersion)]
    }

    /// Returns false when the backend requires email confirmation before a session exists.
    func signUp(name: String, email: String, password: String) async throws -> Bool {
        let response = try await client.auth.signUp(
            email: email.trimmingCharacters(in: .whitespaces),
            password: password,
            data: Self.signUpMetadata(name: name, locale: AppLanguage.current.rawValue),
            redirectTo: AppConfig.authCallbackURL
        )
        if let session = response.session {
            await applySignedIn(session.user)
            return true
        }
        return false
    }

    func signOut() async {
        // This device stops getting pushes for this account (docs/push-notifications.md §8, step 3).
        await PushCenter.shared.unregisterBeforeSignOut(api: api)
        // Local only: other devices keep their sessions (revoking them is "Your devices").
        try? await client.auth.signOut(scope: .local)
        await applySignedOut()
    }

    // MARK: Sign in with Apple / Google (docs/auth-security.md §7)

    /// Apple: the raw nonce whose sha256 went into the authorization request. Apple sends the name only on the
    /// first authorization, never in the id_token, so it is saved here (metadata and `users.name`).
    func signInWithApple(idToken: String, rawNonce: String, fullName: String?) async throws {
        let session = try await signInWithIdToken(.init(provider: .apple, idToken: idToken, nonce: rawNonce))
        if let name = fullName?.trimmingCharacters(in: .whitespaces), !name.isEmpty {
            _ = try? await client.auth.update(user: UserAttributes(data: [
                "name": .string(name), "full_name": .string(name), "locale": .string(AppLanguage.current.rawValue),
            ]))
            _ = try? await api.updateProfile(userID: session.user.id, name: name)
        }
        await applySignedIn(session.user)
        if let name = fullName, !name.isEmpty, profile?.name != name { await reload() }
    }

    /// Google: GoogleSignIn put sha256(rawNonce) into the id_token; Supabase checks it against the raw value.
    func signInWithGoogle(idToken: String, accessToken: String, rawNonce: String) async throws {
        let session = try await signInWithIdToken(.init(provider: .google, idToken: idToken, accessToken: accessToken, nonce: rawNonce))
        await applySignedIn(session.user)
    }

    private func signInWithIdToken(_ credentials: OpenIDConnectCredentials) async throws -> Session {
        do {
            return try await client.auth.signInWithIdToken(credentials: credentials)
        } catch where UserFacingError.classify(error) == .userBanned {
            suspension = Suspension(kind: .signInBlocked)
            throw error
        }
    }

    // MARK: Device code and age (docs/auth-security.md §8)

    func sendDeviceCode() async throws {
        try await api.deviceCode(BoolaaAPI.DeviceCodeBody.sendDevice(device, locale: AppLanguage.current.rawValue))
        deviceCodeSentAt = .now
    }

    /// Checks the code; the caller then plays its success feedback and calls `continueAfterVerification()`.
    func verifyDeviceCode(_ code: String) async throws {
        try await api.deviceCode(BoolaaAPI.DeviceCodeBody.verifyDevice(device, code: code))
        deviceCodeSentAt = nil
    }

    /// Re-runs the gate: after a device code, or "Try again" when the check failed.
    func continueAfterVerification() async {
        await runGate(force: true)
    }

    func confirmAge() async throws {
        try await api.confirmAge()
        needsAgeConfirmation = false
        await runGate(force: true)
    }

    // MARK: Forgot password (docs/auth-security.md §2)

    func sendPasswordReset(email: String) async throws {
        try await client.auth.resetPasswordForEmail(email.trimmingCharacters(in: .whitespaces), redirectTo: AppConfig.authCallbackURL)
    }

    /// Verifying the code signs in (amr otp, so this device gets trusted); the new-password screen comes next.
    func verifyPasswordReset(email: String, code: String) async throws {
        recoveringPassword = true
        do {
            try await client.auth.verifyOTP(email: email.trimmingCharacters(in: .whitespaces), token: code, type: .recovery)
        } catch {
            recoveringPassword = false
            throw error
        }
    }

    /// A fresh recovery session needs no nonce. Then the gate continues as for any sign-in.
    func finishPasswordReset(newPassword: String) async throws {
        _ = try await client.auth.update(user: UserAttributes(password: newPassword))
        recoveringPassword = false
        await runGate(force: true)
    }

    /// The emailed reset link is a fallback: it opens the app with a session that still needs its new password.
    func handleAuthCallback(_ url: URL, expectingRecovery: Bool) async {
        if expectingRecovery { recoveringPassword = true }
        do { _ = try await client.auth.session(from: url) } catch {
            if expectingRecovery { recoveringPassword = false }
            lastError = error.userMessage
        }
    }

    // MARK: Security settings (docs/auth-security.md §2, §8)

    func sendSensitiveActionCode(_ action: SensitiveAction) async throws {
        try await api.deviceCode(BoolaaAPI.DeviceCodeBody.sendSensitive(action, locale: AppLanguage.current.rawValue))
    }

    func verifySensitiveActionCode(_ code: String) async throws {
        try await api.deviceCode(BoolaaAPI.DeviceCodeBody.verifySensitive(code: code))
    }

    /// Emails a `change_password` code. The server refuses a password change without one
    /// (guard_sensitive_auth_change, docs/auth-security.md → Sensitive actions).
    func requestPasswordChangeCode() async throws {
        try await sendSensitiveActionCode(.changePassword)
    }

    /// After a verified `change_password` code (within 10 minutes).
    func changePassword(_ newPassword: String) async throws {
        _ = try await client.auth.update(user: UserAttributes(password: newPassword))
    }

    /// Call after a verified `sensitive_action` code. Both addresses get an email to confirm.
    func changeEmail(_ newEmail: String) async throws {
        _ = try await client.auth.update(user: UserAttributes(email: newEmail.trimmingCharacters(in: .whitespaces)),
                                         redirectTo: AppConfig.authCallbackURL)
    }

    /// Deletes the user's files and account (delete_my_account), then signs out locally.
    /// Call after a verified `delete_account` code: the proof belongs to this session for 10 minutes.
    func deleteAccount() async throws {
        guard let userID else { return }
        try await api.deleteMyAccount(userID: userID)
        // Push tokens, prefs and mutes went with the account (cascade).
        PushCenter.shared.forgetRegistration()
        defaults.removeObject(forKey: Self.currentBubbleKey)
        try? await client.auth.signOut(scope: .local)
        await applySignedOut()
    }

    // MARK: Profile & bubble actions

    func updateProfile(name: String? = nil, avatar: String? = nil) async throws {
        guard let userID else { return }
        let previousAvatar = profile?.avatar
        profile = try await api.updateProfile(userID: userID, name: name, avatar: avatar)
        if let avatar, avatar != previousAvatar {
            await api.removeImage(publicURL: previousAvatar, bucket: .avatars, userID: userID)
        }
    }

    func createBubble(name: String, description: String?, maxSize: Int) async throws {
        let bubble = try await api.createBubble(name: name, description: description, maxSize: maxSize)
        selectBubble(bubble.id)
        await reload()
    }

    func requestToJoin(code: String) async throws -> JoinRequest {
        let request = try await api.requestToJoin(inviteCode: code)
        await reload()
        return request
    }

    func cancelRequest(_ request: JoinRequest) async throws {
        try await api.cancelJoinRequest(id: request.id)
        await reload()
    }

    func leaveCurrentBubble() async throws {
        guard let userID, let bubble = currentBubble else { return }
        try await api.leaveBubble(bubbleID: bubble.id, userID: userID)
        currentBubbleID = nil
        defaults.removeObject(forKey: Self.currentBubbleKey)
        await reload()
    }

    func updateCurrentBubble(name: String, description: String?) async throws {
        guard let bubble = currentBubble else { return }
        try await api.updateBubble(id: bubble.id, name: name, description: description)
        await reload()
    }

    /// Sets (`jpeg` from ImageCompression for `.bubbles`) or removes (`nil`) the current bubble's photo.
    /// Upload, point the row at it, then delete the previous file; if the row update fails the new file
    /// is deleted again. Old files that slip through are swept server-side.
    func setCurrentBubbleLogo(_ jpeg: Data?) async throws {
        guard let bubble = currentBubble else { return }
        let previous = bubble.logo
        if let jpeg {
            let url = try await api.uploadBubbleLogo(jpeg, bubbleID: bubble.id)
            do {
                try await api.setBubbleLogo(bubbleID: bubble.id, logo: url)
            } catch {
                await api.removeBubbleLogo(publicURL: url, bubbleID: bubble.id)
                throw error
            }
        } else {
            try await api.setBubbleLogo(bubbleID: bubble.id, logo: nil)
        }
        await api.removeBubbleLogo(publicURL: previous, bubbleID: bubble.id)
        await reload()
    }
}
