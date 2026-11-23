package com.boolaa.app.ui.profile

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Devices
import androidx.compose.material.icons.rounded.Key
import androidx.compose.material.icons.rounded.Mail
import androidx.compose.material.icons.rounded.Smartphone
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.os.ConfigurationCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.boolaa.app.AppContainer
import com.boolaa.app.R
import com.boolaa.app.core.Formats
import com.boolaa.app.core.SensitiveAction
import com.boolaa.app.core.TrustedDevice
import com.boolaa.app.ui.BaseViewModel
import com.boolaa.app.ui.ErrorDialogFor
import com.boolaa.app.ui.LocalAppContainer
import com.boolaa.app.ui.auth.CodeErrorText
import com.boolaa.app.ui.auth.CodeStepBody
import com.boolaa.app.ui.auth.CodeStepViewModel
import com.boolaa.app.ui.components.BoolaaSheet
import com.boolaa.app.ui.components.BoolaaTextField
import com.boolaa.app.ui.components.ConfirmDialog
import com.boolaa.app.ui.components.Haptics
import com.boolaa.app.ui.components.PrimaryButton
import com.boolaa.app.ui.components.SectionHeader
import com.boolaa.app.ui.components.StatusBadge
import com.boolaa.app.ui.components.boolaaCard
import com.boolaa.app.ui.settings.SettingsRow
import com.boolaa.app.ui.theme.BoolaaTheme
import com.boolaa.app.ui.theme.Hue
import com.boolaa.app.ui.theme.Radius
import com.boolaa.app.ui.theme.Type
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.Locale

// MARK: Your devices

class DevicesViewModel(private val container: AppContainer) : BaseViewModel() {
    private val _devices = MutableStateFlow<List<TrustedDevice>?>(null)
    val devices = _devices.asStateFlow()
    val thisDevice: String get() = container.device.hash

    init { load() }

    fun load() = launchCatching(trackBusy = false) { _devices.value = container.session.devices() }

    fun revoke(hash: String) = launchCatching {
        container.session.revokeDevice(hash)
        _devices.value = container.session.devices()
    }
}

/** Security in the profile sheet: change password, change email, your devices. Calm surfaces, no bounce. */
@Composable
fun SecuritySection() {
    var changingPassword by rememberSaveable { mutableStateOf(false) }
    var changingEmail by rememberSaveable { mutableStateOf(false) }
    SectionHeader(stringResource(R.string.security))
    SettingsRow(Icons.Rounded.Key, Hue.indigo, stringResource(R.string.change_password), null, { changingPassword = true }, Modifier.testTag("change-password"))
    SettingsRow(Icons.Rounded.Mail, Hue.sky, stringResource(R.string.change_email), null, { changingEmail = true }, Modifier.testTag("change-email"))
    YourDevices()
    if (changingPassword) ChangePasswordSheet(onDismiss = { changingPassword = false })
    if (changingEmail) ChangeEmailSheet(onDismiss = { changingEmail = false })
}

