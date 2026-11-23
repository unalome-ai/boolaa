package com.boolaa.app.ui

import android.util.Log
import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.boolaa.app.core.Backoff
import com.boolaa.app.core.UserFacingError
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import com.boolaa.app.ui.components.ErrorDialog
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.map

/**
 * How a screen's last load went (docs/boolaa-spec.md "Offline and poor network"): [FAILED] = nothing to show (inline
 * error with Try again), [STALE] = older or cached data stays on screen ("Couldn't refresh" notice).
 */
enum class LoadIssue { NONE, FAILED, STALE }

/** Shared error handling: failures become a translated string resource, never raw backend text. */
abstract class BaseViewModel : ViewModel() {
    private val _loadIssue = MutableStateFlow(LoadIssue.NONE)
    val loadIssue: StateFlow<LoadIssue> = _loadIssue.asStateFlow()
    private var reloadAction: (() -> Unit)? = null
    private var retryJob: Job? = null
    private var autoAttempts = 0

    /**
     * Offline-aware screen: shows [key]'s cached value in [target] at once (only while nothing is loaded), and calls
     * [reload] on every reconnect and return to the front (the refetch generation), and for automatic retries.
     */
    protected fun <T> offlineAware(
        container: com.boolaa.app.AppContainer, target: MutableStateFlow<T?>?, key: String?, serializer: KSerializer<T>?,
        reload: () -> Unit,
    ) {
        reloadAction = reload
        val userId = container.session.state.value.userId
        if (target != null && key != null && serializer != null && userId != null) viewModelScope.launch {
            val cached = withContext(Dispatchers.IO) { container.offlineCache.load(userId, key, serializer) }
            if (cached != null && target.value == null) target.value = cached
        }
        viewModelScope.launch { container.connectivity.refresh.drop(1).collect { retryNow() } }
    }

    /** The Try again button: reloads at once and resets the backoff. */
    fun retryNow() {
        autoAttempts = 0
        retryJob?.cancel()
        reloadAction?.invoke()
    }

    /** Writes a successful load to the offline cache (off the main thread). */
    protected fun <T> saveCache(container: com.boolaa.app.AppContainer, key: String, serializer: KSerializer<T>, value: T) {
        val userId = container.session.state.value.userId ?: return
        container.appScope.launch(Dispatchers.IO) { container.offlineCache.save(userId, key, serializer, value) }
    }

    /**
     * Runs a screen load. Failures never open the error dialog: they become [LoadIssue.FAILED] ([hasData] false) or
     * [LoadIssue.STALE], and while online the load is retried with backoff (at most [Backoff.MAX_AUTO_ATTEMPTS] times).
     */
    protected fun runLoad(
        container: com.boolaa.app.AppContainer, hasData: () -> Boolean, trackBusy: Boolean = false, block: suspend () -> Unit,
    ): Job = viewModelScope.launch {
        if (trackBusy) _busy.value = true
        try {
            block()
            _loadIssue.value = LoadIssue.NONE
            autoAttempts = 0
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            Log.w("Boolaa", "load failed", e)
            val kind = UserFacingError.classify(e)
            com.boolaa.app.state.SecurityEvents.emitFor(kind)
            // Timeouts cancel the OkHttp call, so the interceptor can't tell: report them here.
            if (kind == UserFacingError.NETWORK) container.connectivity.report(false)
            _loadIssue.value = if (hasData()) LoadIssue.STALE else LoadIssue.FAILED
            if (container.connectivity.isOnline && autoAttempts < Backoff.MAX_AUTO_ATTEMPTS &&
                (kind == UserFacingError.NETWORK || kind == UserFacingError.GENERIC)) {
                val wait = Backoff.delayMs(autoAttempts++, Backoff.randomJitter())
                retryJob?.cancel()
                retryJob = viewModelScope.launch { delay(wait); reloadAction?.invoke() }
            }
        } finally {
            if (trackBusy) _busy.value = false
        }
    }

    /** Re-runnable from subclasses that track loading themselves. */
    protected fun markLoadIssue(issue: LoadIssue) { _loadIssue.value = issue }

    private val _error = MutableStateFlow<Int?>(null)
    val error: StateFlow<Int?> = _error.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    fun clearError() { _error.value = null }

    /** Blocking hides content server-side (RLS), so content screens reload when the block list changes. */
    protected fun reloadOnBlockChange(session: com.boolaa.app.state.SessionStore, reload: () -> Unit) {
        viewModelScope.launch {
            session.state.map { it.blockedIds }.distinctUntilChanged().drop(1).collect { reload() }
        }
    }
    protected fun showError(@StringRes res: Int) { _error.value = res }

    protected fun report(e: Throwable) {
        Log.w("Boolaa", "request failed", e)
        val kind = UserFacingError.classify(e)
        // Another device revoked this one (or enforcement just switched on): back to the device gate.
        // "account suspended" (a moderator acted meanwhile): to the suspended screen.
        com.boolaa.app.state.SecurityEvents.emitFor(kind)
        _error.value = kind.message
    }

    /**
     * A [ReactionStore] for the rows of [list] (docs/boolaa-spec.md "Reactions"): reactions are fetched for ids as
     * they appear (live rows, older pages). After a full load, call [ReactionStore.refresh] with every id held.
     */
    protected fun <T> reactionStore(
        api: com.boolaa.app.core.BoolaaApi, bubbleId: String, target: com.boolaa.app.model.ReactionTarget,
        list: StateFlow<List<T>?>, id: (T) -> String,
    ): com.boolaa.app.core.ReactionStore {
        val store = com.boolaa.app.core.ReactionStore(api, bubbleId, target) { t -> list.value?.any { id(it) == t } == true }
        viewModelScope.launch { list.map { l -> l?.map(id).orEmpty() }.distinctUntilChanged().collect { store.sync(it) } }
        return store
    }

    /** Toggles [me]'s [kind] on [targetId]; failures show the generic error. */
    protected fun toggleReaction(store: com.boolaa.app.core.ReactionStore, targetId: String, kind: com.boolaa.app.model.ReactionKind, me: String?) {
        if (me == null) return
        launchCatching(trackBusy = false) { store.toggle(targetId, kind, me) }
    }

    /** Runs [block], mapping failures to [error]; [onSuccess] runs only when it completes. */
    protected fun launchCatching(trackBusy: Boolean = true, onSuccess: () -> Unit = {}, block: suspend () -> Unit): Job =
        viewModelScope.launch {
            if (trackBusy) _busy.value = true
            try {
                block()
                onSuccess()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                report(e)
            } finally {
                if (trackBusy) _busy.value = false
            }
        }
}

@Composable
fun ErrorDialogFor(vm: BaseViewModel) {
    val error by vm.error.collectAsStateWithLifecycle()
    ErrorDialog(message = error?.let { stringResource(it) }, onDismiss = vm::clearError)
}
