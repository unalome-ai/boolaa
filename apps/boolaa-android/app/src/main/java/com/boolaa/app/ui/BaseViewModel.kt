package com.boolaa.app.ui

import android.util.Log
import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.boolaa.app.core.UserFacingError
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

/** Shared error handling: failures become a translated string resource, never raw backend text. */
abstract class BaseViewModel : ViewModel() {
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