@Composable
private fun YourDevices() {
    val container = LocalAppContainer.current
    val vm: DevicesViewModel = viewModel(key = "devices") { DevicesViewModel(container) }
    val devices by vm.devices.collectAsStateWithLifecycle()
    var revoking by rememberSaveable { mutableStateOf<String?>(null) }
    val c = BoolaaTheme.colors
    val locale = ConfigurationCompat.getLocales(LocalConfiguration.current)[0] ?: Locale.ENGLISH
    SectionHeader(stringResource(R.string.your_devices), devices?.size)
    Column(Modifier.boolaaCard().testTag("your-devices")) {
        val list = devices
        if (list == null) {
            Text(stringResource(R.string.loading), style = Type.subheadline, color = c.textSecondary)
        } else if (list.isEmpty()) {
            Text(stringResource(R.string.your_devices_empty), style = Type.subheadline, color = c.textSecondary)
        }
        // The current device first, then most recently seen.
        val sorted = list.orEmpty().sortedByDescending { it.deviceHash == vm.thisDevice }
        sorted.forEachIndexed { i, d ->
            DeviceRow(d, isThis = d.deviceHash == vm.thisDevice, locale = locale, onRevoke = { revoking = d.deviceHash })
            if (i < sorted.lastIndex) HorizontalDivider(color = c.hairline)
        }
    }
    Text(stringResource(R.string.your_devices_hint), style = Type.caption2, color = c.textSecondary, modifier = Modifier.padding(horizontal = 4.dp))
    revoking?.let { hash ->
        ConfirmDialog(
            title = stringResource(R.string.revoke_device_title),
            message = stringResource(R.string.revoke_device_message),
            confirm = stringResource(R.string.revoke_device),
            onConfirm = { vm.revoke(hash) },
            onDismiss = { revoking = null },
        )
    }
    ErrorDialogFor(vm)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DeviceRow(device: TrustedDevice, isThis: Boolean, locale: Locale, onRevoke: () -> Unit) {
    val c = BoolaaTheme.colors
    val name = device.label?.takeIf { it.isNotBlank() } ?: stringResource(R.string.unknown_device)
    val seen = device.lastSeenAt?.let { stringResource(R.string.device_last_active, Formats.relative(it, locale)) }
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(vertical = 6.dp).testTag(if (isThis) "device-this" else "device-${device.deviceHash.take(12)}"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(if (isThis) Icons.Rounded.Smartphone else Icons.Rounded.Devices, contentDescription = null, tint = Hue.indigo.text,
            modifier = Modifier.size(34.dp).clip(RoundedCornerShape(Radius.small)).background(Hue.indigo.wash).padding(7.dp))
        Column(Modifier.padding(start = 12.dp).weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(name, style = Type.bodyStrong, color = c.textPrimary)
                if (isThis) StatusBadge(stringResource(R.string.this_device), hue = Hue.mint, modifier = Modifier.align(Alignment.CenterVertically))
            }
            if (seen != null) Text(seen, style = Type.subheadline, color = c.textSecondary)
        }
        // The current device can't be revoked from itself (sign out instead).
        if (!isThis) {
            TextButton(onClick = onRevoke, modifier = Modifier.heightIn(min = 48.dp).testTag("revoke-device").semantics {
                contentDescription = name
            }) {
                Text(stringResource(R.string.revoke_device), style = Type.chip, color = c.dangerText)
            }
        }
    }
}

// MARK: Change password (change_password code -> verify -> updateUser({ password }))

class ChangePasswordViewModel(private val container: AppContainer) : CodeStepViewModel() {
    var newPassword: String = ""
    private val _done = MutableStateFlow(false)
    val done = _done.asStateFlow()
    private var proven = false
    override suspend fun sendCode() = container.session.requestPasswordChangeCode()
    override suspend fun verifyCode(code: String) {
        if (!proven) { container.session.verifySensitiveActionCode(code); proven = true }
        container.session.changePassword(newPassword)
        _done.value = true
    }
    fun restart() { proven = false; resetSent() }
}

@Composable
private fun ChangePasswordSheet(onDismiss: () -> Unit) {
    val container = LocalAppContainer.current
    val vm: ChangePasswordViewModel = viewModel(key = "change-password") { ChangePasswordViewModel(container) }
    val sentAt by vm.sentAt.collectAsStateWithLifecycle()
    val sending by vm.sending.collectAsStateWithLifecycle()
    val error by vm.codeError.collectAsStateWithLifecycle()
    val done by vm.done.collectAsStateWithLifecycle()
    var password by rememberSaveable { mutableStateOf("") }
    var repeat by rememberSaveable { mutableStateOf("") }
    val accountEmail = accountEmail()
    val c = BoolaaTheme.colors
    BoolaaSheet(onDismiss, stringResource(R.string.change_password), tag = "change-password-sheet") {
        when {
            done -> {
                SuccessNote(stringResource(R.string.password_changed))
                PrimaryButton(stringResource(R.string.done), onClick = onDismiss, calm = true, modifier = Modifier.testTag("change-password-done"))
            }
            sentAt == null -> {
                Text(stringResource(R.string.change_password_message), style = Type.body, color = c.textSecondary)
                BoolaaTextField(password, { password = it }, stringResource(R.string.new_password), Modifier.testTag("new-password"), isPassword = true)
                BoolaaTextField(repeat, { repeat = it }, stringResource(R.string.repeat_password), Modifier.testTag("repeat-password"), isPassword = true)
                if (repeat.isNotEmpty() && repeat != password) Text(stringResource(R.string.passwords_dont_match), style = Type.subheadline, color = c.dangerText)
                if (password.isNotEmpty() && password.length < 6) Text(stringResource(R.string.error_weak_password), style = Type.subheadline, color = c.textSecondary)
                CodeErrorText(error)
                PrimaryButton(
                    stringResource(R.string.send_code), onClick = { vm.newPassword = password; vm.send() },
                    enabled = password.length >= 6 && password == repeat, loading = sending, calm = true,
                    modifier = Modifier.testTag("change-password-send"),
                )
            }
            else -> {
                Text(stringResource(R.string.code_sent_to, accountEmail), style = Type.body, color = c.textSecondary)
                CodeStepBody(vm, submitLabel = stringResource(R.string.change_password), calm = true)
            }
        }
    }
}

