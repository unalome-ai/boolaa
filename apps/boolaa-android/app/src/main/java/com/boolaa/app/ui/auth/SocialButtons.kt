package com.boolaa.app.ui.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.boolaa.app.R
import com.boolaa.app.ui.components.clickableRipple
import com.boolaa.app.ui.theme.BoolaaTheme
import com.boolaa.app.ui.theme.Type

/** "or" between the email form and the provider buttons. */
@Composable
fun OrDivider(modifier: Modifier = Modifier) {
    val c = BoolaaTheme.colors
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        HorizontalDivider(Modifier.weight(1f), color = c.textSecondary.copy(alpha = 0.25f))
        Text(stringResource(R.string.or), style = Type.caption, color = c.textSecondary, modifier = Modifier.padding(horizontal = 12.dp))
        HorizontalDivider(Modifier.weight(1f), color = c.textSecondary.copy(alpha = 0.25f))
    }
}

/**
 * Google's branded button (developers.google.com/identity/branding-guidelines): the standard four-colour "G" on
 * white with a #747775 outline and #1F1F1F label in light mode, #131314 with #8E918F and #E3E3E3 in dark mode,
 * Roboto Medium, pill shape. Google's localized "Continue with Google" wording.
 */
@Composable
fun GoogleButton(onClick: () -> Unit, loading: Boolean, modifier: Modifier = Modifier, enabled: Boolean = true) {
    val dark = BoolaaTheme.colors.isDark
    ProviderButton(
        label = stringResource(R.string.continue_with_google), logo = GoogleLogo, logoTint = null, onClick = onClick, loading = loading,
        fill = if (dark) Color(0xFF131314) else Color.White, stroke = if (dark) Color(0xFF8E918F) else Color(0xFF747775),
        text = if (dark) Color(0xFFE3E3E3) else Color(0xFF1F1F1F), enabled = enabled, modifier = modifier.testTag("google-sign-in"),
    )
}

/** Apple's button for the web flow (Human Interface Guidelines): black with a white logo, white with a black logo in dark mode. */
@Composable
fun AppleButton(onClick: () -> Unit, loading: Boolean, modifier: Modifier = Modifier, enabled: Boolean = true) {
    val dark = BoolaaTheme.colors.isDark
    val fg = if (dark) Color.Black else Color.White
    ProviderButton(
        label = stringResource(R.string.continue_with_apple), logo = AppleLogo, logoTint = fg, onClick = onClick, loading = loading,
        fill = if (dark) Color.White else Color.Black, stroke = null, text = fg, enabled = enabled,
        modifier = modifier.testTag("apple-sign-in"),
    )
}

@Composable
private fun ProviderButton(
    label: String, logo: ImageVector, logoTint: Color?, onClick: () -> Unit, loading: Boolean,
    fill: Color, stroke: Color?, text: Color, enabled: Boolean, modifier: Modifier,
) {
    Box(
        modifier.fillMaxWidth().heightIn(min = 54.dp).clip(CircleShape).background(fill)
            .then(if (stroke != null) Modifier.border(1.dp, stroke, CircleShape) else Modifier)
            .clickableRipple(enabled = enabled && !loading, role = Role.Button, onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        if (loading) {
            CircularProgressIndicator(color = text, strokeWidth = 2.5.dp, modifier = Modifier.size(22.dp))
        } else {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                if (logoTint != null) Icon(logo, contentDescription = null, tint = logoTint, modifier = Modifier.size(20.dp))
                else Icon(rememberVectorPainter(logo), contentDescription = null, tint = Color.Unspecified, modifier = Modifier.size(20.dp))
                Text(
                    label, color = text, textAlign = TextAlign.Center,
                    style = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Medium, fontSize = 16.sp, lineHeight = 22.sp),
                )
            }
        }
    }
}

private fun path(d: String) = PathParser().parsePathString(d).toNodes()

/** Google "G" (official four-colour mark, 48 viewport). */
val GoogleLogo: ImageVector by lazy {
    ImageVector.Builder(defaultWidth = 20.dp, defaultHeight = 20.dp, viewportWidth = 48f, viewportHeight = 48f)
        .addPath(path("M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"), fill = SolidColor(Color(0xFFEA4335)))
        .addPath(path("M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"), fill = SolidColor(Color(0xFF4285F4)))
        .addPath(path("M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"), fill = SolidColor(Color(0xFFFBBC05)))
        .addPath(path("M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"), fill = SolidColor(Color(0xFF34A853)))
        .build()
}

/** Apple logo (single path, 24 viewport), tinted by the button. */
val AppleLogo: ImageVector by lazy {
    ImageVector.Builder(defaultWidth = 20.dp, defaultHeight = 20.dp, viewportWidth = 24f, viewportHeight = 24f)
        .addPath(
            path(
                "M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 " +
                    "1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 " +
                    "3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559" +
                    "-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052" +
                    "-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701",
            ),
            fill = SolidColor(Color.Black),
        )
        .build()
}
