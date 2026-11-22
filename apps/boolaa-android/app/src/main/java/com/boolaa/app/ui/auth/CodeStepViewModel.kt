package com.boolaa.app.ui.auth

import android.util.Log
import androidx.lifecycle.viewModelScope
import com.boolaa.app.core.DeviceCodeException
import com.boolaa.app.ui.BaseViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * One emailed-code step: send / resend with the 60 s cooldown, six digits, auto-submit, inline errors with a shake,
 * and a success tick for the haptic. Subclasses say how to send and verify.
 */
abstract class CodeStepViewModel : BaseViewModel() {
    private val _code = MutableStateFlow("")
    val code: StateFlow<String> = _code.asStateFlow()
    private val _codeError = MutableStateFlow<CodeError?>(null)
    val codeError: StateFlow<CodeError?> = _codeError.asStateFlow()
    private val _shakes = MutableStateFlow(0)
    val shakes: StateFlow<Int> = _shakes.asStateFlow()
    private val _sentAt = MutableStateFlow<Long?>(null)
    private val ownSentAt = _sentAt.asStateFlow()
    /** When the last code went out (drives the resend countdown). */
    open val sentAt: StateFlow<Long?> get() = ownSentAt

    /** Back to the start of the flow (e.g. edit the email): forget the sent code. */
    protected fun resetSent() { _sentAt.value = null; _code.value = ""; _codeError.value = null }
    private val _sending = MutableStateFlow(false)
    val sending: StateFlow<Boolean> = _sending.asStateFlow()
    private val _verifying = MutableStateFlow(false)
    val verifying: StateFlow<Boolean> = _verifying.asStateFlow()
    /** Increments on each successful verification (haptic success). */
    private val _successes = MutableStateFlow(0)
    val successes: StateFlow<Int> = _successes.asStateFlow()

    protected abstract suspend fun sendCode()
    protected abstract suspend fun verifyCode(code: String)
    /** A second 401 from the function: the session is gone. */
    protected open suspend fun onUnauthorized() {}

    fun onCodeChange(value: String) {
        val digits = codeDigits(value)
        _code.value = digits
        if (digits.isNotEmpty()) _codeError.value = null
        if (digits.length == CODE_LENGTH) submit()
    }

    fun send() {
        if (_sending.value) return
        viewModelScope.launch {
            _sending.value = true
            try {
                sendCode()
                _sentAt.value = System.currentTimeMillis()
                _codeError.value = null
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                fail(e, shake = false)
            } finally {
                _sending.value = false
            }
        }
    }

    fun submit() {
        val value = _code.value
        if (value.length != CODE_LENGTH || _verifying.value) return
        viewModelScope.launch {
            _verifying.value = true
            try {
                verifyCode(value)
                _successes.value++
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                _code.value = ""
                fail(e, shake = true)
            } finally {
                _verifying.value = false
            }
        }
    }

    private suspend fun fail(e: Throwable, shake: Boolean) {
        Log.w("Boolaa", "code step failed", e)
        if (e is DeviceCodeException && e.status == 401) { onUnauthorized(); return }
        _codeError.value = CodeError.from(e)
        if (shake) _shakes.value++
    }
}
