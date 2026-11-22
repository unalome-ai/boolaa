package com.boolaa.app.ui.auth

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.Text
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
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import android.content.Context
import androidx.compose.ui.platform.LocalContext
import com.boolaa.app.AppContainer
import com.boolaa.app.R
import com.boolaa.app.core.AuthProviders
import com.boolaa.app.core.GoogleSignIn
import com.boolaa.app.core.OAuthNonce
import com.boolaa.app.core.SocialSignInException
import com.boolaa.app.core.UserFacingError
import io.github.jan.supabase.auth.exception.AuthRestException
import com.boolaa.app.ui.BaseViewModel
import com.boolaa.app.ui.ErrorDialogFor
import com.boolaa.app.ui.LocalAppContainer
import com.boolaa.app.ui.components.BoolaaLogo
import com.boolaa.app.ui.components.BoolaaTextField
import com.boolaa.app.ui.components.BubbleBackdrop
import com.boolaa.app.ui.components.Haptics
import com.boolaa.app.ui.components.PrimaryButton
import com.boolaa.app.ui.components.SegmentedPill
import com.boolaa.app.ui.components.boolaaCard
import com.boolaa.app.ui.components.popIn
import com.boolaa.app.ui.components.shake
import com.boolaa.app.ui.safety.LegalAgreementText
import com.boolaa.app.ui.theme.BoolaaTheme
import com.boolaa.app.ui.theme.Hue
import com.boolaa.app.ui.theme.Motion
import com.boolaa.app.ui.theme.Radius
import com.boolaa.app.ui.theme.Type
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

class AuthViewModel(private val container: AppContainer) : BaseViewModel() {
    private val _needsConfirmation = MutableStateFlow(false)
    val needsConfirmation = _needsConfirmation.asStateFlow()
    /** Which provider button shows a spinner. */
    private val _providerBusy = MutableStateFlow<String?>(null)
    val providerBusy = _providerBusy.asStateFlow()

    /** Credential Manager sheet -> Google ID token (hashed nonce) -> Supabase signInWith(IDToken) with the raw nonce. */
    fun signInWithGoogle(activity: Context) = launchCatching(trackBusy = false) {
        _providerBusy.value = "google"
        try {
            val nonce = OAuthNonce.create()
            val token = GoogleSignIn.idToken(activity, nonce) ?: return@launchCatching
            try {
                container.session.signInWithGoogle(token, nonce.raw)
            } catch (e: AuthRestException) {
                val kind = UserFacingError.classify(e)
                throw SocialSignInException(if (kind == UserFacingError.SIGN_IN_PROVIDER_UNAVAILABLE) kind else UserFacingError.SIGN_IN_PROVIDER_FAILED, e)
            }
        } finally {
            _providerBusy.value = null
        }
    }

    /** Apple has no Android SDK: OAuth in a Custom Tab, back through ro.boolaa.app://auth/callback. */
    fun signInWithApple() = launchCatching(trackBusy = false) {
        _providerBusy.value = "apple"
        try {
            if (!AuthProviders.isEnabled("apple")) throw SocialSignInException(UserFacingError.SIGN_IN_PROVIDER_UNAVAILABLE)
            container.session.startAppleSignIn()
        } finally {
            _providerBusy.value = null
        }
    }

    fun signIn(email: String, password: String) = launchCatching {
        container.session.signIn(email, password)
    }

    fun signUp(name: String, email: String, password: String) = launchCatching {
        if (password.length < 6) { showError(UserFacingError.WEAK_PASSWORD.message); return@launchCatching }
        _needsConfirmation.value = !container.session.signUp(name, email, password)
    }
}

/**
 * Login and register (spec §1). The name is sent as sign-up metadata { name }.
 * The joyful first impression: bubbles drifting up a soft sky, a bobbing logo, the wordmark's letters dropping in
 * one after another, then the tagline and a frosted form panel.
 */
