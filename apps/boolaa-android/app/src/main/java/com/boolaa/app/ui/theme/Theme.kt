package com.boolaa.app.ui.theme

import android.provider.Settings
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import com.boolaa.app.R

// Boolaa "Soft pop" design tokens. The platform-neutral source of truth is docs/design-system.md
// (the iOS reference is Boolaa/Core/Theme.swift); keep them in step.

/** Dark ink used on bright fills in both modes. */
val InkOnColor = Color(0xFF1E1638)

/** One colour family: a vivid fill, the content colour that sits on it, an adaptive text shade and a soft wash. */
@Immutable
class Hue private constructor(
    val name: String,
    /** Vivid fill, the same in light and dark mode. */
    val fill: Color,
    /** Lighter companion of [fill], for gradients and glossy highlights. */
    val glow: Color,
    /** Darker companion of [fill], for the bottom of gradients under white content. */
    val deep: Color,
    private val whiteOnFill: Boolean,
    private val textLight: Color,
    private val textDark: Color,
) {
    /** Text and icons placed on [fill] (AA): white on grape and indigo, ink on the bright hues. */
    val onFill: Color = if (whiteOnFill) Color.White else InkOnColor

    /** Top and bottom of the fill gradient that keeps [onFill] readable over its whole height. */
    val gradientTop: Color = if (whiteOnFill) fill else glow
    val gradientBottom: Color = if (whiteOnFill) deep else fill

    /** Top-to-bottom fill gradient. */
    val gradient: Brush = Brush.verticalGradient(listOf(gradientTop, gradientBottom))

    /** Diagonal gradient for the Home hero card. */
    val heroGradient: Brush = Brush.linearGradient(listOf(gradientTop, gradientBottom))

    fun text(dark: Boolean): Color = if (dark) textDark else textLight
    fun wash(dark: Boolean): Color = fill.copy(alpha = if (dark) 0.24f else 0.14f)

    /** Text in this hue on backgrounds, cards and washes (AA in both modes). */
    val text: Color @Composable @ReadOnlyComposable get() = text(LocalBoolaaColors.current.isDark)

    /** Soft tinted surface for badges and chips. */
    val wash: Color @Composable @ReadOnlyComposable get() = wash(LocalBoolaaColors.current.isDark)

    companion object {
        // Light text #5B3FD9 -> #5135CF (same as iOS and web): 5.08:1 for grape text on a grape wash over the bubble glow.
        val grape = Hue("grape", Color(0xFF7357F6), Color(0xFF9B86FF), Color(0xFF5B3FD9), true, Color(0xFF5135CF), Color(0xFFB7A6FF))
        val coral = Hue("coral", Color(0xFFFF6B5C), Color(0xFFFF9A82), Color(0xFFE8503F), false, Color(0xFFC0392B), Color(0xFFFF9A8F))
        val mint = Hue("mint", Color(0xFF1EC8A0), Color(0xFF6BE6C6), Color(0xFF12A683), false, Color(0xFF0B7A60), Color(0xFF5FE3C2))
        val sky = Hue("sky", Color(0xFF3AA8FF), Color(0xFF7CC9FF), Color(0xFF1F8DE6), false, Color(0xFF0B6BBF), Color(0xFF7CC6FF))
        val sunny = Hue("sunny", Color(0xFFFFC93C), Color(0xFFFFE07A), Color(0xFFF2B21B), false, Color(0xFF8A6400), Color(0xFFFFD466))
        val pink = Hue("pink", Color(0xFFF0569F), Color(0xFFFF8CC0), Color(0xFFD63D86), false, Color(0xFFB8246F), Color(0xFFFF9CCB))
        val tangerine = Hue("tangerine", Color(0xFFFF9A2E), Color(0xFFFFBE5C), Color(0xFFF07F0C), false, Color(0xFFA85800), Color(0xFFFFB866))
        val indigo = Hue("indigo", Color(0xFF5468F0), Color(0xFF8795FF), Color(0xFF3F50D0), true, Color(0xFF3F50D0), Color(0xFFA3AEFF))

        /** Bubble colours, in the order the deterministic picker indexes them. */
        val bubblePalette = listOf(grape, coral, mint, sky, sunny, pink, tangerine, indigo)

        /** The colour of a bubble (or a person), from its id; iOS and web use the same function. */
        fun forId(id: String?): Hue = if (id == null) grape else forSeed(id.lowercase())

        /** FNV-1a 32-bit over the UTF-8 bytes, upper half folded into the lower, modulo the palette size. */
        fun forSeed(seed: String): Hue {
            val hash = fnv1a(seed)
            return bubblePalette[((hash xor (hash shr 16)) % bubblePalette.size.toUInt()).toInt()]
        }

        fun fnv1a(string: String): UInt {
            var hash = 2_166_136_261u
            for (byte in string.toByteArray(Charsets.UTF_8)) {
                hash = hash xor (byte.toInt() and 0xFF).toUInt()
                hash *= 16_777_619u
            }
            return hash
        }
    }
}

