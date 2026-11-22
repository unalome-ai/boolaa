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

/** Shared error handling: failures become a translated string resource, never raw backend text. */
abstract class BaseViewModel : ViewModel() {
    private val _error = MutableStateFlow<Int?>(null)
    val error: StateFlow<Int?> = _error.asStateFlow()
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    fun clearError() { _error.value = null }
    protected fun showError(@StringRes res: Int) { _error.value = res }

    protected fun report(e: Throwable) {
        Log.w("Boolaa", "request failed", e)
        _error.value = UserFacingError.classify(e).message
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
