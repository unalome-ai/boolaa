package com.boolaa.app.ui.components

import android.provider.Settings
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.FloatState
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.LinearGradientShader
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shader
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.boolaa.app.R
import com.boolaa.app.core.Cheer
import com.boolaa.app.core.MascotExpression
import com.boolaa.app.core.StickerKind
import com.boolaa.app.ui.theme.BoolaaTheme
import com.boolaa.app.ui.theme.BrandTokens
import com.boolaa.app.ui.theme.Hue
import com.boolaa.app.ui.theme.InkOnColor
import com.boolaa.app.ui.theme.LocalCalm
import com.boolaa.app.ui.theme.LocalReduceMotion
import com.boolaa.app.ui.theme.Motion
import com.boolaa.app.ui.theme.Type
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

// The brand redesign's building blocks (docs/design-system.md §8): the feature band behind headers, display titles,
// sticker labels, the mascot, the cheer toast, the chat orbs and the calm marker for safety surfaces. Same structure
// as iOS `BrandViews.swift`.

private const val TWO_PI_F = (2 * PI).toFloat()

// MARK: Calm (safety surfaces)

/** Marks a safety surface (report, blocked users, delete account, suspended): no mascot inside it (§8.4). */
@Composable
fun CalmSurface(content: @Composable () -> Unit) = CompositionLocalProvider(LocalCalm provides true, content = content)

// MARK: Feature band (§8.1)

/**
 * The header band: [hue]'s fill at 28 % (light) / 22 % (dark) over the background with three decorative circles,
 * opaque over the top 45 % and fading to transparent at the bottom. The tint cross-fades in 400 ms (200 ms under
 * reduced motion) when the tab or bubble changes. Decorative: no semantics, no touches. Size it to the header.
 */
@Composable
fun FeatureBand(hue: Hue, modifier: Modifier = Modifier) {
    val c = BoolaaTheme.colors
    val reduce = LocalReduceMotion.current
    val tint by animateColorAsState(
        BrandTokens.bandTint(hue, c.isDark),
        tween(if (reduce) 200 else BrandTokens.BAND_FADE_MS, easing = FastOutSlowInEasing),
    )
    val circle = if (c.isDark) c.background.copy(alpha = BrandTokens.BAND_CIRCLE_DARK) else Color.White.copy(alpha = BrandTokens.BAND_CIRCLE_LIGHT)
    Box(
        modifier.testTag("feature-band").graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }.drawWithCache {
            val mask = Brush.verticalGradient(0f to Color.Black, BrandTokens.BAND_FADE_START to Color.Black, 1f to Color.Transparent)
            val w = size.width
            val ring = Stroke(2.dp.toPx())
            onDrawBehind {
                drawRect(tint)
                // Ø 220, right edge −70, top −110 (mostly off-screen).
                drawCircle(circle, 110.dp.toPx(), Offset(w + 70.dp.toPx() - 110.dp.toPx(), 0f))
                // Ø 110, right 26 % of the width, top −62.
                drawCircle(circle, 55.dp.toPx(), Offset(w * 0.74f - 55.dp.toPx(), (-62 + 55).dp.toPx()))
                // Ring Ø 30, 2 dp stroke, right 38 %, top 22.
                drawCircle(circle, 15.dp.toPx() - ring.width / 2, Offset(w * 0.62f - 15.dp.toPx(), 37.dp.toPx()), style = ring)
                drawRect(mask, blendMode = BlendMode.DstIn)
            }
        },
    )
}

/** A header with the band behind it: the band is exactly as tall as [content] (§8.1). */
@Composable
fun BandedHeader(hue: Hue, modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
    Box(modifier.fillMaxWidth()) {
        FeatureBand(hue, Modifier.matchParentSize())
        content()
    }
}

// MARK: Display type (§8.5)

/** True when the system's "High contrast text" is on: the Home title gradient becomes plain ink. */
@Composable
fun highTextContrast(): Boolean {
    val resolver = LocalContext.current.contentResolver
    return remember { runCatching { Settings.Secure.getInt(resolver, "high_text_contrast_enabled", 0) == 1 }.getOrDefault(false) }
}

