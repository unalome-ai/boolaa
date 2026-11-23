package com.boolaa.app.ui.auth

import android.content.ClipboardManager
import android.content.Context
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.boolaa.app.R
import com.boolaa.app.core.DeviceCodeException
import com.boolaa.app.core.UserFacingError
import com.boolaa.app.state.RouteGate
import com.boolaa.app.ui.components.shake
import com.boolaa.app.ui.theme.BoolaaTheme
import com.boolaa.app.ui.theme.Hue
import com.boolaa.app.ui.theme.Motion
import com.boolaa.app.ui.theme.Radius
import com.boolaa.app.ui.theme.Type
import kotlinx.coroutines.delay

const val CODE_LENGTH = 6

/** Keeps the digits of typed or pasted text, at most [CODE_LENGTH] ("123 456", "Code: 123456" -> "123456"). */
fun codeDigits(text: String): String = text.filter { it in '0'..'9' }.take(CODE_LENGTH)

/** What a code screen shows under the boxes: a plain message, or "N tries left" for a wrong device code. */
data class CodeError(val message: Int, val attemptsLeft: Int? = null) {
    companion object {
        fun from(e: Throwable): CodeError =
            if (e is DeviceCodeException && e.code == "invalid_code" && e.attemptsLeft != null) CodeError(R.string.error_code_wrong, e.attemptsLeft)
            else CodeError(UserFacingError.classify(e).message)
    }
}

@Composable
fun CodeErrorText(error: CodeError?, modifier: Modifier = Modifier) {
    if (error == null) return
    val text = if (error.attemptsLeft != null) pluralStringResource(R.plurals.code_tries_left, error.attemptsLeft, error.attemptsLeft)
    else stringResource(error.message)
    Text(
        text, style = Type.subheadline, color = BoolaaTheme.colors.dangerText, textAlign = TextAlign.Center,
        modifier = modifier.fillMaxWidth().testTag("code-error").semantics { liveRegion = LiveRegionMode.Polite },
    )
}

/**
 * Six code boxes over one invisible numeric text field: typing, deleting, pasting (long press or [PasteCodeButton])
 * and one-time-code autofill all go through the field. The boxes shake on a wrong code ([shakes]).
 */
@Composable
fun CodeField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    isError: Boolean = false,
    shakes: Int = 0,
    onDone: () -> Unit = {},
) {
    val label = stringResource(R.string.code_field_label)
    val progress = pluralStringResource(R.plurals.code_field_progress, CODE_LENGTH, value.length, CODE_LENGTH)
    val focus = remember { FocusRequester() }
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    BasicTextField(
        value = value,
        onValueChange = { onValueChange(codeDigits(it)) },
        enabled = enabled,
        singleLine = true,
        interactionSource = source,
        // The field's own text is invisible; the boxes draw the digits.
        textStyle = Type.title2.copy(color = Color.Transparent),
        cursorBrush = SolidColor(Color.Transparent),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { onDone() }),
        modifier = modifier
            .fillMaxWidth()
            .focusRequester(focus)
            .shake(shakes)
            .semantics {
                contentType = ContentType.SmsOtpCode
                contentDescription = label
                stateDescription = progress
            }
            .testTag("code-field"),
        decorationBox = { inner ->
            Box {
                Row(
                    Modifier.fillMaxWidth().clearAndSetSemantics {},
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                ) {
                    repeat(CODE_LENGTH) { i ->
                        CodeBox(value.getOrNull(i), active = focused && enabled && i == value.length.coerceAtMost(CODE_LENGTH - 1),
                            isError = isError, modifier = Modifier.weight(1f).widthIn(max = 56.dp))
                    }
                }
                Box(Modifier.matchParentSize()) { inner() }
            }
        },
    )
}

@Composable
private fun CodeBox(digit: Char?, active: Boolean, isError: Boolean, modifier: Modifier) {
    val c = BoolaaTheme.colors
    val shape = RoundedCornerShape(Radius.field)
    val target = when {
        isError -> c.dangerText
        active -> c.focusRing
        else -> c.fieldBorder
    }
    val ring by animateColorAsState(target, Motion.fade(), label = "codeBoxRing")
    Box(
        modifier.heightIn(min = 56.dp).background(c.field, shape).border(if (active || isError) 2.dp else 1.dp, ring, shape).padding(vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            digit?.toString() ?: "",
            style = Type.title2.copy(fontFeatureSettings = "tnum"),
            color = c.textPrimary, textAlign = TextAlign.Center,
        )
    }
}

/** Seconds until "Resend code" is allowed again, ticking once a second. */
@Composable
fun rememberResendSecondsLeft(sentAt: Long?): Int {
    val left by produceState(RouteGate.resendSecondsLeft(sentAt, System.currentTimeMillis()), sentAt) {
        while (true) {
            value = RouteGate.resendSecondsLeft(sentAt, System.currentTimeMillis())
            if (value == 0) break
            delay(1000)
        }
    }
    return left
}

/** "Resend code" (disabled with a countdown for 60 s after a send) and "Paste code". Wraps at large font sizes. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CodeActions(sentAt: Long?, sending: Boolean, onResend: () -> Unit, onPaste: (String) -> Unit, modifier: Modifier = Modifier) {
    val secondsLeft = rememberResendSecondsLeft(sentAt)
    val context = LocalContext.current
    FlowRow(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
        TextButton(
            onClick = onResend, enabled = secondsLeft == 0 && !sending,
            modifier = Modifier.testTag("code-resend"),
        ) {
            Text(
                if (secondsLeft > 0) stringResource(R.string.code_resend_in, secondsLeft) else stringResource(R.string.code_resend),
                style = Type.chip, color = if (secondsLeft == 0 && !sending) Hue.grape.text else BoolaaTheme.colors.textSecondary,
                textAlign = TextAlign.Center,
            )
        }
        TextButton(
            onClick = {
                val clip = (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).primaryClip
                val text = clip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString().orEmpty()
                onPaste(codeDigits(text))
            },
            modifier = Modifier.testTag("code-paste"),
        ) { Text(stringResource(R.string.code_paste), style = Type.chip, color = Hue.grape.text, textAlign = TextAlign.Center) }
    }
}

/** Title, explanation and the code boxes, as one block used by every code step. */
@Composable
fun CodeStepHeader(title: String, message: String, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        AuthTitle(title)
        Text(message, style = Type.body, color = BoolaaTheme.colors.textSecondary, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
    }
}