// MARK: Change email (sensitive_action code first, then updateUser({ email }))

class ChangeEmailViewModel(private val container: AppContainer) : CodeStepViewModel() {
    var newEmail: String = ""
    private val _done = MutableStateFlow(false)
    val done = _done.asStateFlow()
    private var proven = false
    override suspend fun sendCode() = container.session.sendSensitiveActionCode(SensitiveAction.CHANGE_EMAIL)
    override suspend fun verifyCode(code: String) {
        if (!proven) { container.session.verifySensitiveActionCode(code); proven = true }
        container.session.changeEmail(newEmail)
        _done.value = true
    }
}

@Composable
private fun ChangeEmailSheet(onDismiss: () -> Unit) {
    val container = LocalAppContainer.current
    val vm: ChangeEmailViewModel = viewModel(key = "change-email") { ChangeEmailViewModel(container) }
    val sentAt by vm.sentAt.collectAsStateWithLifecycle()
    val sending by vm.sending.collectAsStateWithLifecycle()
    val error by vm.codeError.collectAsStateWithLifecycle()
    val done by vm.done.collectAsStateWithLifecycle()
    var email by rememberSaveable { mutableStateOf("") }
    val current = accountEmail()
    val c = BoolaaTheme.colors
    BoolaaSheet(onDismiss, stringResource(R.string.change_email), tag = "change-email-sheet") {
        when {
            done -> {
                SuccessNote(stringResource(R.string.change_email_done, current, email.trim()))
                PrimaryButton(stringResource(R.string.done), onClick = onDismiss, calm = true, modifier = Modifier.testTag("change-email-done"))
            }
            sentAt == null -> {
                Text(stringResource(R.string.change_email_message), style = Type.body, color = c.textSecondary)
                BoolaaTextField(email, { email = it }, stringResource(R.string.new_email), Modifier.testTag("new-email"), keyboardType = KeyboardType.Email)
                CodeErrorText(error)
                PrimaryButton(
                    stringResource(R.string.send_code), onClick = { vm.newEmail = email; vm.send() },
                    enabled = email.contains('@') && !email.trim().equals(current, ignoreCase = true), loading = sending, calm = true,
                    modifier = Modifier.testTag("change-email-send"),
                )
            }
            else -> {
                Text(stringResource(R.string.code_sent_to, current), style = Type.body, color = c.textSecondary)
                CodeStepBody(vm, submitLabel = stringResource(R.string.change_email), calm = true)
            }
        }
    }
}

@Composable
internal fun accountEmail(): String {
    val state by LocalAppContainer.current.session.state.collectAsStateWithLifecycle()
    return state.email.orEmpty()
}

@Composable
internal fun SuccessNote(text: String) {
    val view = LocalView.current
    LaunchedEffect(Unit) { Haptics.success(view) }
    Text(
        text, color = Hue.mint.text, style = Type.subheadline, textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(Radius.field)).background(Hue.mint.wash).padding(12.dp).testTag("success-note"),
    )
}