/** CSS `100deg` across the text box: leading → trailing, slightly downwards (y 41 % → 59 %). */
private class TitleGradient(private val colors: List<Color>, private val stops: List<Float>) : ShaderBrush() {
    override fun createShader(size: Size): Shader =
        LinearGradientShader(Offset(0f, size.height * 0.41f), Offset(size.width, size.height * 0.59f), colors, stops)
    override fun equals(other: Any?) = other is TitleGradient && other.colors == colors
    override fun hashCode() = colors.hashCode()
}

/**
 * Screen title: Nunito black 38 (32 on pushed screens), tracking −0.025 em, up to two lines, auto-sized down to 26 (68 %)
 * before it would truncate. [gradient] is for the Home title only (§8.5).
 */
@Composable
fun DisplayTitle(text: String, modifier: Modifier = Modifier, pushed: Boolean = false, gradient: Boolean = false) {
    val c = BoolaaTheme.colors
    val base = if (pushed) Type.pushedTitle else Type.screenTitle
    val plain = !gradient || highTextContrast()
    val style: TextStyle = if (plain) base.copy(color = c.textPrimary) else {
        val stops = BrandTokens.titleGradientStops(c.isDark)
        base.copy(brush = TitleGradient(stops.map { it.second }, stops.map { it.first }))
    }
    FitText(text, style, minScale = 26f / 38f, maxLines = 2, modifier = modifier.semantics { heading() })
}

/**
 * Sticker "kind" label on the Home feed (§8.5): display 12 black uppercase on the feature gradient, a 2 dp white die-cut
 * edge, a soft shadow in the hue and a fixed tilt (none at font scale ≥ 1.5). Plain text for TalkBack.
 */
@Composable
fun StickerLabel(text: String, kind: StickerKind, modifier: Modifier = Modifier) {
    val hue = kind.hue
    val tilt = kind.tilt(LocalDensity.current.fontScale)
    Box(
        modifier.padding(2.dp).graphicsLayer { rotationZ = tilt }
            .glow(hue.fill.copy(alpha = 0.45f), 8.dp, 3.dp)
            .clip(CircleShape).background(BrandTokens.stickerEdge).padding(2.dp)
            .clip(CircleShape).background(hue.gradient)
            .heightIn(min = 22.dp).padding(horizontal = 8.dp, vertical = 2.dp)
            .testTag("sticker-${kind.name.lowercase()}"),
        contentAlignment = Alignment.Center,
    ) { Text(text.uppercase(), style = Type.sticker, color = hue.onFill, maxLines = 1) }
}

// MARK: Mascot (§8.4)

/**
 * The empty-state cluster whose main orb has a face. Drawn in code (orbs + the face on a 100-unit box), hidden from
 * TalkBack (the text beside it carries the meaning), still under reduced motion, and never drawn on a calm surface.
 */
@Composable
fun Mascot(expression: MascotExpression, hue: Hue, modifier: Modifier = Modifier, size: Dp = 96.dp, companions: Boolean = true) {
    if (LocalCalm.current) return
    val reduce = LocalReduceMotion.current
    val time = if (reduce) remember { mutableFloatStateOf(0f) } else rememberAmbientTime()
    val pair = remember(hue) { MascotExpression.companions(hue) }
    Canvas(modifier.size(size).testTag("mascot-${expression.name.lowercase()}").clearAndSetSemantics { }) {
        drawMascot(expression, hue, pair, time, companions)
    }
}

