package com.boolaa.app.ui.profile

import android.content.ContentResolver
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.boolaa.app.AppContainer
import com.boolaa.app.R
import com.boolaa.app.core.ImageBucket
import com.boolaa.app.state.LocaleManager
import com.boolaa.app.ui.BaseViewModel
import com.boolaa.app.ui.ErrorDialogFor
import com.boolaa.app.ui.LocalAppContainer
import com.boolaa.app.ui.components.Avatar
import com.boolaa.app.ui.components.BoolaaTextField
import com.boolaa.app.ui.components.PrimaryButton
import com.boolaa.app.ui.components.SecondaryButton
import com.boolaa.app.ui.components.SectionHeader
import com.boolaa.app.ui.components.displayName
import com.boolaa.app.core.Legal
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.TextButton
import androidx.compose.ui.platform.LocalConfiguration
import androidx.core.os.ConfigurationCompat
import java.util.Locale
import com.boolaa.app.ui.components.boolaaCard
import com.boolaa.app.ui.components.clickableRipple
import com.boolaa.app.ui.components.uploadPicked
import com.boolaa.app.ui.theme.Brand
import com.boolaa.app.ui.theme.BoolaaTheme

class ProfileViewModel(private val container: AppContainer) : BaseViewModel() {
    fun saveName(name: String) = launchCatching { container.session.updateProfile(name = name.trim()) }

    fun uploadAvatar(uri: Uri, resolver: ContentResolver) = launchCatching {
        val url = uploadPicked(container, resolver, uri, ImageBucket.AVATARS)
        container.session.updateProfile(avatar = url)
    }

    fun signOut() = launchCatching { container.session.signOut() }
    fun unblock(userId: String) = launchCatching(trackBusy = false) { container.session.unblock(userId) }
    fun deleteAccount(onDone: () -> Unit) = launchCatching(onSuccess = onDone) { container.session.deleteAccount() }
}

/** Language names are shown in their own language (docs/i18n-glossary.md). */
val languageNames = mapOf(
    "en" to R.string.lang_en, "ro" to R.string.lang_ro, "fr" to R.string.lang_fr, "es" to R.string.lang_es, "it" to R.string.lang_it,
)

