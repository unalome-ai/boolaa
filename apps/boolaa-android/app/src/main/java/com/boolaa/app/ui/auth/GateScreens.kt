package com.boolaa.app.ui.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.boolaa.app.AppContainer
import com.boolaa.app.R
import com.boolaa.app.core.UserFacingError
import com.boolaa.app.state.RouteGate
import com.boolaa.app.ui.BaseViewModel
import com.boolaa.app.ui.ErrorDialogFor
import com.boolaa.app.ui.LocalAppContainer
import com.boolaa.app.ui.components.BoolaaTextField
import com.boolaa.app.ui.components.Haptics
import com.boolaa.app.ui.components.PrimaryButton
import com.boolaa.app.ui.components.shake
import com.boolaa.app.ui.profile.DeleteAccountFlow
import com.boolaa.app.ui.safety.LegalAgreementText
import com.boolaa.app.ui.theme.BoolaaTheme
import com.boolaa.app.ui.theme.Type
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

// MARK: Device code ("Check your email")

class DeviceCodeViewModel(private val container: AppContainer) : CodeStepViewModel() {
    override val sentAt: StateFlow<Long?> = container.session.state.map { it.deviceCodeSentAt }
        .stateIn(viewModelScope, SharingStarted.Eagerly, container.session.state.value.deviceCodeSentAt)

    init {
        // Sent once on entry, but not again if one went out less than 60 s ago (§8.2).
        if (RouteGate.shouldAutoSend(container.session.state.value.deviceCodeSentAt, System.currentTimeMillis())) send()
    }

    override suspend fun sendCode() = container.session.sendDeviceCode()
    override suspend fun verifyCode(code: String) = container.session.verifyDeviceCode(code)
    override suspend fun onUnauthorized() = container.session.signOut()
    fun useAnotherAccount() { viewModelScope.launch { container.session.signOut() } }
}

/** Shown after a password sign-in on an unknown device. Nothing from the bubbles loads until the code is right. */
@Composable
fun DeviceCodeScreen() {
    val container = LocalAppContainer.current
    val vm: DeviceCodeViewModel = viewModel { DeviceCodeViewModel(container) }
    val email by container.session.state.collectAsStateWithLifecycle()
    AuthPanelScaffold("device-code-screen") {
        CodeStepHeader(stringResource(R.string.check_your_email), stringResource(R.string.device_code_message, email.email.orEmpty()))
        CodeStepBody(vm, submitLabel = stringResource(R.string.code_verify))
        AuthLink(stringResource(R.string.use_another_account), vm::useAnotherAccount, Modifier.testTag("use-another-account"))
    }
}

/** Boxes, error, resend/paste and the submit button of a code step, with the error shake and haptics. */
@Composable
fun CodeStepBody(
    vm: CodeStepViewModel, submitLabel: String, modifier: Modifier = Modifier, danger: Boolean = false, calm: Boolean = false,
    /** Overrides the submit action (e.g. retry a deletion whose code was already accepted). */
    onSubmit: (() -> Unit)? = null, submitReady: Boolean = false, busy: Boolean = false,
) {
    val code by vm.code.collectAsStateWithLifecycle()
    val error by vm.codeError.collectAsStateWithLifecycle()
    val shakes by vm.shakes.collectAsStateWithLifecycle()
    val sentAt by vm.sentAt.collectAsStateWithLifecycle()
    val sending by vm.sending.collectAsStateWithLifecycle()
    val verifying by vm.verifying.collectAsStateWithLifecycle()
    val successes by vm.successes.collectAsStateWithLifecycle()
    val view = LocalView.current
    LaunchedEffect(error) { if (error != null) Haptics.error(view) }
    LaunchedEffect(successes) { if (successes > 0) Haptics.success(view) }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        CodeField(code, vm::onCodeChange, enabled = !verifying, isError = error != null, shakes = shakes, onDone = vm::submit)
        CodeErrorText(error)
        CodeActions(sentAt, sending, onResend = vm::send, onPaste = vm::onCodeChange)
        PrimaryButton(
            submitLabel, onClick = onSubmit ?: vm::submit, enabled = submitReady || code.length == CODE_LENGTH,
            loading = verifying || sending || busy, danger = danger, calm = calm,
            modifier = Modifier.shake(shakes).testTag("code-submit"),
        )
    }
}