// MARK: Delete account (warning + typed word -> sensitive_action code -> delete)

class DeleteAccountViewModel(private val container: AppContainer) : CodeStepViewModel() {
    private val _proven = MutableStateFlow(false)
    /** The code was accepted; only the deletion itself is left (retry without a new code within 10 minutes). */
    val proven = _proven.asStateFlow()
    private val _deleting = MutableStateFlow(false)
    val deleting = _deleting.asStateFlow()
    var onDeleted: () -> Unit = {}

    override suspend fun sendCode() = container.session.sendSensitiveActionCode(SensitiveAction.DELETE_ACCOUNT)
    override suspend fun verifyCode(code: String) {
        if (!_proven.value) { container.session.verifySensitiveActionCode(code); _proven.value = true }
        delete()
    }

    private suspend fun delete() {
        _deleting.value = true
        try {
            container.session.deleteAccount()
            onDeleted()
        } finally {
            _deleting.value = false
        }
    }

    fun retryDelete() = launchCatching(trackBusy = false) { delete() }
}

/**
 * Account deletion (App Store 5.1.1(v), docs/auth-security.md §2): can't-undo warning and a typed confirmation word,
 * then an emailed `sensitive_action` code, then storage cleanup, `delete_my_account()` and a local sign-out.
 * A safety surface: flat, still, danger only.
 * Calm surface: no mascot draws inside it (design-system.md §8.4).
 */
@Composable
fun DeleteAccountFlow(onDismiss: () -> Unit, onDeleted: () -> Unit) = com.boolaa.app.ui.components.CalmSurface { DeleteAccountFlowContent(onDismiss, onDeleted) }

@Composable
private fun DeleteAccountFlowContent(onDismiss: () -> Unit, onDeleted: () -> Unit) {
    val container = LocalAppContainer.current
    val vm: DeleteAccountViewModel = viewModel(key = "delete-account") { DeleteAccountViewModel(container) }
    vm.onDeleted = onDeleted
    val sentAt by vm.sentAt.collectAsStateWithLifecycle()
    val sending by vm.sending.collectAsStateWithLifecycle()
    val proven by vm.proven.collectAsStateWithLifecycle()
    val deleting by vm.deleting.collectAsStateWithLifecycle()
    val error by vm.codeError.collectAsStateWithLifecycle()
    val word = stringResource(R.string.delete_account_confirm_word)
    var typed by rememberSaveable { mutableStateOf("") }
    val matches = typed.trim().equals(word, ignoreCase = true)
    val accountEmail = accountEmail()
    val c = BoolaaTheme.colors
    BoolaaSheet({ if (!deleting) onDismiss() }, stringResource(R.string.delete_account), tag = "delete-account-sheet") {
        if (sentAt == null && !proven) {
            Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(com.boolaa.app.ui.components.BoolaaIcons.Warning, contentDescription = null, tint = c.dangerText, modifier = Modifier.size(22.dp))
                Text(stringResource(R.string.delete_account_warning), style = Type.body, color = c.textPrimary)
            }
            BoolaaTextField(typed, { typed = it }, stringResource(R.string.delete_account_type_to_confirm, word), Modifier.testTag("delete-confirm-input"))
            CodeErrorText(error)
            PrimaryButton(
                stringResource(R.string.delete_account_send_code), onClick = vm::send, enabled = matches, loading = sending, danger = true,
                modifier = Modifier.testTag("delete-confirm"),
            )
        } else {
            Text(stringResource(R.string.delete_account_code_message, accountEmail), style = Type.body, color = c.textSecondary)
            CodeStepBody(
                vm, submitLabel = stringResource(R.string.delete_account_forever), danger = true,
                onSubmit = if (proven) ({ vm.retryDelete() }) else null, submitReady = proven, busy = deleting,
            )
        }
        TextButton(onClick = onDismiss, enabled = !deleting, modifier = Modifier.align(Alignment.CenterHorizontally).heightIn(min = 48.dp)) {
            Text(stringResource(R.string.cancel), style = Type.headline, color = Hue.grape.text)
        }
    }
    ErrorDialogFor(vm)
}
