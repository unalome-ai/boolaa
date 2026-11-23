package com.boolaa.app.ui.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.core.os.ConfigurationCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.boolaa.app.AppContainer
import com.boolaa.app.R
import com.boolaa.app.core.Formats
import com.boolaa.app.core.Suspension
import com.boolaa.app.ui.BaseViewModel
import com.boolaa.app.ui.ErrorDialogFor
import com.boolaa.app.ui.LocalAppContainer
import com.boolaa.app.ui.components.PrimaryButton
import com.boolaa.app.ui.components.boolaaCard
import com.boolaa.app.ui.profile.DeleteAccountFlow
import com.boolaa.app.ui.safety.label
import com.boolaa.app.ui.theme.BoolaaTheme
import com.boolaa.app.ui.theme.Hue
import com.boolaa.app.ui.theme.Radius
import com.boolaa.app.ui.theme.Type

class SuspendedViewModel(private val container: AppContainer) : BaseViewModel() {
    fun signOut() = launchCatching { container.session.signOut() }
    fun backToSignIn() = container.session.dismissSignInBlocked()
}

/**
 * Suspended or banned account (docs/moderation.md "Clients"). Calm and still on purpose: no drifting bubbles, no
 * confetti. Shows the end date and the reason when there is a session to read them with, the appeal address, sign
 * out and delete account. After a `user_banned` sign-in there is no session, so it only explains and goes back.
 * Coming back to the front re-runs the gate (MainActivity.onStart), so a suspension that has ended lets the user in.
 * Calm surface: no mascot draws inside it (design-system.md §8.4).
 */
@Composable
fun SuspendedScreen() = com.boolaa.app.ui.components.CalmSurface { SuspendedScreenContent() }

@Composable
private fun SuspendedScreenContent() {
    val container = LocalAppContainer.current
    val vm: SuspendedViewModel = viewModel { SuspendedViewModel(container) }
    val state by container.session.state.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    var deleting by rememberSaveable { mutableStateOf(false) }
    val suspension = state.suspension ?: Suspension.signInBlocked
    val locale = ConfigurationCompat.getLocales(LocalConfiguration.current)[0] ?: java.util.Locale.ENGLISH
    val c = BoolaaTheme.colors

    Box(Modifier.fillMaxSize().background(c.background).testTag("suspended")) {
        Column(
            Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp, vertical = 48.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(
                Modifier.widthIn(max = 520.dp).boolaaCard(22.dp, Radius.hero, c.card),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                AuthTitle(
                    stringResource(if (suspension.kind == Suspension.Kind.BANNED) R.string.suspended_title_banned else R.string.suspended_title_suspended),
                    Modifier.testTag("suspended-title"),
                )
                when (suspension.kind) {
                    Suspension.Kind.SUSPENDED -> {
                        suspension.until?.let { until ->
                            Text(
                                stringResource(R.string.suspended_until, Formats.longDateTime(until, locale)),
                                style = Type.body.copy(fontWeight = FontWeight.SemiBold), color = c.textPrimary,
                                modifier = Modifier.fillMaxWidth().testTag("suspended-until"),
                            )
                        }
                        Text(stringResource(R.string.suspended_blocked), style = Type.body, color = c.textSecondary, modifier = Modifier.fillMaxWidth())
                    }
                    Suspension.Kind.BANNED ->
                        Text(stringResource(R.string.suspended_banned), style = Type.body, color = c.textPrimary, modifier = Modifier.fillMaxWidth())
                    Suspension.Kind.SIGN_IN_BLOCKED ->
                        Text(stringResource(R.string.suspended_sign_in_blocked), style = Type.body, color = c.textPrimary, modifier = Modifier.fillMaxWidth())
                }
                suspension.reason?.let { reason ->
                    Text(
                        stringResource(R.string.suspended_reason, stringResource(reason.label())), style = Type.body, color = c.textPrimary,
                        modifier = Modifier.fillMaxWidth().testTag("suspended-reason"),
                    )
                }
                AppealText()
                if (suspension.kind == Suspension.Kind.SIGN_IN_BLOCKED) {
                    PrimaryButton(stringResource(R.string.suspended_back_to_sign_in), onClick = vm::backToSignIn, calm = true,
                        modifier = Modifier.testTag("suspended-back"))
                } else {
                    PrimaryButton(stringResource(R.string.sign_out), onClick = { vm.signOut() }, calm = true, loading = busy,
                        modifier = Modifier.testTag("suspended-sign-out"))
                    // delete_my_account() still works while suspended (docs/moderation.md).
                    AuthLink(stringResource(R.string.delete_account), { deleting = true }, Modifier.testTag("suspended-delete"), danger = true)
                }
            }
        }
    }
    if (deleting) DeleteAccountFlow(onDismiss = { deleting = false }, onDeleted = { deleting = false })
    ErrorDialogFor(vm)
}

/** "Think this is a mistake? Write to privacy@boolaa.ro ...", the address a mailto: link. */
@Composable
private fun AppealText() {
    val c = BoolaaTheme.colors
    val email = stringResource(R.string.appeal_email)
    val template = stringResource(R.string.suspended_appeal)
    val linkStyle = TextLinkStyles(SpanStyle(color = Hue.grape.text, fontWeight = FontWeight.SemiBold, textDecoration = TextDecoration.Underline))
    val text: AnnotatedString = buildAnnotatedString {
        val at = template.indexOf("%1\$s")
        if (at < 0) { append(template); return@buildAnnotatedString }
        append(template.substring(0, at))
        pushLink(LinkAnnotation.Url("mailto:$email", linkStyle))
        append(email)
        pop()
        append(template.substring(at + 4))
    }
    Text(
        text, style = Type.subheadline, color = c.textPrimary,
        modifier = Modifier.fillMaxWidth().background(c.field, RoundedCornerShape(Radius.field)).padding(14.dp).testTag("suspended-appeal"),
    )
}
