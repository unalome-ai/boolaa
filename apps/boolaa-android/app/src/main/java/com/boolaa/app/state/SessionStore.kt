package com.boolaa.app.state

import com.boolaa.app.core.CacheKeys
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

import android.content.SharedPreferences
import android.util.Log
import com.boolaa.app.core.Backend
import com.boolaa.app.core.BoolaaApi
import com.boolaa.app.core.CodePurpose
import com.boolaa.app.core.DeviceCodeBody
import com.boolaa.app.core.DeviceIdentity
import com.boolaa.app.core.ImageBucket
import com.boolaa.app.core.SensitiveAction
import com.boolaa.app.core.DataExportFile
import com.boolaa.app.core.exportMyData
import com.boolaa.app.core.TERMS_VERSION
import com.boolaa.app.core.UserFacingError
import com.boolaa.app.core.AccountStatusRow
import com.boolaa.app.core.DeviceCheck
import com.boolaa.app.core.DeviceGateDecision
import com.boolaa.app.core.Suspension
import com.boolaa.app.core.accountStatus
import com.boolaa.app.core.confirmAge
import com.boolaa.app.core.isDeviceVerified
import com.boolaa.app.core.deviceCode
import com.boolaa.app.core.listMyDevices
import com.boolaa.app.core.revokeDevice
import com.boolaa.app.core.startDeviceCheck
import com.boolaa.app.core.TrustedDevice
import com.boolaa.app.core.LiveTables
import com.boolaa.app.core.TableWatch
import com.boolaa.app.model.Block
import com.boolaa.app.model.Bubble
import com.boolaa.app.model.BubbleMember
import com.boolaa.app.model.BubblePatch
import io.github.jan.supabase.realtime.PostgresAction
import com.boolaa.app.model.JoinRequest
import com.boolaa.app.model.MemberRole
import com.boolaa.app.model.UserProfile
import io.github.jan.supabase.auth.OtpType
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.Apple
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.auth.providers.builtin.IDToken
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.auth.status.SessionStatus
import io.github.jan.supabase.auth.user.UserInfo
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/** Snapshot of auth, profile, memberships and the current bubble. */
data class SessionState(
    val isRestoringSession: Boolean = true,
    val userId: String? = null,
    val email: String? = null,
    val profile: UserProfile? = null,
    /** Approved memberships (bubble embedded) in join order; null until loaded. */
    val memberships: List<BubbleMember>? = null,
    /** The caller's own pending join requests. */
    val pendingRequests: List<JoinRequest> = emptyList(),
    val storedBubbleId: String? = null,
    /** People the caller blocked (RLS hides content both ways). */
    val blocks: List<Block> = emptyList(),
    /** Device check of this session (docs/auth-security.md §2). */
    val deviceGate: DeviceGate = DeviceGate.CHECKING,
    /** The one-time "I'm 16 or older + Terms" screen is due (server flag, or a first Google/Apple sign-in). */
    val needsAgeConfirmation: Boolean = false,
    /** Signed in with a password-reset code; the new password screen comes first. */
    val recoveringPassword: Boolean = false,
    /** When the last device code was emailed (for the 60 s auto-send / resend rule). */
    val deviceCodeSentAt: Long? = null,
    /** Suspended or banned (signed in), or sign-in answered `user_banned` (signed out) (docs/moderation.md). */
    val suspension: Suspension? = null,
    /** A bubble whose join request was just approved: its Home plays the "You're in" cheer once (§8.4). */
    val welcomeBubbleId: String? = null,
) {
    val blockedIds: Set<String> get() = blocks.mapTo(mutableSetOf()) { it.blockedId }
    val route: AppRoute
        get() = RouteGate.resolve(
            isRestoringSession, userId != null, memberships?.size, deviceGate, needsAgeConfirmation, recoveringPassword, suspension != null,
        )
    val bubbles: List<Bubble> get() = memberships.orEmpty().mapNotNull { it.bubble }
    val currentBubble: Bubble? get() = RouteGate.pickCurrentBubble(storedBubbleId, bubbles)
    val currentRole: MemberRole? get() = currentBubble?.let { b -> memberships?.firstOrNull { it.bubbleId == b.id }?.role }
}