/** The five features, each with its own colour. */
enum class Feature(val hue: Hue) {
    CHAT(Hue.grape), EVENTS(Hue.coral), FOOD(Hue.tangerine), MARKET(Hue.mint), LINKS(Hue.sky)
}

object Brand {
    val hue = Hue.grape
    /** Calm red for destructive actions (white text on it passes AA). */
    val danger = Color(0xFFD92D3A)
    /** "Taken" badge fill in both modes (white text 5.65:1), same as iOS and web. */
    val taken = Color(0xFF6A6382)
    /** Bottom inset that keeps scroll content clear of the floating dock. */
    val tabBarClearance = 112.dp
}

object Radius {
    val small = 12.dp   // thumbnails, icon badges
    val field = 16.dp   // inputs, calm buttons, banners
    val row = 20.dp     // settings and profile rows
    val card = 24.dp    // cards, empty states
    val hero = 32.dp    // hero card, sheets, auth panel
}

/**
 * Brand redesign tokens (design-system.md §8). iOS keeps the same numbers in `Theme.Brand` (Theme.swift), the web in
 * `src/lib/brand.ts` and `globals.css`; DesignTokensTest checks all three. Contrast of the new pairs: §8.6, BrandRulesTest.
 */
object BrandTokens {
    /** §8.1 Feature band: the hue `fill` at this strength over the background, opaque to 45 % of the band, then fading out. */
    const val BAND_LIGHT = 0.28f
    const val BAND_DARK = 0.22f
    const val BAND_FADE_START = 0.45f
    /** Band circles: white 20 % (light), the background at 40 % (dark). */
    const val BAND_CIRCLE_LIGHT = 0.20f
    const val BAND_CIRCLE_DARK = 0.40f
    /** Band tint cross-fade on a tab or bubble change (200 ms under reduced motion). */
    const val BAND_FADE_MS = 400
    /** §8.2 Chat: orbs behind the thread, and the thread panel (card at 50 % over the background). */
    const val CHAT_ORB_LIGHT = 0.06f
    const val CHAT_ORB_DARK = 0.10f
    const val CHAT_PANEL = 0.5f
    /** §8.3 Dock glass: card at this opacity over the blur (API 31+); card at 90 % without blur below. */
    const val GLASS_LIGHT = 0.72f
    const val GLASS_DARK = 0.80f
    const val GLASS_NO_BLUR = 0.90f
    const val GLASS_EDGE_LIGHT = 0.75f
    const val GLASS_EDGE_DARK = 0.14f
    /** §8.4 Mascot face colours. */
    val mascotCheek = Color(0xFFFF4F8B)
    val mascotTongue = Color(0xFFFF6B8A)
    /** §8.5 Sticker die-cut edge (both modes). */
    val stickerEdge = Color.White.copy(alpha = 0.95f)
    /** §8.4 Cheer toast: how long it stays. */
    const val CHEER_MS = 2800L

