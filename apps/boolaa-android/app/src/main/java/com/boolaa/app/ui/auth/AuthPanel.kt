package com.boolaa.app.ui.auth

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.selection.toggleable
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.boolaa.app.ui.components.BoolaaLogo
import com.boolaa.app.ui.components.BubbleBackdrop
import com.boolaa.app.ui.components.boolaaCard
import com.boolaa.app.ui.components.popIn
import com.boolaa.app.ui.theme.BoolaaTheme
import com.boolaa.app.ui.theme.Hue
import com.boolaa.app.ui.theme.Motion
import com.boolaa.app.ui.theme.Radius
import com.boolaa.app.ui.theme.Type

/**
 * The login screen's look for the other auth steps (code, age, new password): drifting bubbles, a bobbing logo and
 * the frosted hero panel. Scrolls, so it lays out at font scale 2.0 and with the keyboard open.
 */
@Composable
fun AuthPanelScaffold(tag: String, modifier: Modifier = Modifier, logoSize: Dp = 72.dp, content: @Composable ColumnScope.() -> Unit) {
    val c = BoolaaTheme.colors
    Box(modifier.fillMaxSize().testTag(tag)) {
        BubbleBackdrop()
        Column(
            Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()
                .verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            BoolaaLogo(logoSize, Modifier.padding(top = 28.dp).popIn(0))
            Column(
                Modifier.padding(top = 20.dp).widthIn(max = 520.dp).popIn(2)
                    .boolaaCard(18.dp, Radius.hero, c.card.copy(alpha = if (c.isDark) 0.78f else 0.72f))
                    .animateContentSize(Motion.gentle()),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                content = content,
            )
        }
    }
}

@Composable
fun AuthTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text, style = Type.title, color = BoolaaTheme.colors.textPrimary, textAlign = TextAlign.Center,
        modifier = modifier.fillMaxWidth().semantics { heading() },
    )
}

/** Plain secondary text under a title. */
@Composable
fun AuthMessage(text: String, modifier: Modifier = Modifier) {
    Text(text, style = Type.body, color = BoolaaTheme.colors.textSecondary, textAlign = TextAlign.Center, modifier = modifier.fillMaxWidth())
}

/** A quiet text link ("Use another account", "Forgot password?"), at least 44 dp tall. */
@Composable
fun AuthLink(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, danger: Boolean = false, enabled: Boolean = true) {
    val c = BoolaaTheme.colors
    Box(
        modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(Radius.small))
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick).padding(horizontal = 8.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = Type.chip, color = if (danger) c.dangerText else if (enabled) Hue.grape.text else c.textSecondary, textAlign = TextAlign.Center)
    }
}

/** A full-row checkbox (the whole row toggles, TalkBack reads it as one checkbox). */
@Composable
fun CheckRow(checked: Boolean, onChange: (Boolean) -> Unit, modifier: Modifier = Modifier, label: @Composable () -> Unit) {
    val c = BoolaaTheme.colors
    Row(
        modifier.fillMaxWidth().clip(RoundedCornerShape(Radius.small))
            .toggleable(value = checked, role = Role.Checkbox, onValueChange = onChange).padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox(checked = checked, onCheckedChange = null,
            colors = CheckboxDefaults.colors(checkedColor = Hue.grape.fill, checkmarkColor = Hue.grape.onFill, uncheckedColor = c.textSecondary))
        Box(Modifier.padding(start = 10.dp).weight(1f)) { label() }
    }
}
