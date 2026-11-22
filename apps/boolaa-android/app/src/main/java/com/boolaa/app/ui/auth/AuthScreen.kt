package com.boolaa.app.ui.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BubbleChart
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.boolaa.app.AppContainer
import com.boolaa.app.R
import com.boolaa.app.core.UserFacingError
import com.boolaa.app.ui.BaseViewModel
import com.boolaa.app.ui.ErrorDialogFor
import com.boolaa.app.ui.LocalAppContainer
import com.boolaa.app.ui.components.BoolaaTextField
import com.boolaa.app.ui.components.PrimaryButton
import com.boolaa.app.ui.components.boolaaCard
import com.boolaa.app.ui.theme.Brand
import com.boolaa.app.ui.theme.BoolaaTheme
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

class AuthViewModel(private val container: AppContainer) : BaseViewModel() {
    private val _needsConfirmation = MutableStateFlow(false)
    val needsConfirmation = _needsConfirmation.asStateFlow()

    fun signIn(email: String, password: String) = launchCatching {
        container.session.signIn(email, password)
    }

    fun signUp(name: String, email: String, password: String) = launchCatching {
        if (password.length < 6) { showError(UserFacingError.WEAK_PASSWORD.message); return@launchCatching }
        _needsConfirmation.value = !container.session.signUp(name, email, password)
    }
}

/** Login and register (spec §1). The name is sent as sign-up metadata { name }. */
@Composable
fun AuthScreen() {
    val container = LocalAppContainer.current
    val vm: AuthViewModel = viewModel { AuthViewModel(container) }
    val busy by vm.busy.collectAsStateWithLifecycle()
    val needsConfirmation by vm.needsConfirmation.collectAsStateWithLifecycle()
    var register by rememberSaveable { mutableStateOf(false) }
    var name by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }

    Box(
        Modifier.fillMaxSize().background(BoolaaTheme.colors.background).statusBarsPadding().imePadding().testTag("auth-screen"),
    ) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Box(
                Modifier.padding(top = 40.dp).size(84.dp).clip(CircleShape).background(Brand.purple),
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Filled.BubbleChart, contentDescription = null, tint = Color.White, modifier = Modifier.size(44.dp)) }
            Text(stringResource(R.string.app_name), style = MaterialTheme.typography.displaySmall, color = Brand.purple)
            Text(
                stringResource(R.string.auth_tagline),
                style = MaterialTheme.typography.bodyLarge,
                color = BoolaaTheme.colors.textSecondary,
                textAlign = TextAlign.Center,
            )
            Column(Modifier.boolaaCard(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    stringResource(if (register) R.string.auth_create_account_title else R.string.auth_welcome_back),
                    style = MaterialTheme.typography.titleLarge,
                )
                if (register) {
                    BoolaaTextField(name, { name = it }, stringResource(R.string.name), Modifier.testTag("name"))
                }
                BoolaaTextField(email, { email = it }, stringResource(R.string.email), Modifier.testTag("email"), keyboardType = KeyboardType.Email)
                BoolaaTextField(password, { password = it }, stringResource(R.string.password), Modifier.testTag("password"), isPassword = true)
                if (needsConfirmation && register) {
                    Text(stringResource(R.string.auth_check_email), color = Brand.purple, style = MaterialTheme.typography.bodyMedium)
                }
                PrimaryButton(
                    text = stringResource(if (register) R.string.create_account else R.string.sign_in),
                    onClick = { if (register) vm.signUp(name, email, password) else vm.signIn(email, password) },
                    enabled = email.isNotBlank() && password.isNotBlank() && (!register || name.isNotBlank()),
                    loading = busy,
                    modifier = Modifier.testTag("auth-submit"),
                )
            }
            TextButton(onClick = { register = !register }, modifier = Modifier.fillMaxWidth().testTag("auth-toggle")) {
                Text(
                    stringResource(if (register) R.string.auth_have_account else R.string.auth_no_account),
                    color = Brand.purple,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
    ErrorDialogFor(vm)
}
