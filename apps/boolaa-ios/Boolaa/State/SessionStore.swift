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

    private var authTask: Task<Void, Never>?
    private var membershipWatch: Task<Void, Never>?
    private let reloads = ReloadCoalescer()
    private let defaults: UserDefaults
    private static let currentBubbleKey = "boolaa.currentBubbleID"

    init(api: BoolaaAPI, defaults: UserDefaults = .standard) {
        self.api = api
        self.defaults = defaults
        currentBubbleID = defaults.string(forKey: Self.currentBubbleKey).flatMap(UUID.init(uuidString:))
    }

    // MARK: Derived state

    var route: AppRoute {
        RouteGate.resolve(.init(
            isRestoringSession: isRestoringSession,
            isSignedIn: userID != nil,
            approvedBubbleCount: memberships?.count
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
                do { _ = try await client.auth.refreshSession() } catch { await applySignedOut() }
                return
            }
            if let session { await applySignedIn(session.user) } else { await applySignedOut() }
        case .signedIn, .tokenRefreshed, .userUpdated:
            if let session, session.user.id != userID || memberships == nil { await applySignedIn(session.user) }
        case .signedOut, .userDeleted:
            await applySignedOut()
        default:
            break
        }
    }

    private func applySignedIn(_ user: User) async {
        if userID != user.id {
            memberships = nil; profile = nil; pendingRequests = []
            startMembershipWatch(userID: user.id)
        }
        userID = user.id
        email = user.email
        isRestoringSession = false
        await reload()
    }

    private func applySignedOut() async {
        membershipWatch?.cancel(); membershipWatch = nil
        reloads.cancel()
        userID = nil; email = nil; profile = nil; memberships = nil; pendingRequests = []
        isRestoringSession = false
    }

    /// Live updates for the signed-in user's own membership rows and join requests:
    /// admission moves them from Pending approval to Main, removal moves them to the next
    /// bubble (or Onboarding), an ownership hand-over updates the role.
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
        let session = try await client.auth.signIn(email: email.trimmingCharacters(in: .whitespaces), password: password)
        await applySignedIn(session.user)
    }

    /// Returns false when the backend requires email confirmation before a session exists.
    func signUp(name: String, email: String, password: String) async throws -> Bool {
        let response = try await client.auth.signUp(
            email: email.trimmingCharacters(in: .whitespaces),
            password: password,
            data: ["name": .string(name.trimmingCharacters(in: .whitespaces))]
        )
        if let session = response.session {
            await applySignedIn(session.user)
            return true
        }
        return false
    }

    func signOut() async {
        try? await client.auth.signOut()
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
}