private fun DrawScope.drawMascot(expression: MascotExpression, hue: Hue, pair: Pair<Hue, Hue>, time: FloatState, companions: Boolean) {
    val t = time.floatValue
    val still = t == 0f
    val s = size.minDimension
    val main = s * if (companions) 0.8f else 1f
    fun bob(amp: Dp, period: Float) = if (still) 0f else sin(t / period * TWO_PI_F) * amp.toPx()
    var faceOffset = 0f
    var scale = 1f
    when (expression) {
        MascotExpression.CURIOUS, MascotExpression.WORRIED -> faceOffset = bob(4.dp, 5.2f)
        MascotExpression.SLEEPY -> if (!still) scale = 1f + 0.015f * (1f - cos(t / 4.8f * TWO_PI_F))
        MascotExpression.CHEERING -> if (!still && t < 1.8f) {
            // Hop: up 8 % of the orb and back, 600 ms, three times, then rest.
            val f = (t % 0.6f) / 0.6f
            faceOffset = -main * 0.08f * sin(f * PI.toFloat())
        }
    }
    if (companions) {
        drawOrb(pair.first, Offset(s - s * 0.34f + s * 0.06f + s * 0.17f, -s * 0.02f + s * 0.17f + bob(5.dp, 3.8f)), s * 0.34f)
        drawOrb(pair.second, Offset(s * 0.12f, s - s * 0.24f - s * 0.02f + s * 0.12f + bob(3.dp, 4.6f)), s * 0.24f)
    }
    val origin = if (companions) s * 0.1f else 0f
    translate(origin, origin + faceOffset) {
        scale(scale, Offset(main / 2, main / 2)) {
            drawOrb(hue, Offset(main / 2, main / 2), main)
            drawFace(expression, hue, main, if (still) 1f else MascotExpression.eyeOpenness(t))
        }
    }
}

/** The face on a 100 × 100 box laid over the orb (§8.4 table). */
private fun DrawScope.drawFace(expression: MascotExpression, hue: Hue, d: Float, eyeOpen: Float) {
    val k = d / 100f
    val white = MascotExpression.faceIsWhite(hue)
    val ink = if (white) Color.White else InkOnColor
    val shine = if (white) hue.deep else Color.White
    fun p(x: Float, y: Float) = Offset(x * k, y * k)
    fun ellipse(cx: Float, cy: Float, rx: Float, ry: Float, color: Color) =
        drawOval(color, Offset((cx - rx) * k, (cy - ry) * k), Size(2 * rx * k, 2 * ry * k))
    fun stroke(path: Path, width: Float) = drawPath(path, ink, style = Stroke(width * k, cap = StrokeCap.Round, join = StrokeJoin.Round))
    fun arc(x0: Float, y0: Float, cx: Float, cy: Float, x1: Float, y1: Float) = Path().apply {
        moveTo(x0 * k, y0 * k); quadraticTo(cx * k, cy * k, x1 * k, y1 * k)
    }
    fun openEyes(y: Float, rx: Float, ry: Float) {
        for (x in listOf(35f, 65f)) {
            // Blink: scale vertically around the eye's own centre.
            scale(1f, eyeOpen, p(x, y)) {
                ellipse(x, y, rx, ry, ink)
                ellipse(x + 1.6f, y - 2.4f, 2f, 2f, shine)
            }
        }
    }
    val cheek = BrandTokens.mascotCheek.copy(alpha = if (expression == MascotExpression.CHEERING) 0.65f else 0.45f)
    ellipse(25f, 64f, 6f, 3.5f, cheek)
    ellipse(75f, 64f, 6f, 3.5f, cheek)
    when (expression) {
        MascotExpression.CURIOUS -> {
            openEyes(52f, 5.8f, 7.6f)
            ellipse(50f, 69f, 4.4f, 5f, ink)
        }
        MascotExpression.SLEEPY -> {
            stroke(arc(29f, 54f, 35f, 59f, 41f, 54f), 3.2f)
            stroke(arc(59f, 54f, 65f, 59f, 71f, 54f), 3.2f)
            ellipse(50f, 70f, 3f, 2.2f, ink)
            ellipse(80f, 28f, 3f, 3f, Color.White.copy(alpha = 0.7f))
            ellipse(87f, 18f, 2f, 2f, Color.White.copy(alpha = 0.55f))
        }
        MascotExpression.CHEERING -> {
            stroke(arc(29f, 56f, 35f, 48f, 41f, 56f), 3.2f)
            stroke(arc(59f, 56f, 65f, 48f, 71f, 56f), 3.2f)
            val mouth = arc(38f, 64f, 50f, 82f, 62f, 64f).apply { close() }
            drawPath(mouth, ink)
            stroke(mouth, 2f)
            ellipse(50f, 72.5f, 5f, 2.6f, BrandTokens.mascotTongue)
        }
        MascotExpression.WORRIED -> {
            val brows = Path().apply {
                moveTo(28 * k, 45 * k); lineTo(40 * k, 40 * k)
                moveTo(60 * k, 40 * k); lineTo(72 * k, 45 * k)
            }
            stroke(brows, 2.6f)
            openEyes(55f, 4.6f, 6f)
            stroke(arc(42f, 72f, 50f, 65f, 58f, 72f), 3.2f)
        }
    }
}

