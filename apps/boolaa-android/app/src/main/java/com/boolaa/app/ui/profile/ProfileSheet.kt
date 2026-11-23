package com.boolaa.app.ui.profile

import android.content.ContentResolver
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.boolaa.app.AppContainer
import com.boolaa.app.R
import com.boolaa.app.core.ImageBucket
import com.boolaa.app.state.LocaleManager
import com.boolaa.app.ui.BaseViewModel
import com.boolaa.app.ui.ErrorDialogFor
import com.boolaa.app.ui.LocalAppContainer
import com.boolaa.app.core.Legal
import androidx.core.os.ConfigurationCompat
import java.util.Locale
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed as gridItemsIndexed
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.boolaa.app.ui.components.AddButton
import com.boolaa.app.ui.components.Avatar
import com.boolaa.app.ui.components.BoolaaChip
import com.boolaa.app.ui.components.BoolaaIcons
import com.boolaa.app.ui.components.BoolaaRefreshBox
import com.boolaa.app.ui.components.BoolaaSheet
import com.boolaa.app.ui.components.BoolaaTextField
import com.boolaa.app.ui.components.BubbleOrb
import com.boolaa.app.ui.components.CircleIconButton
import com.boolaa.app.ui.components.ConfettiOverlay
import com.boolaa.app.ui.components.ConfettiState
import com.boolaa.app.ui.components.ConfirmDialog
import com.boolaa.app.ui.components.FeatureBadge
import com.boolaa.app.ui.components.FitText
import com.boolaa.app.ui.components.Haptics
import com.boolaa.app.ui.components.HintCard
import com.boolaa.app.ui.components.ItemMenu
import com.boolaa.app.ui.components.MorphIcon
import com.boolaa.app.ui.components.PhotoField
import com.boolaa.app.ui.components.PrimaryButton
import com.boolaa.app.ui.components.PushedHeader
import com.boolaa.app.ui.components.RemoteImage
import com.boolaa.app.ui.components.RollingCount
import com.boolaa.app.ui.components.SecondaryButton
import com.boolaa.app.ui.components.SectionHeader
import com.boolaa.app.ui.components.SegmentedPill
import com.boolaa.app.ui.components.SkeletonList
import com.boolaa.app.ui.components.SkeletonTile
import com.boolaa.app.ui.components.StatusBadge
import com.boolaa.app.ui.components.boolaaCard
import com.boolaa.app.ui.components.bounceOn
import com.boolaa.app.ui.components.clickableRipple
import com.boolaa.app.ui.components.dashedBorder
import com.boolaa.app.ui.components.displayName
import com.boolaa.app.ui.components.dockClearance
import com.boolaa.app.ui.components.glow
import com.boolaa.app.ui.components.popIn
import com.boolaa.app.ui.components.scrollFade
import com.boolaa.app.ui.components.uploadPicked
import com.boolaa.app.ui.theme.BoolaaTheme
import com.boolaa.app.ui.theme.Brand
import com.boolaa.app.ui.theme.Display
import com.boolaa.app.ui.theme.Feature
import com.boolaa.app.ui.theme.Hue
import com.boolaa.app.ui.theme.Motion
import com.boolaa.app.ui.theme.Radius
import com.boolaa.app.ui.theme.Type
import com.boolaa.app.ui.settings.SettingsRow

class ProfileViewModel(private val container: AppContainer) : BaseViewModel() {
    fun saveName(name: String) = launchCatching { container.session.updateProfile(name = name.trim()) }

    fun uploadAvatar(uri: Uri, resolver: ContentResolver) = launchCatching {
        val url = uploadPicked(container, resolver, uri, ImageBucket.AVATARS)
        container.session.updateProfile(avatar = url)
    }

    fun signOut() = launchCatching { container.session.signOut() }
    fun unblock(userId: String) = launchCatching(trackBusy = false) { container.session.unblock(userId) }

    /** Auth emails follow user_metadata.locale (docs/auth-security.md §5); "System" sends the effective language. */
    fun setLanguage(tag: String?) {
        LocaleManager.set(tag)
        launchCatching(trackBusy = false) { container.session.updateLocale(tag ?: LocaleManager.effective()) }
    }
}

/** Language names are shown in their own language (docs/i18n-glossary.md). */
val languageNames = mapOf(
    "en" to R.string.lang_en, "ro" to R.string.lang_ro, "fr" to R.string.lang_fr, "es" to R.string.lang_es, "it" to R.string.lang_it,
)