// MARK: Age confirmation (16+ and Terms)

class AgeConfirmViewModel(private val container: AppContainer) : BaseViewModel() {
    fun confirm() = launchCatching { container.session.confirmAge() }
    fun signOut() = launchCatching(trackBusy = false) { container.session.signOut() }
}

/** One-time screen for accounts made without the sign-up checkbox (Google/Apple, invites, older accounts). */
@Composable
fun AgeConfirmScreen() {
    val container = LocalAppContainer.current
    val vm: AgeConfirmViewModel = viewModel { AgeConfirmViewModel(container) }
    val busy by vm.busy.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    var age by rememberSaveable { mutableStateOf(false) }
    var terms by rememberSaveable { mutableStateOf(false) }
    var deleting by rememberSaveable { mutableStateOf(false) }
    var shakes by remember { mutableIntStateOf(0) }
    val view = LocalView.current
    val c = BoolaaTheme.colors
    LaunchedEffect(error) { if (error != null) { shakes++; Haptics.error(view) } }
    AuthPanelScaffold("age-screen") {
        AuthTitle(stringResource(R.string.age_title))
        AuthMessage(stringResource(R.string.age_message))
        CheckRow(age, { age = it }, Modifier.testTag("age-check")) {
            Text(stringResource(R.string.age_confirm), style = Type.body, color = c.textPrimary)
        }
        CheckRow(terms, { terms = it }, Modifier.testTag("terms-check")) {
            LegalAgreementText(template = R.string.legal_accept, centered = false)
        }
        PrimaryButton(
            stringResource(R.string.age_continue), onClick = vm::confirm, enabled = age && terms, loading = busy,
            modifier = Modifier.shake(shakes).testTag("age-submit"),
        )
        AuthLink(stringResource(R.string.use_another_account), { vm.signOut() }, Modifier.testTag("use-another-account"))
        AuthLink(stringResource(R.string.delete_account), { deleting = true }, Modifier.testTag("age-delete-account"), danger = true)
    }
    if (deleting) DeleteAccountFlow(onDismiss = { deleting = false }, onDeleted = { deleting = false })
    ErrorDialogFor(vm)
}

// MARK: New password after a reset code

class ResetPasswordViewModel(private val container: AppContainer) : BaseViewModel() {
    fun save(password: String) = launchCatching {
        if (password.length < 6) { showError(UserFacingError.WEAK_PASSWORD.message); return@launchCatching }
        container.session.finishPasswordReset(password)
    }
    fun cancel() = launchCatching(trackBusy = false) { container.session.signOut() }
}

@Composable
fun ResetPasswordScreen() {
    val container = LocalAppContainer.current
    val vm: ResetPasswordViewModel = viewModel { ResetPasswordViewModel(container) }
    val busy by vm.busy.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    var password by rememberSaveable { mutableStateOf("") }
    var repeat by rememberSaveable { mutableStateOf("") }
    var shakes by remember { mutableIntStateOf(0) }
    val view = LocalView.current
    LaunchedEffect(error) { if (error != null) { shakes++; Haptics.error(view) } }
    val mismatch = repeat.isNotEmpty() && repeat != password
    AuthPanelScaffold("reset-password-screen") {
        AuthTitle(stringResource(R.string.new_password_title))
        AuthMessage(stringResource(R.string.new_password_message))
        BoolaaTextField(password, { password = it }, stringResource(R.string.new_password), Modifier.testTag("new-password"), isPassword = true)
        BoolaaTextField(repeat, { repeat = it }, stringResource(R.string.repeat_password), Modifier.testTag("repeat-password"), isPassword = true)
        if (mismatch) Text(stringResource(R.string.passwords_dont_match), style = Type.subheadline, color = BoolaaTheme.colors.dangerText)
        PrimaryButton(
            stringResource(R.string.save_password), onClick = { vm.save(password) },
            enabled = password.length >= 6 && password == repeat, loading = busy,
            modifier = Modifier.shake(shakes).testTag("save-password"),
        )
        AuthLink(stringResource(R.string.cancel), { vm.cancel() }, Modifier.testTag("reset-cancel"))
    }
    ErrorDialogFor(vm)
}