    /** §8.5 Home title gradient: the hue *text* shades grape → pink (55 %) → tangerine (large text only, ≥ 3:1 on the band). */
    fun titleGradientStops(dark: Boolean): List<Pair<Float, Color>> =
        listOf(0f to Hue.grape.text(dark), 0.55f to Hue.pink.text(dark), 1f to Hue.tangerine.text(dark))

    /** The band tint itself: [hue]'s fill at the mode's strength. */
    fun bandTint(hue: Hue, dark: Boolean): Color = hue.fill.copy(alpha = if (dark) BAND_DARK else BAND_LIGHT)
}

/** Safety surfaces (report, blocked users, delete account, suspended): the mascot refuses to draw inside them (§8.4). */
val LocalCalm = staticCompositionLocalOf { false }

@Immutable
data class BoolaaColors(
    val background: Color,
    val card: Color,
    val field: Color,
    val otherBubble: Color,
    val hairline: Color,
    val textPrimary: Color,
    val textSecondary: Color,
    val dangerText: Color,
    /** 1 px edge of text fields and field-shaped rows (WCAG 1.4.11, ≥ 3:1 on background and card). */
    val fieldBorder: Color,
    /** 2 px ring of a focused field: the grape text shade. */
    val focusRing: Color,
    /** Elevation 1 shadow (cards). */
    val cardShadow: Color,
    /** Elevation 2 shadow (dock). */
    val floatingShadow: Color,
    val backdropTop: Color,
    val backdropBottom: Color,
    val isDark: Boolean,
) {
    val chipInactive: Color get() = this.field
    val divider: Color get() = hairline
}

internal val LightColors = BoolaaColors(
    background = Color(0xFFFBF8FF), card = Color.White, field = Color(0xFFF1ECFB), otherBubble = Color.White,
    hairline = Color(0x142A1B5E), textPrimary = Color(0xFF1E1638),
    // #6A6382 -> #5C5574 (same as iOS and web): 6.98:1 on cards, and ≥ 4.5 over the header glow and on nested washes.
    textSecondary = Color(0xFF5C5574),
    // Danger as text is a shade deeper than the fill so it stays AA on its own 10-14% wash (4.7:1; #D92D3A was 3.9:1).
    dangerText = Color(0xFFC0272F),
    // 3.67:1 on background, 3.86 on card; focus ring 7.2:1.
    fieldBorder = Color(0xFF857DA1), focusRing = Color(0xFF5135CF), cardShadow = Color(0x142A1B5E), floatingShadow = Color(0x382A1B5E),
    backdropTop = Color(0xFFE9E0FF), backdropBottom = Color(0xFFFFEDE3), isDark = false,
)
internal val DarkColors = BoolaaColors(
    background = Color(0xFF15111F), card = Color(0xFF221C33), field = Color(0xFF2C2545), otherBubble = Color(0xFF2C2545),
    hairline = Color(0x14FFFFFF), textPrimary = Color(0xFFF5F2FF), textSecondary = Color(0xFFABA4C4),
    dangerText = Color(0xFFFF8A8F),
    // 4.51:1 on background, 3.98 on card; focus ring 8.8:1.
    fieldBorder = Color(0xFF80789F), focusRing = Color(0xFFB7A6FF), cardShadow = Color(0x47000000), floatingShadow = Color(0x73000000),
    backdropTop = Color(0xFF241A45), backdropBottom = Color(0xFF1F1430), isDark = true,
)

val LocalBoolaaColors = staticCompositionLocalOf { LightColors }

/**
 * True when animations are turned off: Accessibility "Remove animations" (all scales 0) or the developer options' animator
 * or transition scale at 0. Ambient loops stop, springs become fades, nothing bounces, slides or shakes.
 */
val LocalReduceMotion = staticCompositionLocalOf { false }

object BoolaaTheme {
    val colors: BoolaaColors @Composable @ReadOnlyComposable get() = LocalBoolaaColors.current
    val reduceMotion: Boolean @Composable @ReadOnlyComposable get() = LocalReduceMotion.current
}

