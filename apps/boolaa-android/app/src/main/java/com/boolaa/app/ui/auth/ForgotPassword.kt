package com.boolaa.app.ui.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.boolaa.app.AppContainer
import com.boolaa.app.R
import com.boolaa.app.ui.LocalAppContainer
import com.boolaa.app.ui.components.BoolaaTextField
import com.boolaa.app.ui.components.Haptics
import com.boolaa.app.ui.components.PrimaryButton
import com.boolaa.app.ui.components.shake
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

/** "Forgot password?": email, then the 6-digit recovery code. A right code signs in and the new password screen follows. */
class ForgotPasswordViewModel(private val container: AppContainer) : CodeStepViewModel() {
    private val _email = MutableStateFlow("")
    val email = _email.asStateFlow()

    fun onEmailChange(value: String) { _email.value = value }
    override suspend fun sendCode() = container.session.sendPasswordReset(_email.value)
    override suspend fun verifyCode(code: String) = container.session.verifyPasswordReset(_email.value, code)
    fun editEmail() = resetSent()
}

/** Replaces the sign-in form inside the auth panel. */
@Composable
fun ForgotPasswordPanel(onBackToSignIn: () -> Unit, initialEmail: String) {
    val container = LocalAppContainer.current
    val vm: ForgotPasswordViewModel = viewModel(key = "forgot") { ForgotPasswordViewModel(container).also { it.onEmailChange(initialEmail) } }
    val email by vm.email.collectAsStateWithLifecycle()
    val sentAt by vm.sentAt.collectAsStateWithLifecycle()
    val sending by vm.sending.collectAsStateWithLifecycle()
    val error by vm.codeError.collectAsStateWithLifecycle()
    val shakes by vm.shakes.collectAsStateWithLifecycle()
    val view = LocalView.current

    Column(Modifier.fillMaxWidth().testTag("forgot-panel"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (sentAt == null) {
            LaunchedEffect(error) { if (error != null) Haptics.error(view) }
            CodeStepHeader(stringResource(R.string.forgot_title), stringResource(R.string.forgot_message))
            BoolaaTextField(email, vm::onEmailChange, stringResource(R.string.email), Modifier.testTag("forgot-email"), keyboardType = KeyboardType.Email)
            CodeErrorText(error)
            PrimaryButton(
                stringResource(R.string.send_code), onClick = vm::send, enabled = email.isNotBlank(), loading = sending,
                modifier = Modifier.shake(shakes).testTag("forgot-send"),
            )
        } else {
            // Always this wording: Auth answers the same whether or not the account exists.
            CodeStepHeader(stringResource(R.string.check_your_email), stringResource(R.string.forgot_sent, email.trim()))
            CodeStepBody(vm, submitLabel = stringResource(R.string.code_verify))
            AuthLink(stringResource(R.string.change_email_address), vm::editEmail, Modifier.testTag("forgot-edit-email"))
        }
        AuthLink(stringResource(R.string.back_to_sign_in), onBackToSignIn, Modifier.testTag("forgot-back"))
    }
}