// MARK: Cheer toast (§8.4)

/** One cheer on screen. */
@Immutable
data class CheerItem(val cheer: Cheer, val hue: Hue, val bubbleName: String? = null, val id: Long = System.nanoTime())

/** Success moments with the cheering mascot: RSVP confirmed, your first event / post / item, admitted to a bubble. */
object CheerCenter {
    private val _current = MutableStateFlow<CheerItem?>(null)
    val current = _current.asStateFlow()

    /** Shows the toast for 2.8 s; the host announces it politely and plays the success haptic. */
    fun show(cheer: Cheer, bubbleHue: Hue = Hue.grape, bubbleName: String? = null) {
        _current.value = CheerItem(cheer, cheer.hue ?: bubbleHue, bubbleName)
    }

    internal fun clear(item: CheerItem) { _current.compareAndSet(item, null) }
}

@Composable
private fun cheerText(item: CheerItem): String = when (item.cheer) {
    Cheer.GOING -> androidx.compose.ui.res.stringResource(R.string.cheer_going)
    Cheer.FIRST_EVENT -> androidx.compose.ui.res.stringResource(R.string.cheer_first_event)
    Cheer.FIRST_POST -> androidx.compose.ui.res.stringResource(R.string.cheer_first_post)
    Cheer.FIRST_ITEM -> androidx.compose.ui.res.stringResource(R.string.cheer_first_item)
    Cheer.JOINED -> androidx.compose.ui.res.stringResource(R.string.cheer_joined, item.bubbleName.orEmpty())
}

/**
 * The toast: a card pill 96 above the bottom safe area with the cheering mascot (40, no companions) and the text. Pops
 * in (fades under reduced motion), never takes focus and never blocks taps (nothing in it is clickable).
 */
@Composable
fun CheerHost(modifier: Modifier = Modifier) {
    val item by CheerCenter.current.collectAsStateWithLifecycle()
    val reduce = LocalReduceMotion.current
    val view = LocalView.current
    val c = BoolaaTheme.colors
    val shown = item
    val text = shown?.let { cheerText(it) }
    LaunchedEffect(shown) {
        if (shown == null) return@LaunchedEffect
        Haptics.success(view)
        text?.let { announcePolitely(view, it) }
        delay(BrandTokens.CHEER_MS)
        CheerCenter.clear(shown)
    }
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.BottomCenter) {
        AnimatedVisibility(
            shown != null, modifier = Modifier.navigationBarsPadding().padding(bottom = 96.dp, start = 16.dp, end = 16.dp),
            enter = if (reduce) fadeIn(Motion.fade()) else scaleIn(Motion.bouncy(), initialScale = 0.9f) + fadeIn(Motion.fade()),
            exit = fadeOut(Motion.fade()),
        ) {
            val last = remember { arrayOfNulls<Pair<CheerItem, String>>(1) }
            if (shown != null && text != null) last[0] = shown to text
            val (cheer, label) = last[0] ?: return@AnimatedVisibility
            Row(
                Modifier.glow(c.floatingShadow, 20.dp, 10.dp).clip(CircleShape).background(c.card).border(1.dp, c.hairline, CircleShape)
                    .padding(start = 6.dp, end = 20.dp, top = 6.dp, bottom = 6.dp)
                    .testTag("cheer")
                    .clearAndSetSemantics { contentDescription = label },
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Mascot(MascotExpression.CHEERING, cheer.hue, size = 40.dp, companions = false)
                Text(label, style = TextStyle(fontFamily = com.boolaa.app.ui.theme.Display,
                    fontWeight = androidx.compose.ui.text.font.FontWeight.ExtraBold, fontSize = 15.sp, lineHeight = 20.sp),
                    color = c.textPrimary, textAlign = TextAlign.Start)
            }
        }
    }
}