// MARK: Type

/** Nunito (variable, OFL, bundled in res/font): titles, buttons, chips, badges, numbers. Body text stays Roboto. */
@OptIn(ExperimentalTextApi::class)
val Display = FontFamily(
    listOf(FontWeight.Medium, FontWeight.SemiBold, FontWeight.Bold, FontWeight.ExtraBold, FontWeight.Black).map { w ->
        Font(R.font.nunito, weight = w, variationSettings = FontVariation.Settings(FontVariation.weight(w.weight)))
    },
)

/** Type scale (design-system.md §3). Sizes are sp, so they follow the system font scale. */
object Type {
    val wordmark = TextStyle(fontFamily = Display, fontWeight = FontWeight.Black, fontSize = 46.sp, lineHeight = 52.sp)
    /** §8.5 Screen title: Nunito black 38 / 41, tracking −0.025 em, up to 2 lines, auto-sized down to 26. */
    val screenTitle = TextStyle(fontFamily = Display, fontWeight = FontWeight.Black, fontSize = 38.sp, lineHeight = 41.sp, letterSpacing = (-0.025).em)
    /** Pushed screens (Chat, Links): same face at 32. */
    val pushedTitle = TextStyle(fontFamily = Display, fontWeight = FontWeight.Black, fontSize = 32.sp, lineHeight = 35.sp, letterSpacing = (-0.025).em)
    /** §8.5 Feed titles on Home: display 17 bold. */
    val feedTitle = TextStyle(fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 17.sp, lineHeight = 22.sp)
    /** §8.5 Sticker label: display 12 black, tracking 0.06 em. */
    val sticker = TextStyle(fontFamily = Display, fontWeight = FontWeight.Black, fontSize = 12.sp, lineHeight = 16.sp, letterSpacing = 0.06.em)
    /** §8.3 Dock label: display 14 extra-bold. */
    val dockLabel = TextStyle(fontFamily = Display, fontWeight = FontWeight.ExtraBold, fontSize = 14.sp, lineHeight = 18.sp)
    val title = TextStyle(fontFamily = Display, fontWeight = FontWeight.Black, fontSize = 28.sp, lineHeight = 34.sp)
    val title2 = TextStyle(fontFamily = Display, fontWeight = FontWeight.Black, fontSize = 22.sp, lineHeight = 28.sp)
    val sectionTitle = TextStyle(fontFamily = Display, fontWeight = FontWeight.Black, fontSize = 20.sp, lineHeight = 26.sp, letterSpacing = (-0.01).em)
    val headline = TextStyle(fontFamily = Display, fontWeight = FontWeight.ExtraBold, fontSize = 17.sp, lineHeight = 22.sp)
    val body = TextStyle(fontSize = 17.sp, lineHeight = 22.sp)
    val bodyStrong = body.copy(fontWeight = FontWeight.SemiBold)
    val subheadline = TextStyle(fontSize = 15.sp, lineHeight = 20.sp)
    val chip = TextStyle(fontFamily = Display, fontWeight = FontWeight.ExtraBold, fontSize = 15.sp, lineHeight = 20.sp)
    val caption = TextStyle(fontFamily = Display, fontWeight = FontWeight.ExtraBold, fontSize = 12.sp, lineHeight = 16.sp)
    val caption2 = TextStyle(fontSize = 11.sp, lineHeight = 14.sp)
}

private val BoolaaTypography = Typography().let { t ->
    t.copy(
        displaySmall = Type.screenTitle,
        headlineMedium = Type.title, headlineSmall = Type.title2,
        titleLarge = Type.title2, titleMedium = Type.headline, titleSmall = Type.chip,
        bodyLarge = Type.body, bodyMedium = Type.subheadline, bodySmall = t.bodySmall,
        labelLarge = Type.chip, labelMedium = Type.caption, labelSmall = Type.caption2,
    )
}