@Composable
fun AuthScreen() {
    val container = LocalAppContainer.current
    val vm: AuthViewModel = viewModel { AuthViewModel(container) }
    val busy by vm.busy.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    val needsConfirmation by vm.needsConfirmation.collectAsStateWithLifecycle()
    val providerBusy by vm.providerBusy.collectAsStateWithLifecycle()
    val context = LocalContext.current
    var register by rememberSaveable { mutableStateOf(false) }
    var forgot by rememberSaveable { mutableStateOf(false) }
    var name by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var ageConfirmed by rememberSaveable { mutableStateOf(false) }
    var shakes by remember { mutableIntStateOf(0) }
    val view = LocalView.current
    val c = BoolaaTheme.colors
    LaunchedEffect(error) { if (error != null) { shakes++; Haptics.error(view) } }

    Box(Modifier.fillMaxSize().testTag("auth-screen")) {
        BubbleBackdrop()
        Column(
            Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()
                .verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            BoolaaLogo(92.dp, Modifier.padding(top = 36.dp).popIn(0))
            Wordmark(Modifier.padding(top = 6.dp))
            Text(
                stringResource(R.string.auth_tagline),
                style = Type.chip, color = c.textSecondary, textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 6.dp, start = 12.dp, end = 12.dp).popIn(6),
            )
            Column(
                Modifier.padding(top = 24.dp).popIn(7)
                    // Frosted panel: Compose has no backdrop blur, so the card colour is simply translucent.
                    .boolaaCard(18.dp, Radius.hero, c.card.copy(alpha = if (c.isDark) 0.78f else 0.72f))
                    .animateContentSize(Motion.gentle()),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (forgot) {
                    ForgotPasswordPanel(onBackToSignIn = { forgot = false }, initialEmail = email)
                    return@Column
                }
                SegmentedPill(
                    options = listOf(false to stringResource(R.string.sign_in), true to stringResource(R.string.create_account)),
                    selected = register, onSelect = { register = it },
                    // The tag follows the segment that flips the mode, as the old toggle link did.
                    tagFor = { if (it != register) "auth-toggle" else null },
                    modifier = Modifier.padding(bottom = 4.dp),
                )
                AnimatedVisibility(register) {
                    BoolaaTextField(name, { name = it }, stringResource(R.string.name), Modifier.testTag("name"))
                }
                BoolaaTextField(email, { email = it }, stringResource(R.string.email), Modifier.testTag("email"), keyboardType = KeyboardType.Email)
                BoolaaTextField(password, { password = it }, stringResource(R.string.password), Modifier.testTag("password"), isPassword = true)
                AnimatedVisibility(!register) {
                    AuthLink(stringResource(R.string.forgot_password), { forgot = true }, Modifier.testTag("forgot-password"))
                }
                AnimatedVisibility(register) {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(Radius.small))
                                .toggleable(value = ageConfirmed, role = Role.Checkbox, onValueChange = { ageConfirmed = it })
                                .padding(vertical = 6.dp).testTag("age-confirm"),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Checkbox(checked = ageConfirmed, onCheckedChange = null,
                                colors = CheckboxDefaults.colors(checkedColor = Hue.grape.fill, checkmarkColor = Hue.grape.onFill, uncheckedColor = c.textSecondary))
                            Text(stringResource(R.string.age_confirm), style = Type.body, color = c.textPrimary, modifier = Modifier.padding(start = 10.dp))
                        }
                        LegalAgreementText(Modifier.fillMaxWidth())
                    }
                }
                if (needsConfirmation && register) {
                    Text(
                        stringResource(R.string.auth_check_email), color = Hue.mint.text, style = Type.subheadline, textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth().popIn().clip(RoundedCornerShape(Radius.field)).background(Hue.mint.wash).padding(12.dp),
                    )
                }
                PrimaryButton(
                    text = stringResource(if (register) R.string.create_account else R.string.sign_in),
                    onClick = { if (register) vm.signUp(name, email, password) else vm.signIn(email, password) },
                    enabled = email.isNotBlank() && password.isNotBlank() && (!register || (name.isNotBlank() && ageConfirmed)),
                    loading = busy,
                    modifier = Modifier.padding(top = 4.dp).shake(shakes).testTag("auth-submit"),
                )
                OrDivider(Modifier.padding(vertical = 4.dp))
                GoogleButton(onClick = { vm.signInWithGoogle(context) }, loading = providerBusy == "google", enabled = providerBusy == null)
                AppleButton(onClick = vm::signInWithApple, loading = providerBusy == "apple", enabled = providerBusy == null)
            }
        }
    }
    ErrorDialogFor(vm)
}

/** "Boolaa" in the heavy display face; the letters drop in one after another. A fixed size, by design. */
@Composable
fun Wordmark(modifier: Modifier = Modifier) {
    val name = stringResource(R.string.app_name)
    val size = with(LocalDensity.current) { 46.dp.toSp() }
    val ink = BoolaaTheme.colors.textPrimary
    val grape = Hue.grape.text
    Row(modifier.clearAndSetSemantics { contentDescription = name; heading() }) {
        name.forEachIndexed { index, letter ->
            Text(
                letter.toString(), style = Type.wordmark.copy(fontSize = size, lineHeight = size * 1.15f),
                color = if (index == 1 || index == 2) grape else ink,
                modifier = Modifier.popIn(index + 1, rise = (-26).dp),
            )
        }
    }
}