/** Profile sheet (spec §12): avatar upload, editable name, read-only email, language, sign out. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileSheet(onDismiss: () -> Unit) {
    val container = LocalAppContainer.current
    val state by container.session.state.collectAsStateWithLifecycle()
    val vm: ProfileViewModel = viewModel(key = "profile") { ProfileViewModel(container) }
    val busy by vm.busy.collectAsStateWithLifecycle()
    val resolver = LocalContext.current.contentResolver
    var name by rememberSaveable(state.profile?.name) { mutableStateOf(state.profile?.name.orEmpty()) }
    var language by rememberSaveable { mutableStateOf(LocaleManager.current()) }
    var deleting by rememberSaveable { mutableStateOf(false) }
    val context = LocalContext.current
    val locale = ConfigurationCompat.getLocales(LocalConfiguration.current)[0] ?: Locale.ENGLISH
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) vm.uploadAvatar(uri, resolver)
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = BoolaaTheme.colors.background) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).imePadding().padding(horizontal = 20.dp).padding(bottom = 32.dp)
                .testTag("profile-sheet"),
            verticalArrangement = Arrangement.spacedBy(14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(stringResource(R.string.profile), style = MaterialTheme.typography.titleLarge, modifier = Modifier.fillMaxWidth())
            // The camera badge sits outside the avatar's circle, so only the avatar itself is clipped.
            Box(Modifier.testTag("avatar-button")) {
                Avatar(state.profile, 96.dp, Modifier.clip(CircleShape).clickableRipple {
                    picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                })
                Box(Modifier.align(Alignment.BottomEnd).size(30.dp).clip(CircleShape).background(Brand.purple), contentAlignment = Alignment.Center) {
                    if (busy) CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
                    else Icon(Icons.Default.CameraAlt, contentDescription = stringResource(R.string.change_photo), tint = Color.White, modifier = Modifier.size(16.dp))
                }
            }
            Column(Modifier.boolaaCard(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                BoolaaTextField(name, { name = it }, stringResource(R.string.name), Modifier.testTag("profile-name"))
                BoolaaTextField(state.email.orEmpty(), {}, stringResource(R.string.email), enabled = false)
                PrimaryButton(stringResource(R.string.save), onClick = { vm.saveName(name) },
                    enabled = name.isNotBlank() && name.trim() != state.profile?.name)
            }
            SectionHeader(stringResource(R.string.language), modifier = Modifier.fillMaxWidth())
            Column(Modifier.boolaaCard(4.dp).testTag("language-picker")) {
                LanguageRow(stringResource(R.string.language_system), selected = language == null) { language = null; LocaleManager.set(null) }
                LocaleManager.supported.forEach { tag ->
                    LanguageRow(stringResource(languageNames.getValue(tag)), selected = language == tag, tag = tag) {
                        language = tag; LocaleManager.set(tag)
                    }
                }
            }
            SectionHeader(stringResource(R.string.blocked_users), state.blocks.size, modifier = Modifier.fillMaxWidth())
            Column(Modifier.boolaaCard().testTag("blocked-users")) {
                if (state.blocks.isEmpty()) Text(stringResource(R.string.blocked_users_empty), color = BoolaaTheme.colors.textSecondary)
                state.blocks.forEachIndexed { i, b ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Avatar(b.blocked, 32.dp)
                        Text(displayName(b.blocked), modifier = Modifier.padding(start = 10.dp).weight(1f))
                        TextButton(onClick = { vm.unblock(b.blockedId) }, modifier = Modifier.testTag("unblock-${displayName(b.blocked)}")) {
                            Text(stringResource(R.string.unblock), color = Brand.purple)
                        }
                    }
                    if (i < state.blocks.lastIndex) HorizontalDivider(color = BoolaaTheme.colors.divider)
                }
            }
            SectionHeader(stringResource(R.string.legal), modifier = Modifier.fillMaxWidth())
            Column(Modifier.boolaaCard(4.dp)) {
                LegalRow(stringResource(R.string.privacy_policy), "legal-privacy") { Legal.open(context, Legal.Page.PRIVACY, locale) }
                LegalRow(stringResource(R.string.terms_of_use), "legal-terms") { Legal.open(context, Legal.Page.TERMS, locale) }
            }
            SecondaryButton(stringResource(R.string.sign_out), onClick = { onDismiss(); vm.signOut() }, color = Brand.danger,
                modifier = Modifier.fillMaxWidth().testTag("sign-out"))
            TextButton(onClick = { deleting = true }, modifier = Modifier.testTag("delete-account")) {
                Text(stringResource(R.string.delete_account), color = Brand.danger)
            }
        }
    }
    if (deleting) DeleteAccountDialog(busy = busy, onConfirm = { vm.deleteAccount(onDismiss) }, onDismiss = { deleting = false })
    ErrorDialogFor(vm)
}

@Composable
private fun LegalRow(label: String, tag: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(MaterialTheme.shapes.medium).clickableRipple(onClick).padding(12.dp).testTag(tag),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = null, tint = BoolaaTheme.colors.textSecondary, modifier = Modifier.size(18.dp))
    }
}

/** Account deletion (App Store 5.1.1(v)): can't-undo warning plus a typed confirmation word. */
@Composable
private fun DeleteAccountDialog(busy: Boolean, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    val word = stringResource(R.string.delete_account_confirm_word)
    var typed by rememberSaveable { mutableStateOf("") }
    val matches = typed.trim().equals(word, ignoreCase = true)
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        icon = { Icon(Icons.Default.Warning, contentDescription = null, tint = Brand.danger) },
        title = { Text(stringResource(R.string.delete_account)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(stringResource(R.string.delete_account_warning))
                BoolaaTextField(typed, { typed = it }, stringResource(R.string.delete_account_type_to_confirm, word),
                    Modifier.testTag("delete-confirm-input"))
            }
        },
        confirmButton = {
            TextButton(onClick = onConfirm, enabled = matches && !busy, modifier = Modifier.testTag("delete-confirm")) {
                if (busy) CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
                else Text(stringResource(R.string.delete_account_forever), color = if (matches) Brand.danger else BoolaaTheme.colors.textSecondary)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text(stringResource(R.string.cancel)) } },
    )
}

@Composable
private fun LanguageRow(label: String, selected: Boolean, tag: String = "system", onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(MaterialTheme.shapes.medium).clickableRipple(onClick).padding(horizontal = 12.dp, vertical = 12.dp)
            .testTag("language-$tag"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        if (selected) Icon(Icons.Default.Check, contentDescription = null, tint = Brand.purple)
    }
}
