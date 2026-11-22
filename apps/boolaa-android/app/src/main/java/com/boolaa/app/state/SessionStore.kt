package com.boolaa.app.state

import android.content.SharedPreferences
import com.boolaa.app.core.BoolaaApi
import com.boolaa.app.core.ImageBucket
import com.boolaa.app.core.LiveTables
import com.boolaa.app.core.TableWatch
import com.boolaa.app.model.Bubble
import com.boolaa.app.model.BubbleMember
import com.boolaa.app.model.JoinRequest
import com.boolaa.app.model.MemberRole
import com.boolaa.app.model.UserProfile
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.auth.status.SessionStatus
import io.github.jan.supabase.auth.user.UserInfo
import kotlinx.coroutines.CoroutineScope
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
import kotlinx.serialization.json.buildJsonObject
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
) {
    val route: AppRoute get() = RouteGate.resolve(isRestoringSession, userId != null, memberships?.size)
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
) {
    private val _state = MutableStateFlow(SessionState(storedBubbleId = prefs.getString(KEY_BUBBLE, null)))
    val state: StateFlow<SessionState> = _state.asStateFlow()
    private val auth get() = api.client.auth
    private val mutex = Mutex()
    private var authJob: Job? = null
    private var live: LiveTables? = null

    /** Listens to auth state for the lifetime of the app. */
    fun start() {
        if (authJob != null) return
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
        _state.update {
            if (it.userId != user.id) it.copy(memberships = null, profile = null, pendingRequests = emptyList())
            else it
        }
        val changedUser = _state.value.userId != user.id || live == null
        _state.update { it.copy(userId = user.id, email = user.email, isRestoringSession = false) }
        if (changedUser) startLive(user.id)
        reload()
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
                pendingRequests = emptyList(), isRestoringSession = false)
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
                Triple(p.await(), m.await(), r.await())
            }
        }.fold(
            onSuccess = { (profile, members, requests) ->
                _state.update { it.copy(profile = profile, memberships = members.filter { m -> m.approved }, pendingRequests = requests) }
                _state.value.currentBubble?.let { persistBubble(it.id) }
                null
            },
            onFailure = { e ->
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

    /** Returns false when the backend requires email confirmation before a session exists. */
    suspend fun signUp(name: String, email: String, password: String): Boolean {
        auth.signUpWith(Email) {
            this.email = email.trim()
            this.password = password
            data = buildJsonObject { put("name", name.trim()) }
        }
        val user = auth.currentSessionOrNull()?.user ?: return false
        applySignedIn(user)
        return true
    }

    suspend fun signOut() {
        runCatching { auth.signOut() }
        applySignedOut()
    }

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

    private companion object {
        const val KEY_BUBBLE = "boolaa.currentBubbleID"
    }
}