// MARK: Chat orbs (§8.2)

/**
 * Three faint bubble orbs behind the chat thread, clipped to the panel: the bubble's hue and its two companions at 6 %
 * (light) / 10 % (dark). They bob 5–6 dp on 7 / 9 / 8 s sines; under reduced motion they are drawn once and never move.
 */
@Composable
fun ChatOrbs(hue: Hue, modifier: Modifier = Modifier) {
    val dark = BoolaaTheme.colors.isDark
    val reduce = LocalReduceMotion.current
    val time = if (reduce) remember { mutableFloatStateOf(0f) } else rememberAmbientTime()
    val pair = remember(hue) { MascotExpression.companions(hue) }
    Canvas(
        modifier.fillMaxSize().testTag("chat-orbs").graphicsLayer {
            alpha = if (dark) BrandTokens.CHAT_ORB_DARK else BrandTokens.CHAT_ORB_LIGHT
            compositingStrategy = CompositingStrategy.Offscreen
        },
    ) {
        val t = time.floatValue
        fun bob(amp: Dp, period: Float) = sin(t / period * TWO_PI_F) * amp.toPx()
        val w = size.width
        val h = size.height
        // Ø 220 at right −14 % / top 6 %.
        drawOrb(hue, Offset(w + 0.14f * w - 110.dp.toPx(), 0.06f * h + 110.dp.toPx() + bob(6.dp, 7f)), 220.dp.toPx())
        // Ø 110 at left −8 % / bottom 14 %.
        drawOrb(pair.first, Offset(-0.08f * w + 55.dp.toPx(), h - 0.14f * h - 55.dp.toPx() + bob(5.dp, 9f)), 110.dp.toPx())
        // Ø 64 at right 18 % / bottom −4 %.
        drawOrb(pair.second, Offset(w - 0.18f * w - 32.dp.toPx(), h + 0.04f * h - 32.dp.toPx() + bob(5.dp, 8f)), 64.dp.toPx())
    }
}

// MARK: Screenshot aid

/** Debug builds (`--es open mascots`): the four expressions as the app shows them. */
@Composable
fun MascotGallery(onDismiss: () -> Unit) {
    BoolaaSheet(onDismiss, title = androidx.compose.ui.res.stringResource(R.string.app_name), tag = "mascot-gallery") {
        EmptyState(androidx.compose.ui.res.stringResource(R.string.events_empty_mine_title),
            androidx.compose.ui.res.stringResource(R.string.my_events_empty), hue = Hue.coral)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            for (expression in listOf(MascotExpression.SLEEPY, MascotExpression.WORRIED)) {
                androidx.compose.foundation.layout.Column(
                    Modifier.weight(1f).boolaaCard(), horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Mascot(expression, Hue.grape, size = 72.dp)
                    Text(androidx.compose.ui.res.stringResource(R.string.offline_load_failed), style = Type.subheadline,
                        color = BoolaaTheme.colors.textSecondary, textAlign = TextAlign.Center)
                }
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
            Mascot(MascotExpression.CHEERING, Hue.mint)
            Mascot(MascotExpression.CURIOUS, Hue.grape)
            Mascot(MascotExpression.CURIOUS, Hue.indigo)
        }
    }
}
