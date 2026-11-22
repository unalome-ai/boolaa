package com.boolaa.app.state

import android.content.SharedPreferences
import android.util.Log
import com.boolaa.app.core.Backend
import com.boolaa.app.core.BoolaaApi
import com.boolaa.app.core.CodePurpose
import com.boolaa.app.core.DeviceCodeBody
import com.boolaa.app.core.DeviceIdentity
import com.boolaa.app.core.ImageBucket
import com.boolaa.app.core.SensitiveAction
import com.boolaa.app.core.TERMS_VERSION
import com.boolaa.app.core.UserFacingError
import com.boolaa.app.core.confirmAge
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
) {
    val blockedIds: Set<String> get() = blocks.mapTo(mutableSetOf()) { it.blockedId }
    val route: AppRoute
        get() = RouteGate.resolve(isRestoringSession, userId != null, memberships?.size, deviceGate, needsAgeConfirmation, recoveringPassword)
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
) {
    private val _state = MutableStateFlow(SessionState(storedBubbleId = prefs.getString(KEY_BUBBLE, null)))
    val state: StateFlow<SessionState> = _state.asStateFlow()
    private val auth get() = api.client.auth
    private val mutex = Mutex()
    private val gateMutex = Mutex()
    private var authJob: Job? = null
    private var live: LiveTables? = null

    /** Listens to auth state for the lifetime of the app. */
    fun start() {
        if (authJob != null) return
        // Any RPC answering "session not verified" (e.g. another device revoked this one) runs the device gate again.
        scope.launch { SecurityEvents.sessionNotVerified.collect { recheckDevice() } }
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
                    deviceGate = DeviceGate.CHECKING, needsAgeConfirmation = false, deviceCodeSentAt = null)
            }
        }
        _state.update { it.copy(userId = user.id, email = user.email, isRestoringSession = false) }
        syncLocale(user)
        gate()
    }

    /**
     * The device gate (docs/auth-security.md §8): `start_device_check` after every sign-in and session restore, then the
     * age screen if due, and only then realtime and the bubble data. Unverified sessions stay on the code screen.
     */
    suspend fun gate() = gateMutex.withLock { runGate() }

    private suspend fun runGate() {
        val userId = _state.value.userId ?: return
        if (_state.value.deviceGate == DeviceGate.VERIFIED && _state.value.memberships != null && !_state.value.needsAgeConfirmation) return
        val check = try {
            api.startDeviceCheck(device.id, deviceLabel())
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            Log.w("Boolaa", "start_device_check failed", e)
            if (UserFacingError.classify(e) == UserFacingError.NOT_AUTHENTICATED) {
                scope.launch { signOut() }
                return
            }
            // Offline with a stored session: carry on as before. The server still enforces RLS, and its
            // "session not verified" answer brings this gate back.
            null
        }
        if (_state.value.userId != userId) return
        if (check != null && !check.verified) {
            stopLive()
            _state.update { it.copy(deviceGate = DeviceGate.CODE_REQUIRED, needsAgeConfirmation = check.needsAgeConfirmation) }
            return
        }
        val needsAge = (check?.needsAgeConfirmation ?: false) || firstOAuthAgeDue(userId)
        _state.update { it.copy(deviceGate = DeviceGate.VERIFIED, needsAgeConfirmation = needsAge) }
        if (needsAge) { stopLive(); return }
        if (live == null) startLive(userId)
        reload()
    }

    /**
     * Google/Apple accounts are created without the sign-up checkbox. The server asks for `confirm_age` only once
     * `age_confirmation_required` is on; the app asks after the first OAuth sign-in regardless.
     */
    private suspend fun firstOAuthAgeDue(userId: String): Boolean {
        val provider = auth.currentUserOrNull()?.appMetadata?.get("provider")?.jsonPrimitive?.contentOrNull ?: return false
        if (provider == "email") return false
        return runCatching {
            val rows = api.client.from("users").select(io.github.jan.supabase.postgrest.query.Columns.list("age_confirmed_at")) {
                filter { eq("id", userId) }
            }.decodeList<JsonObject>()
            rows.firstOrNull()?.get("age_confirmed_at")?.jsonPrimitive?.contentOrNull == null
        }.getOrDefault(false)
    }

    /** Re-runs the device check, e.g. after a "session not verified" error or when the app comes back to the front. */
    fun recheckDevice() {
        val s = _state.value
        if (s.userId == null || s.recoveringPassword) return
        scope.launch {
            val check = runCatching { api.startDeviceCheck(device.id, deviceLabel()) }.getOrNull() ?: return@launch
            if (!check.verified) {
                stopLive()
                _state.update { it.copy(deviceGate = DeviceGate.CODE_REQUIRED, needsAgeConfirmation = check.needsAgeConfirmation) }
            } else if (check.needsAgeConfirmation && !_state.value.needsAgeConfirmation) {
                stopLive()
                _state.update { it.copy(needsAgeConfirmation = true) }
            }
        }
    }

    /** Emails sign-in locale changes to Auth so its emails come in the app's language (§5). */
    private fun syncLocale(user: UserInfo) {
        val current = user.userMetadata?.get("locale")?.jsonPrimitive?.contentOrNull
        if (current == null) scope.launch { runCatching { updateLocale(appLanguage()) } }
    }

    /** `updateUser({ data: { locale } })`: on a language change and once after the first OAuth sign-in. */
    suspend fun updateLocale(tag: String) {
        if (_state.value.userId == null) return
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
            listOf(TableWatch("bubble_members", "user_id", userId), TableWatch("join_requests", "user_id", userId)),
        ) { table, action ->
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
        _state.update {
            it.copy(userId = null, email = null, profile = null, memberships = null,
                pendingRequests = emptyList(), blocks = emptyList(), isRestoringSession = false,
                deviceGate = DeviceGate.CHECKING, needsAgeConfirmation = false, recoveringPassword = false, deviceCodeSentAt = null)
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
                    it.copy(profile = profile, memberships = members.filter { m -> m.approved }, pendingRequests = requests, blocks = blocks)
                }
                _state.value.currentBubble?.let { persistBubble(it.id) }
                null
            },
            onFailure = { e ->
                if (UserFacingError.classify(e) == UserFacingError.SESSION_NOT_VERIFIED) SecurityEvents.sessionNotVerified.tryEmit(Unit)
                _state.update { if (it.memberships == null) it.copy(memberships = emptyList()) else it }
                e
            },
        )
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
        auth.signInWith(Email) {
            this.email = email.trim()
            this.password = password
        }
        auth.currentUserOrNull()?.let { applySignedIn(it) }
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
        auth.signInWith(IDToken, config = com.boolaa.app.core.GoogleSignIn.idTokenConfig(idToken, rawNonce))
        auth.currentUserOrNull()?.let { applySignedIn(it) }
    }

    /** Apple: the OAuth web flow in a Custom Tab; the session arrives through the deep link (MainActivity). */
    suspend fun startAppleSignIn() {
        auth.signInWith(Apple, redirectUrl = Backend.AUTH_REDIRECT)
    }

    suspend fun signOut() {
        runCatching { auth.signOut() }
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
            throw e
        }
        auth.currentUserOrNull()?.let { applySignedIn(it) }
    }

    /** A fresh recovery session needs no nonce. Then the routing gate continues as for any sign-in. */
    suspend fun finishPasswordReset(newPassword: String) {
        auth.updateUser { password = newPassword }
        _state.update { it.copy(recoveringPassword = false) }
        gate()
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

    /** Change password, step 1: Auth emails a reauthentication code. */
    suspend fun requestPasswordChangeCode() {
        auth.reauthenticate()
    }

    /** Change password, step 2: always with the nonce, so every session gets the same UX (§2). */
    suspend fun changePassword(newPassword: String, code: String) {
        auth.updateUser {
            password = newPassword
            nonce = code
        }
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

    private data class Loaded(val profile: UserProfile, val members: List<BubbleMember>, val requests: List<JoinRequest>, val blocks: List<Block>)

    companion object {
        private const val KEY_BUBBLE = "boolaa.currentBubbleID"

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
}