private val BoolaaShapes = Shapes(
    extraSmall = RoundedCornerShape(Radius.small), small = RoundedCornerShape(Radius.small),
    medium = RoundedCornerShape(Radius.field), large = RoundedCornerShape(Radius.card), extraLarge = RoundedCornerShape(Radius.hero),
)

// MARK: Motion

/** Motion tokens (design-system.md §5.2): iOS response/damping springs as Compose stiffness = (2π / response)². */
object Motion {
    /** Press and release of anything tappable. */
    fun <T> press(): FiniteAnimationSpec<T> = spring(dampingRatio = 0.60f, stiffness = 630f)
    /** Selection changes: tabs, chips, segmented pills, counters. */
    fun <T> snappy(): FiniteAnimationSpec<T> = spring(dampingRatio = 0.78f, stiffness = 385f)
    /** Things that pop into existence: messages, badges, staggered cards, RSVP. */
    fun <T> bouncy(): FiniteAnimationSpec<T> = spring(dampingRatio = 0.62f, stiffness = 195f)
    /** Layout and screen changes. */
    fun <T> gentle(): FiniteAnimationSpec<T> = spring(dampingRatio = 0.86f, stiffness = 130f)
    /** Opacity only. */
    fun <T> fade(): FiniteAnimationSpec<T> = tween(200, easing = LinearOutSlowInEasing)

    /** Delay between staggered siblings; only the first [STAGGER_LIMIT] are delayed. */
    const val STAGGER_MS = 45L
    const val STAGGER_LIMIT = 8
    const val CONFETTI_MS = 900
    const val SHIMMER_MS = 1300
    const val SHAKE_MS = 530
    const val COPIED_MS = 1500L
}

@Composable
fun BoolaaTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val c = if (darkTheme) DarkColors else LightColors
    val grape = Hue.grape
    val scheme = if (darkTheme) {
        darkColorScheme(
            primary = grape.text(true), onPrimary = InkOnColor, secondary = Hue.indigo.text(true), onSecondary = InkOnColor,
            background = c.background, onBackground = c.textPrimary, surface = c.card, onSurface = c.textPrimary,
            surfaceVariant = c.field, onSurfaceVariant = c.textSecondary, surfaceContainerHighest = c.field,
            surfaceContainerHigh = c.card, surfaceContainer = c.card, surfaceContainerLow = c.card, surfaceContainerLowest = c.background,
            error = c.dangerText, outline = c.textSecondary, outlineVariant = c.hairline,
            primaryContainer = grape.wash(true), onPrimaryContainer = grape.text(true),
            secondaryContainer = grape.wash(true), onSecondaryContainer = grape.text(true), surfaceTint = Color.Transparent,
        )
    } else {
        lightColorScheme(
            primary = grape.fill, onPrimary = Color.White, secondary = Hue.indigo.fill, onSecondary = Color.White,
            background = c.background, onBackground = c.textPrimary, surface = c.card, onSurface = c.textPrimary,
            surfaceVariant = c.field, onSurfaceVariant = c.textSecondary, surfaceContainerHighest = c.field,
            surfaceContainerHigh = c.card, surfaceContainer = c.card, surfaceContainerLow = c.card, surfaceContainerLowest = c.background,
            error = c.dangerText, outline = c.textSecondary, outlineVariant = c.hairline,
            primaryContainer = grape.wash(false), onPrimaryContainer = grape.text(false),
            secondaryContainer = grape.wash(false), onSecondaryContainer = grape.text(false), surfaceTint = Color.Transparent,
        )
    }
    val resolver = LocalContext.current.contentResolver
    fun animationsOff() = Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f ||
        Settings.Global.getFloat(resolver, Settings.Global.TRANSITION_ANIMATION_SCALE, 1f) == 0f
    var reduceMotion by remember { mutableStateOf(animationsOff()) }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { reduceMotion = animationsOff() }
    CompositionLocalProvider(LocalBoolaaColors provides c, LocalReduceMotion provides reduceMotion) {
        MaterialTheme(colorScheme = scheme, typography = BoolaaTypography, shapes = BoolaaShapes, content = content)
    }
}
