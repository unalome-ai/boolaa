package com.boolaa.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Boolaa visual language (spec "Visual language"). */
object Brand {
    val purple = Color(0xFF9D78BD)
    val accent = Color(0xFF7B61FF)
    val danger = Color(0xFFE5484D)
    val cardRadius = 16.dp
    /** Bottom inset that keeps scroll content clear of the floating tab bar and FAB. */
    val tabBarClearance = 170.dp
}

@Immutable
data class BoolaaColors(
    val background: Color,
    val card: Color,
    val chipInactive: Color,
    val field: Color,
    val otherBubble: Color,
    val textPrimary: Color,
    val textSecondary: Color,
    val divider: Color,
    val isDark: Boolean,
)

private val LightColors = BoolaaColors(
    background = Color(0xFFFAFAFA), card = Color.White, chipInactive = Color(0xFFEEEEEE),
    field = Color(0xFFF1EEF5), otherBubble = Color(0xFFF0ECF5),
    textPrimary = Color(0xFF18181B), textSecondary = Color(0xFF6B6B76), divider = Color(0x14000000), isDark = false,
)
private val DarkColors = BoolaaColors(
    background = Color(0xFF18181B), card = Color(0xFF23232B), chipInactive = Color(0xFF23232B),
    field = Color(0xFF2C2C36), otherBubble = Color(0xFF2C2C36),
    textPrimary = Color(0xFFF4F4F5), textSecondary = Color(0xFFA1A1AA), divider = Color(0x1FFFFFFF), isDark = true,
)

val LocalBoolaaColors = staticCompositionLocalOf { LightColors }

object BoolaaTheme {
    val colors: BoolaaColors @Composable get() = LocalBoolaaColors.current
}

private val BoolaaTypography = Typography().let { t ->
    t.copy(
        displaySmall = TextStyle(fontSize = 32.sp, fontWeight = FontWeight.Bold, lineHeight = 38.sp),
        headlineSmall = t.headlineSmall.copy(fontWeight = FontWeight.Bold),
        titleLarge = t.titleLarge.copy(fontWeight = FontWeight.Bold),
        titleMedium = t.titleMedium.copy(fontWeight = FontWeight.SemiBold),
    )
}

@Composable
fun BoolaaTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val c = if (darkTheme) DarkColors else LightColors
    val scheme = if (darkTheme) {
        darkColorScheme(
            primary = Brand.purple, onPrimary = Color.White, secondary = Brand.accent, onSecondary = Color.White,
            background = c.background, onBackground = c.textPrimary, surface = c.card, onSurface = c.textPrimary,
            surfaceVariant = c.field, onSurfaceVariant = c.textSecondary, surfaceContainerHigh = c.card,
            surfaceContainer = c.card, surfaceContainerLow = c.card, error = Brand.danger, outline = c.textSecondary,
            primaryContainer = Brand.purple.copy(alpha = 0.25f), onPrimaryContainer = Color.White,
        )
    } else {
        lightColorScheme(
            primary = Brand.purple, onPrimary = Color.White, secondary = Brand.accent, onSecondary = Color.White,
            background = c.background, onBackground = c.textPrimary, surface = c.card, onSurface = c.textPrimary,
            surfaceVariant = c.field, onSurfaceVariant = c.textSecondary, surfaceContainerHigh = c.card,
            surfaceContainer = c.card, surfaceContainerLow = c.card, error = Brand.danger, outline = c.textSecondary,
            primaryContainer = Brand.purple.copy(alpha = 0.15f), onPrimaryContainer = Brand.purple,
        )
    }
    CompositionLocalProvider(LocalBoolaaColors provides c) {
        MaterialTheme(colorScheme = scheme, typography = BoolaaTypography, content = content)
    }
}