/**
 * Owns the auth session, the user's profile and bubbles, and the current bubble (mirrors iOS SessionStore).
 * One instance lives in [com.boolaa.app.AppContainer]; ViewModels read [state] and call its actions.
 */
class SessionStore(
    val api: BoolaaApi,
    private val prefs: SharedPreferences,
    private val scope: CoroutineScope,
    val device: DeviceIdentity,
    private val deviceLabel: () -> String = { DeviceIdentity.label() },
    private val appLanguage: () -> String = { LocaleManager.effective() },
    /** The last loaded profile and bubbles, shown at once on launch and offline (docs/boolaa-spec.md "Offline and poor network"). */
    private val offlineCache: com.boolaa.app.core.OfflineCache? = null,
) {
    private val _state = MutableStateFlow(SessionState(storedBubbleId = prefs.getString(KEY_BUBBLE, null)))
    val state: StateFlow<SessionState> = _state.asStateFlow()

    /**
     * Invite code from an opened link (https://boolaa.ro/join/CODE), kept through sign-in, the device gate and onboarding
     * (and process death, in prefs) until the join preview is dismissed.
     */
    private val _pendingInvite = MutableStateFlow(prefs.getString(KEY_INVITE, null))
    val pendingInvite: StateFlow<String?> = _pendingInvite.asStateFlow()
    private val auth get() = api.client.auth
    private val mutex = Mutex()
    private val gateMutex = Mutex()
    private var authJob: Job? = null
    private var live: LiveTables? = null

    /** Runs before `auth.signOut()` (push: `unregister_push_token` while the session still exists). */
    var beforeSignOut: (suspend () -> Unit)? = null
    /** After the app language changed (push: register the token again with the new locale). */
    var onLocaleChanged: (() -> Unit)? = null
    /** A user is signed in (the outbox restores their unsent messages). */
    var onSignedIn: ((String) -> Unit)? = null
    /** Signed out, by the user, an expired session or account deletion: every offline cache is cleared. */
    var onSignedOut: (() -> Unit)? = null

    /** Listens to auth state for the lifetime of the app. */
    fun start() {
        if (authJob != null) return
        // Any RPC answering "session not verified" (e.g. another device revoked this one) runs the device gate again.
        scope.launch { SecurityEvents.sessionNotVerified.collect { recheckDevice() } }
        // Any RPC answering "account suspended": run the whole gate again, which shows the suspended screen.
        scope.launch { SecurityEvents.accountSuspended.collect { recheckAccount() } }
        authJob = scope.launch {
            auth.sessionStatus.collect { status ->
                when (status) {
                    is SessionStatus.Initializing -> Unit
                    is SessionStatus.Authenticated -> status.session.user?.let { user ->
                        val s = _state.value
                        if (s.userId != user.id || s.memberships == null) applySignedIn(user)
                    }
                    is SessionStatus.NotAuthenticated -> applySignedOut()
                    is SessionStatus.RefreshFailure -> {
                        // Offline with a stored session: keep the user, the screens will show network errors.
                        val user = auth.currentSessionOrNull()?.user
                        if (user != null) applySignedIn(user) else applySignedOut()
                    }
                }
            }
        }
    }

    private suspend fun applySignedIn(user: UserInfo) {
        val changedUser = _state.value.userId != user.id
        if (changedUser) {
            stopLive()
            _state.update {
                it.copy(memberships = null, profile = null, pendingRequests = emptyList(), blocks = emptyList(),
                    deviceGate = DeviceGate.CHECKING, needsAgeConfirmation = false, deviceCodeSentAt = null, suspension = null)
            }
        }
        _state.update { it.copy(userId = user.id, email = user.email, isRestoringSession = false) }
        onSignedIn?.invoke(user.id)
        offlineCache?.let { cache -> withContext(Dispatchers.IO) { cache.keepOnly(user.id) } }
        syncLocale(user)
        gate()
    }

    /**
     * The device gate (docs/auth-security.md §8): `start_device_check` after every sign-in and session restore, then the
     * account status (docs/moderation.md), the age screen if due, and only then realtime and the bubble data.
     * Unverified sessions stay on the code screen. [force] runs it again even when everything is loaded.
     */
    suspend fun gate(force: Boolean = false) = gateMutex.withLock { runGate(force) }

    private suspend fun runGate(force: Boolean) {
        val userId = _state.value.userId ?: return
        val current = _state.value
        if (!force && current.deviceGate == DeviceGate.VERIFIED && current.memberships != null && !current.needsAgeConfirmation &&
            current.suspension == null) return
        var offline = false
        val check = try {
            api.startDeviceCheck(device.id, deviceLabel())
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            Log.w("Boolaa", "start_device_check failed", e)
            if (endSessionOn(e)) return
            // No connection: show the cached bubbles at once instead of waiting for more timeouts.
            offline = UserFacingError.classify(e) == UserFacingError.NETWORK
            if (offline) restoreCachedBubbles(userId)
            // Offline with a stored session: carry on as before. The server still enforces RLS, and its
            // "session not verified" answer brings this gate back.
            null
        }
        if (_state.value.userId != userId) return
        // `code_required` only blocks while enforcement is on: is_device_verified() is true when it's off
        // (same rule as web `gateState` and iOS `DeviceGateDecision`). A failed call keeps the gate closed.
        val deviceVerified = if (check != null && !check.verified) {
            try {
                api.isDeviceVerified()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                Log.w("Boolaa", "is_device_verified failed", e)
                if (endSessionOn(e)) return
                null
            }
        } else null
        val effective = check ?: DeviceCheck("verified")
        val account = if (!offline && DeviceGateDecision.gateOpen(effective, deviceVerified)) readAccount(userId) else null
        if (_state.value.userId != userId) return
        apply(DeviceGateDecision.decide(effective, deviceVerified, account, isOAuthUser()), userId)
    }

    /** "Not authenticated" signs out; `user_banned` (a refresh refused) signs out to the "can't sign in" screen. */
    private fun endSessionOn(e: Throwable): Boolean = when (UserFacingError.classify(e)) {
        UserFacingError.NOT_AUTHENTICATED -> { scope.launch { signOut() }; true }
        UserFacingError.USER_BANNED -> { scope.launch { signOut(); markSignInBlocked() }; true }
        else -> false
    }

    private suspend fun readAccount(userId: String): AccountStatusRow? = try {
        api.accountStatus(userId)
    } catch (e: CancellationException) {
        throw e
    } catch (e: Throwable) {
        Log.w("Boolaa", "account status failed", e)
        null
    }

    private suspend fun apply(decision: DeviceGateDecision, userId: String) {
        when (decision) {
            DeviceGateDecision.Code -> {
                stopLive()
                _state.update { it.copy(deviceGate = DeviceGate.CODE_REQUIRED, needsAgeConfirmation = false, suspension = null) }
            }
            is DeviceGateDecision.Suspended -> {
                // RLS hides everything but the own row: nothing to load or listen to.
                stopLive()
                _state.update {
                    it.copy(deviceGate = DeviceGate.VERIFIED, needsAgeConfirmation = false, suspension = decision.suspension, memberships = null)
                }
            }
            DeviceGateDecision.Age -> {
                stopLive()
                _state.update { it.copy(deviceGate = DeviceGate.VERIFIED, needsAgeConfirmation = true, suspension = null) }
            }
            DeviceGateDecision.Ok -> {
                _state.update { it.copy(deviceGate = DeviceGate.VERIFIED, needsAgeConfirmation = false, suspension = null) }
                if (live == null) startLive(userId)
                reload()
            }
        }
    }

    /**
     * Google/Apple accounts are created without the sign-up checkbox. The server asks for `confirm_age` only once
     * `age_confirmation_required` is on; the app asks after the first OAuth sign-in regardless.
     */
    private fun isOAuthUser(): Boolean {
        val provider = auth.currentUserOrNull()?.appMetadata?.get("provider")?.jsonPrimitive?.contentOrNull ?: return false
        return provider != "email"
    }

    /**
     * Re-runs the device check, e.g. after a "session not verified" error or when the app comes back to the front.
     * On the suspended screen it runs the whole gate instead, since a suspension ends by itself at `status_until`.
     */
    fun recheckDevice() {
        val s = _state.value
        val userId = s.userId ?: return
        if (s.recoveringPassword) return
        if (s.suspension != null) { recheckAccount(throttle = false); return }
        scope.launch {
            val check = runCatching { api.startDeviceCheck(device.id, deviceLabel()) }.getOrNull() ?: return@launch
            val deviceVerified = if (!check.verified) runCatching { api.isDeviceVerified() }.getOrNull() else null
            if (_state.value.userId != userId) return@launch
            if (!DeviceGateDecision.gateOpen(check, deviceVerified)) {
                stopLive()
                _state.update { it.copy(deviceGate = DeviceGate.CODE_REQUIRED, needsAgeConfirmation = check.needsAgeConfirmation) }
                return@launch
            }
            // Gate open: also catch a suspension or ban that happened while the app was in the background.
            val suspension = readAccount(userId)?.let { Suspension.from(it) }
            if (_state.value.userId != userId) return@launch
            when {
                suspension != null -> apply(DeviceGateDecision.Suspended(suspension), userId)
                _state.value.deviceGate == DeviceGate.CODE_REQUIRED -> gate(force = true)
                check.needsAgeConfirmation && !_state.value.needsAgeConfirmation -> {
                    stopLive()
                    _state.update { it.copy(needsAgeConfirmation = true) }
                }
            }
        }
    }

    /** "account suspended" from any RPC, or the suspended screen coming back to the front: run the gate again. */
    fun recheckAccount(throttle: Boolean = true) {
        val s = _state.value
        if (s.userId == null || s.recoveringPassword) return
        if (throttle) {
            if (s.suspension != null) return
            // Never loop: if the server keeps disagreeing, re-check at most every 5 s.
            val now = System.currentTimeMillis()
            if (now - lastAccountRecheck < 5_000) return
            lastAccountRecheck = now
        }
        scope.launch { gate(force = true) }
    }
    private var lastAccountRecheck = 0L

    /** Sign-in or refresh answered `user_banned`: the suspended screen without details (no session to read them). */
    fun markSignInBlocked() {
        _state.update { it.copy(suspension = Suspension.signInBlocked) }
    }

    /** Leaves the "can't sign in" screen for the login screen. */
    fun dismissSignInBlocked() {
        _state.update { if (it.suspension?.kind == Suspension.Kind.SIGN_IN_BLOCKED) it.copy(suspension = null) else it }
    }

    /** Emails sign-in locale changes to Auth so its emails come in the app's language (§5). */
    private fun syncLocale(user: UserInfo) {
        val current = user.userMetadata?.get("locale")?.jsonPrimitive?.contentOrNull
        if (current == null) scope.launch { runCatching { updateLocale(appLanguage()) } }
    }

    /** `updateUser({ data: { locale } })`: on a language change and once after the first OAuth sign-in. */
    suspend fun updateLocale(tag: String) {
        if (_state.value.userId == null) return
        onLocaleChanged?.invoke()
        auth.updateUser { data { put("locale", tag) } }
    }

    /**
     * Realtime on the caller's own membership and join-request rows: admission moves Onboarding to Main, removal
     * from a bubble moves the user out live, and ownership hand-over updates the role.
     */
    private fun startLive(userId: String) {
        val previous = live
        scope.launch { previous?.close() }
        live = LiveTables.open(
            api.client, scope, "me",
            listOf(
                TableWatch("bubble_members", "user_id", userId), TableWatch("join_requests", "user_id", userId),
                // Name, description and logo edits of the caller's bubbles (RLS sends only bubbles they may read).
                TableWatch("bubbles"),
            ),
        ) { table, action ->
            if (table == "bubbles") {
                val patch = (action as? PostgresAction.Update)?.record?.let(BubblePatch::fromRecord) ?: return@open
                _state.update { s ->
                    val (m, r) = BubblePatch.merge(s.memberships, s.pendingRequests, patch) ?: return@update s
                    s.copy(memberships = m, pendingRequests = r)
                }
                return@open
            }
            val s = _state.value
            val relevant = when (table) {
                "bubble_members" -> LiveTables.oldValue(action, "user_id")?.let { it == userId } ?: true
                else -> LiveTables.oldValue(action, "id")?.let { id -> s.pendingRequests.any { it.id == id } } ?: true
            }
            if (relevant) reload()
        }
    }

    private fun stopLive() {
        val previous = live ?: return
        live = null
        scope.launch { previous.close() }
    }

    private fun applySignedOut() {
        stopLive()
        onSignedOut?.invoke()
        _state.update {
            it.copy(userId = null, email = null, profile = null, memberships = null,
                pendingRequests = emptyList(), blocks = emptyList(), isRestoringSession = false,
                deviceGate = DeviceGate.CHECKING, needsAgeConfirmation = false, recoveringPassword = false, deviceCodeSentAt = null,
                // The "can't sign in" screen outlives the (refused) session; a real suspension belongs to the session.
                suspension = it.suspension?.takeIf { s -> s.kind == Suspension.Kind.SIGN_IN_BLOCKED })
        }
    }

    /** Reloads profile, memberships and pending requests. Returns the error, if any. */
    suspend fun reload(): Throwable? = mutex.withLock {
        val userId = _state.value.userId ?: return null
        runCatching {
            coroutineScope {
                val p = async { api.profile(userId) }
                val m = async { api.memberships(userId) }
                val r = async { api.myJoinRequests(userId) }
                val b = async { runCatching { api.blocks() }.getOrDefault(_state.value.blocks) }
                Loaded(p.await(), m.await(), r.await(), b.await())
            }
        }.fold(
            onSuccess = { (profile, members, requests, blocks) ->
                _state.update {
                    val approved = members.filter { m -> m.approved }
                    val welcome = admittedBubble(it.pendingRequests, it.memberships, approved) ?: it.welcomeBubbleId
                    it.copy(profile = profile, memberships = approved, pendingRequests = requests, blocks = blocks, welcomeBubbleId = welcome)
                }
                _state.value.currentBubble?.let { persistBubble(it.id) }
                saveCachedBubbles(userId)
                null
            },
            onFailure = { e ->
                SecurityEvents.emitFor(UserFacingError.classify(e))
                if (_state.value.memberships == null) restoreCachedBubbles(userId)
                _state.update { if (it.memberships == null) it.copy(memberships = emptyList()) else it }
                e
            },
        )
    }

    private suspend fun saveCachedBubbles(userId: String) {
        val cache = offlineCache ?: return
        val s = _state.value
        if (s.userId != userId) return
        val snapshot = CachedSession(s.profile, s.memberships.orEmpty(), s.pendingRequests, s.blocks)
        withContext(Dispatchers.IO) { cache.save(userId, CacheKeys.BUBBLES, CachedSession.serializer(), snapshot) }
    }

    /** Offline launch: the bubbles, profile and requests last loaded (only while nothing is loaded). */
    private suspend fun restoreCachedBubbles(userId: String) {
        val cache = offlineCache ?: return
        val cached = withContext(Dispatchers.IO) { cache.load(userId, CacheKeys.BUBBLES, CachedSession.serializer()) } ?: return
        _state.update {
            if (it.userId != userId || it.memberships != null) it
            else it.copy(profile = cached.profile, memberships = cached.memberships, pendingRequests = cached.pendingRequests, blocks = cached.blocks)
        }
    }

    /** True once for the bubble that was just joined; the cheer then never repeats. */
    fun takeWelcome(bubbleId: String): Boolean {
        var taken = false
        _state.update { if (it.welcomeBubbleId == bubbleId) { taken = true; it.copy(welcomeBubbleId = null) } else it }
        return taken
    }

    fun selectBubble(id: String) {
        persistBubble(id)
        _state.update { it.copy(storedBubbleId = id) }
    }

    private fun persistBubble(id: String?) {
        prefs.edit().apply { if (id == null) remove(KEY_BUBBLE) else putString(KEY_BUBBLE, id) }.apply()
    }

    // Auth actions

    suspend fun signIn(email: String, password: String) {
        try {
            auth.signInWith(Email) {
                this.email = email.trim()
                this.password = password
            }
        } catch (e: Throwable) {
            if (blockedSignIn(e)) return
            throw e
        }
        dismissSignInBlocked()
        auth.currentUserOrNull()?.let { applySignedIn(it) }
    }

    /** GoTrue's `user_banned` (suspended or banned): shows the suspended screen instead of an error. */
    private fun blockedSignIn(e: Throwable): Boolean {
        if (e is CancellationException || UserFacingError.classify(e) != UserFacingError.USER_BANNED) return false
        markSignInBlocked()
        return true
    }

    /**
     * Returns false when the backend requires email confirmation before a session exists. Sends the sign-up metadata
     * of docs/auth-security.md §6: name, locale, the 16+ checkbox and the accepted Terms version.
     */
    suspend fun signUp(name: String, email: String, password: String): Boolean {
        auth.signUpWith(Email, redirectUrl = Backend.AUTH_REDIRECT) {
            this.email = email.trim()
            this.password = password
            data = signUpMetadata(name, appLanguage())
        }
        val user = auth.currentSessionOrNull()?.user ?: return false
        applySignedIn(user)
        return true
    }

    /** Google: an ID token from Credential Manager, checked against the raw nonce whose sha256 Google signed. */
    suspend fun signInWithGoogle(idToken: String, rawNonce: String) {
        try {
            auth.signInWith(IDToken, config = com.boolaa.app.core.GoogleSignIn.idTokenConfig(idToken, rawNonce))
        } catch (e: Throwable) {
            if (blockedSignIn(e)) return
            throw e
        }
        dismissSignInBlocked()
        auth.currentUserOrNull()?.let { applySignedIn(it) }
    }

    /** Apple: the OAuth web flow in a Custom Tab; the session arrives through the deep link (MainActivity). */
    suspend fun startAppleSignIn() {
        auth.signInWith(Apple, redirectUrl = Backend.AUTH_REDIRECT)
    }

    suspend fun signOut() {
        if (_state.value.userId != null) runCatching { beforeSignOut?.invoke() }
        runCatching { auth.signOut() }
        clearInvite()
        applySignedOut()
    }

    // Forgot password (docs/auth-security.md §2): email -> 6-digit code -> new password -> signed in.

    /** Auth answers 200 whether or not the account exists; the UI always says "If an account exists...". */
    suspend fun sendPasswordReset(email: String) {
        auth.resetPasswordForEmail(email.trim(), redirectUrl = Backend.AUTH_REDIRECT)
    }

    /** Verifying the code signs in (amr otp, so the device counts as verified); the new password screen comes next. */
    suspend fun verifyPasswordReset(email: String, code: String) {
        _state.update { it.copy(recoveringPassword = true) }
        try {
            auth.verifyEmailOtp(OtpType.Email.RECOVERY, email = email.trim(), token = code)
        } catch (e: Throwable) {
            _state.update { it.copy(recoveringPassword = false) }
            if (blockedSignIn(e)) return
            throw e
        }
        auth.currentUserOrNull()?.let { applySignedIn(it) }
    }

    /** A fresh recovery session needs no nonce. Then the routing gate continues as for any sign-in. */
    suspend fun finishPasswordReset(newPassword: String) {
        auth.updateUser { password = newPassword }
        _state.update { it.copy(recoveringPassword = false) }
        gate(force = true)
    }

    // Device verification

    /** Emails a device code (`device-code`, purpose device). */
    suspend fun sendDeviceCode() {
        api.deviceCode(DeviceCodeBody.send(CodePurpose.DEVICE, device.id, deviceLabel(), null, appLanguage()))
        _state.update { it.copy(deviceCodeSentAt = System.currentTimeMillis()) }
    }

    /** Verifies the emailed code: trusts this device, verifies the session, then reloads everything. */
    suspend fun verifyDeviceCode(code: String) {
        api.deviceCode(DeviceCodeBody.verify(CodePurpose.DEVICE, code, device.id, deviceLabel()))
        _state.update { it.copy(deviceGate = DeviceGate.CHECKING, memberships = null) }
        gate()
    }

    /** One-time 16+ and Terms confirmation for accounts created without the sign-up checkbox. */
    suspend fun confirmAge() {
        api.confirmAge(TERMS_VERSION)
        _state.update { it.copy(needsAgeConfirmation = false, memberships = null) }
        gate()
    }

    // Sensitive actions (signed in)

    /** Emails a `sensitive_action` code; the proof belongs to this session for 10 minutes after verification. */
    suspend fun sendSensitiveActionCode(action: SensitiveAction) {
        api.deviceCode(DeviceCodeBody.send(CodePurpose.SENSITIVE_ACTION, null, null, action, appLanguage()))
    }

    suspend fun verifySensitiveActionCode(code: String) {
        api.deviceCode(DeviceCodeBody.verify(CodePurpose.SENSITIVE_ACTION, code, null, null))
    }

    /** "Download my data": call right after a verified `export_data` code (the proof belongs to this session). */
    suspend fun exportMyData(): DataExportFile = api.exportMyData()

    /**
     * Change password, step 1: emails a `change_password` code. The server refuses a password change
     * without one (guard_sensitive_auth_change, docs/auth-security.md → Sensitive actions).
     */
    suspend fun requestPasswordChangeCode() = sendSensitiveActionCode(SensitiveAction.CHANGE_PASSWORD)

    /** Change password, step 2: after a verified `change_password` code (within 10 minutes). */
    suspend fun changePassword(newPassword: String) {
        auth.updateUser { password = newPassword }
    }

    /** After a verified `sensitive_action` code. Both addresses get an email; the change completes from the link or code. */
    suspend fun changeEmail(newEmail: String) {
        auth.updateUser(redirectUrl = Backend.AUTH_REDIRECT) { email = newEmail.trim() }
    }

    // Your devices

    suspend fun devices(): List<TrustedDevice> = api.listMyDevices()

    suspend fun revokeDevice(hash: String): Boolean = api.revokeDevice(hash)

    // Profile & bubble actions

    suspend fun updateProfile(name: String? = null, avatar: String? = null) {
        val userId = _state.value.userId ?: return
        val oldAvatar = _state.value.profile?.avatar
        val profile = api.updateProfile(userId, name, avatar)
        _state.update { it.copy(profile = profile) }
        // Replaced avatar: remove the old object (storage SELECT/DELETE on own files).
        if (avatar != null && oldAvatar != null && oldAvatar != avatar) api.deleteImage(oldAvatar, ImageBucket.AVATARS, userId)
    }

    suspend fun createBubble(name: String, description: String?, maxSize: Int) {
        val bubble = api.createBubble(name, description, maxSize)
        selectBubble(bubble.id)
        reload()
    }

    suspend fun requestToJoin(code: String): JoinRequest {
        val request = api.requestToJoin(code)
        reload()
        return request
    }

    // Invite links

    /** An opened invite link; the preview shows once the user is in Onboarding or Main. */
    fun openInvite(code: String) {
        prefs.edit().putString(KEY_INVITE, code).apply()
        _pendingInvite.value = code
    }

    fun clearInvite() {
        prefs.edit().remove(KEY_INVITE).apply()
        _pendingInvite.value = null
    }

    suspend fun invitePreview(code: String) = api.invitePreview(code)

    /** Owner or admin; the reload brings the new code into the current bubble. */
    suspend fun rotateInviteCode(bubbleId: String): String {
        val code = api.rotateInviteCode(bubbleId)
        reload()
        return code
    }

    suspend fun cancelRequest(request: JoinRequest) {
        api.cancelJoinRequest(request.id)
        reload()
    }

    suspend fun leaveCurrentBubble() {
        val s = _state.value
        val userId = s.userId ?: return
        val bubble = s.currentBubble ?: return
        api.leaveBubble(bubble.id, userId)
        persistBubble(null)
        _state.update { it.copy(storedBubbleId = null) }
        reload()
    }

    suspend fun updateCurrentBubble(name: String, description: String?) {
        val bubble = _state.value.currentBubble ?: return
        api.updateBubble(bubble.id, name, description)
        reload()
    }

    /**
     * Bubble logo (owner or admin): compress like an avatar (512 px, 2 MB), upload to `bubble.images/<bubble id>/`,
     * point the row at it, then remove the previous object. A failed row update removes the new upload.
     */
    suspend fun setBubbleLogo(bubble: Bubble, jpeg: ByteArray) {
        val url = api.uploadBubbleLogo(jpeg, bubble.id)
        try {
            api.updateBubbleLogo(bubble.id, url)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            api.deleteBubbleLogo(url, bubble.id)
            throw e
        }
        mergeLogo(bubble.id, url)
        if (bubble.logo != url) api.deleteBubbleLogo(bubble.logo, bubble.id)
    }

    suspend fun removeBubbleLogo(bubble: Bubble) {
        api.updateBubbleLogo(bubble.id, null)
        mergeLogo(bubble.id, null)
        api.deleteBubbleLogo(bubble.logo, bubble.id)
    }

    private fun mergeLogo(bubbleId: String, logo: String?) {
        _state.update { s ->
            val b = s.bubbles.firstOrNull { it.id == bubbleId } ?: return@update s
            val (m, r) = BubblePatch.merge(s.memberships, s.pendingRequests, BubblePatch(b.id, b.name, b.description, logo)) ?: return@update s
            s.copy(memberships = m, pendingRequests = r)
        }
    }

    // Safety

    suspend fun block(userId: String) {
        val me = _state.value.userId ?: return
        api.block(me, userId)
        _state.update { it.copy(blocks = api.blocks()) }
    }

    suspend fun unblock(userId: String) {
        val me = _state.value.userId ?: return
        api.unblock(me, userId)
        _state.update { it.copy(blocks = api.blocks()) }
    }

    /** Storage cleanup, delete_my_account(), then a local sign-out back to Auth. */
    suspend fun deleteAccount() {
        val me = _state.value.userId ?: return
        api.deleteMyAccount(me)
        persistBubble(null)
        _state.update { it.copy(storedBubbleId = null) }
        signOut()
    }

    /** What the `bubbles` cache key holds. */
    @kotlinx.serialization.Serializable
    data class CachedSession(
        val profile: UserProfile? = null,
        val memberships: List<BubbleMember> = emptyList(),
        val pendingRequests: List<JoinRequest> = emptyList(),
        val blocks: List<Block> = emptyList(),
    )

    private data class Loaded(val profile: UserProfile, val members: List<BubbleMember>, val requests: List<JoinRequest>, val blocks: List<Block>)

    companion object {
        private const val KEY_BUBBLE = "boolaa.currentBubbleID"
        private const val KEY_INVITE = "boolaa.pendingInvite"

        /** A bubble that was a pending request and is now an approved membership (null on the first load). */
        fun admittedBubble(previousPending: List<JoinRequest>, previousMembers: List<BubbleMember>?, now: List<BubbleMember>): String? {
            if (previousMembers == null) return null
            val had = previousMembers.mapTo(HashSet()) { it.bubbleId }
            val requested = previousPending.mapTo(HashSet()) { it.bubbleId }
            return now.firstOrNull { it.bubbleId in requested && it.bubbleId !in had }?.bubbleId
        }

        /** Sign-up `options.data` (docs/auth-security.md §6). */
        fun signUpMetadata(name: String, locale: String): JsonObject = buildJsonObject {
            put("name", name.trim())
            put("locale", locale)
            put("age_confirmed", true)
            put("terms_version", TERMS_VERSION)
        }
    }
}

/** App-wide security signals raised outside the store (any ViewModel that sees "session not verified"). */
object SecurityEvents {
    val sessionNotVerified = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val accountSuspended = MutableSharedFlow<Unit>(extraBufferCapacity = 1)

    /** "session not verified" goes back to the device gate, "account suspended" to the suspended screen. */
    fun emitFor(kind: UserFacingError) {
        when (kind) {
            UserFacingError.SESSION_NOT_VERIFIED -> sessionNotVerified.tryEmit(Unit)
            UserFacingError.ACCOUNT_SUSPENDED -> accountSuspended.tryEmit(Unit)
            else -> Unit
        }
    }
}