/**
 * Profile sheet (spec §12): avatar upload, editable name, read-only email, language, sign out.
 * The blocked list and account deletion below are safety surfaces: flat, still, no gradients.
 */
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
    var exporting by rememberSaveable { mutableStateOf(false) }
    val context = LocalContext.current
    val view = LocalView.current
    val c = BoolaaTheme.colors
    val locale = ConfigurationCompat.getLocales(LocalConfiguration.current)[0] ?: Locale.ENGLISH
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) vm.uploadAvatar(uri, resolver)
    }

    BoolaaSheet(onDismiss, stringResource(R.string.profile), tag = "profile-sheet") {
        // The camera badge sits outside the avatar's circle, so only the avatar itself is clipped.
        Box(Modifier.align(Alignment.CenterHorizontally).popIn().testTag("avatar-button")) {
            val changePhoto = stringResource(R.string.change_photo)
            Avatar(state.profile, 112.dp, Modifier.clip(CircleShape).clickableRipple(role = Role.Button) {
                picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            }.semantics { contentDescription = changePhoto }, rainbow = true)
            Box(
                Modifier.align(Alignment.BottomEnd).size(38.dp).clip(CircleShape).background(c.background).padding(2.dp)
                    .clip(CircleShape).background(Hue.grape.gradient),
                contentAlignment = Alignment.Center,
            ) {
                if (busy) CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
                else Icon(BoolaaIcons.Camera, contentDescription = null, tint = Color.White, modifier = Modifier.size(18.dp))
            }
        }
        BoolaaTextField(name, { name = it }, stringResource(R.string.name), Modifier.testTag("profile-name"))
        BoolaaTextField(state.email.orEmpty(), {}, stringResource(R.string.email), enabled = false)
        PrimaryButton(stringResource(R.string.save), onClick = { vm.saveName(name) },
            enabled = name.isNotBlank() && name.trim() != state.profile?.name)

        SectionHeader(stringResource(R.string.language))
        Column(Modifier.boolaaCard(6.dp).selectableGroup().testTag("language-picker")) {
            LanguageRow(stringResource(R.string.language_system), selected = language == null) { Haptics.selection(view); language = null; vm.setLanguage(null) }
            LocaleManager.supported.forEach { tag ->
                LanguageRow(stringResource(languageNames.getValue(tag)), selected = language == tag, tag = tag) {
                    Haptics.selection(view); language = tag; vm.setLanguage(tag)
                }
            }
        }

        SecuritySection()

        SectionHeader(stringResource(R.string.blocked_users), state.blocks.size)
        Column(Modifier.boolaaCard().testTag("blocked-users")) {
            if (state.blocks.isEmpty()) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Icon(BoolaaIcons.Blocked, contentDescription = null, tint = c.textSecondary, modifier = Modifier.size(20.dp))
                    Text(stringResource(R.string.blocked_users_empty), style = Type.subheadline, color = c.textSecondary)
                }
            }
            state.blocks.forEachIndexed { i, b ->
                Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Avatar(b.blocked, 36.dp)
                    Text(displayName(b.blocked), style = Type.bodyStrong, color = c.textPrimary, modifier = Modifier.padding(start = 10.dp).weight(1f))
                    TextButton(onClick = { vm.unblock(b.blockedId) }, modifier = Modifier.testTag("unblock-${displayName(b.blocked)}")) {
                        Text(stringResource(R.string.unblock), style = Type.chip, color = Hue.grape.text)
                    }
                }
                if (i < state.blocks.lastIndex) HorizontalDivider(color = c.hairline)
            }
        }

        SectionHeader(stringResource(R.string.legal))
        SettingsRow(BoolaaIcons.Privacy, Hue.mint, stringResource(R.string.privacy_policy), BoolaaIcons.Open,
            { Legal.open(context, Legal.Page.PRIVACY, locale) }, Modifier.testTag("legal-privacy"))
        SettingsRow(BoolaaIcons.Terms, Hue.sunny, stringResource(R.string.terms_of_use), BoolaaIcons.Open,
            { Legal.open(context, Legal.Page.TERMS, locale) }, Modifier.testTag("legal-terms"))

        SecondaryButton(stringResource(R.string.sign_out), onClick = { onDismiss(); vm.signOut() },
            modifier = Modifier.fillMaxWidth().padding(top = 6.dp).testTag("sign-out"))
        TextButton(onClick = { exporting = true }, modifier = Modifier.align(Alignment.CenterHorizontally).testTag("export-data")) {
            Icon(Icons.Rounded.Download, contentDescription = null, tint = Hue.grape.text, modifier = Modifier.size(18.dp))
            Text(stringResource(R.string.profile_export_data), style = Type.chip, color = Hue.grape.text, modifier = Modifier.padding(start = 6.dp))
        }
        TextButton(onClick = { deleting = true }, modifier = Modifier.align(Alignment.CenterHorizontally).testTag("delete-account")) {
            Icon(BoolaaIcons.Delete, contentDescription = null, tint = c.dangerText, modifier = Modifier.size(18.dp))
            Text(stringResource(R.string.delete_account), style = Type.chip, color = c.dangerText, modifier = Modifier.padding(start = 6.dp))
        }
    }
    if (exporting) ExportDataFlow(onDismiss = { exporting = false })
    if (deleting) DeleteAccountFlow(onDismiss = { deleting = false }, onDeleted = { deleting = false; onDismiss() })
    ErrorDialogFor(vm)
}

@Composable
private fun LanguageRow(label: String, selected: Boolean, tag: String = "system", onClick: () -> Unit) {
    val c = BoolaaTheme.colors
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(Radius.field))
            .then(if (selected) Modifier.background(Hue.grape.wash) else Modifier)
            .selectable(selected = selected, role = Role.RadioButton, onClick = onClick).padding(horizontal = 14.dp, vertical = 10.dp)
            .testTag("language-$tag"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = if (selected) Type.bodyStrong else Type.body, color = if (selected) Hue.grape.text else c.textPrimary, modifier = Modifier.weight(1f))
        if (selected) Icon(BoolaaIcons.Check, contentDescription = null, tint = Hue.grape.text, modifier = Modifier.size(22.dp))
    }
}
