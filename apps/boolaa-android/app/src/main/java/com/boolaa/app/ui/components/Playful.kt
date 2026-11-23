package com.boolaa.app.ui.components

import android.graphics.BlurMaskFilter
import android.os.Build
import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.withInfiniteAnimationFrameNanos
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.PressInteraction
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.FloatState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.boolaa.app.R
import com.boolaa.app.ui.theme.BoolaaTheme
import com.boolaa.app.ui.theme.Hue
import com.boolaa.app.ui.theme.LocalReduceMotion
import com.boolaa.app.ui.theme.Motion
import com.boolaa.app.ui.theme.Radius
import com.boolaa.app.ui.theme.Type
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin

// The playful building blocks of the design system (design-system.md §4.5, §5): glossy bubbles, the ambient
// backdrop, confetti, shimmer skeletons, the sliding segmented pill, squish and entrance motion.
// Ambient loops read one frame-clock state inside draw / graphicsLayer blocks only, so a frame costs a redraw,
// never a recomposition, and nothing is allocated per frame. They stop when animations are turned off.

private fun fraction(value: Float): Float = value - floor(value)
private const val TWO_PI = (2 * PI).toFloat()

// MARK: Haptics (design-system.md §5.4)

object Haptics {
    /** Tab change, segment, filter chip, tag, stepper, report reason. */
    fun selection(view: View) = view.perform(if (Build.VERSION.SDK_INT >= 34) HapticFeedbackConstants.SEGMENT_TICK else HapticFeedbackConstants.CLOCK_TICK)
    /** Bubble switch. */
    fun bubble(view: View) = view.perform(HapticFeedbackConstants.CONTEXT_CLICK)
    /** Send message, RSVP tap, add buttons, chat button. */
    fun light(view: View) = view.perform(HapticFeedbackConstants.VIRTUAL_KEY)
    /** RSVP confirmed, invite code copied, refresh finished. */
    fun success(view: View) = view.perform(if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.CONTEXT_CLICK)
    /** Sign-in or form failure. */
    fun error(view: View) = view.perform(if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS)

    private fun View.perform(constant: Int) { performHapticFeedback(constant) }
}

// MARK: Frame clock

/** Seconds since this composable appeared; stays 0 when animations are off (or under a Compose test clock). */
@Composable
fun rememberAmbientTime(): FloatState {
    val time = remember { mutableFloatStateOf(0f) }
    if (!LocalReduceMotion.current) {
        LaunchedEffect(Unit) {
            val start = withInfiniteAnimationFrameNanos { it }
            while (true) withInfiniteAnimationFrameNanos { time.floatValue = (it - start) / 1_000_000_000f }
        }
    }
    return time
}

/** Bobs gently up and down, driven by a shared [time] state. */
fun Modifier.floating(time: FloatState, amplitude: Dp = 5.dp, period: Float = 4f, phase: Float = 0f): Modifier =
    graphicsLayer { translationY = sin((time.floatValue / period + phase) * TWO_PI) * amplitude.toPx() }

// MARK: Shadows

/**
 * Soft tinted shadow (elevation tokens, design-system.md §4.3): a blurred copy of the shape, offset down and
 * clipped out from under the shape itself so translucent surfaces stay clean. Drawn once into the display list.
 */
fun Modifier.glow(color: Color, blur: Dp = 14.dp, y: Dp = 8.dp, radius: Dp? = null): Modifier {
    if (Build.VERSION.SDK_INT < 28 || color.alpha == 0f) return this
    return drawWithCache {
        val r = radius?.toPx() ?: (size.minDimension / 2)
        val dy = y.toPx()
        val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
            this.color = color.toArgb()
            maskFilter = BlurMaskFilter(blur.toPx(), BlurMaskFilter.Blur.NORMAL)
        }
        val shape = android.graphics.Path().apply { addRoundRect(0f, 0f, size.width, size.height, r, r, android.graphics.Path.Direction.CW) }
        onDrawBehind {
            drawIntoCanvas {
                val canvas = it.nativeCanvas
                canvas.save()
                canvas.clipOutPath(shape)
                canvas.drawRoundRect(0f, dy, size.width, size.height + dy, r, r, paint)
                canvas.restore()
            }
        }
    }
}

/** Elevation 1 + surface: a rounded card with a soft purple-tinted shadow and a hairline edge. */
@Composable
fun Modifier.boolaaCard(padding: Dp = 16.dp, radius: Dp = Radius.card, color: Color = BoolaaTheme.colors.card): Modifier {
    val c = BoolaaTheme.colors
    val shape = RoundedCornerShape(radius)
    return this
        .fillMaxWidth()
        .glow(c.cardShadow, blur = 16.dp, y = 8.dp, radius = radius)
        .clip(shape)
        .background(color)
        .drawBehind { drawRoundRect(c.hairline, cornerRadius = CornerRadius(radius.toPx()), style = Stroke(2.dp.toPx())) }
        .padding(padding)
}

/** Dashed rounded outline (invite ticket, empty states, "+ New" chip, photo picker). */
fun Modifier.dashedBorder(color: Color, radius: Dp?, width: Dp = 1.5.dp, dash: Dp = 6.dp, gap: Dp = 6.dp): Modifier = drawWithCache {
    val stroke = Stroke(width.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(dash.toPx(), gap.toPx())))
    val inset = width.toPx() / 2
    val r = (radius?.toPx() ?: (size.minDimension / 2)) - inset
    onDrawWithContent {
        drawContent()
        drawRoundRect(color, Offset(inset, inset), Size(size.width - 2 * inset, size.height - 2 * inset), CornerRadius(r), style = stroke)
    }
}

// MARK: Press

/** Press "squish": scales down with a springy release; a dim when animations are off. */
@Composable
fun Modifier.squish(source: InteractionSource, scale: Float = 0.96f): Modifier {
    val reduce = LocalReduceMotion.current
    val anim = remember { Animatable(1f) }
    LaunchedEffect(source) {
        source.interactions.collectLatest { interaction ->
            when (interaction) {
                is PressInteraction.Press -> anim.animateTo(scale, Motion.press())
                is PressInteraction.Release, is PressInteraction.Cancel -> {
                    // A quick tap still gets a visible squish before it springs back.
                    if (anim.value > (1f + scale) / 2) anim.animateTo(scale, tween(70))
                    anim.animateTo(1f, Motion.press())
                }
            }
        }
    }
    return graphicsLayer {
        val v = anim.value
        if (reduce) alpha = 0.7f + 0.3f * ((v - scale) / (1f - scale)).coerceIn(0f, 1f)
        else { scaleX = v; scaleY = v }
    }
}

/** Clickable with the Material ripple plus the squish (cards and pills 0.96, round icon buttons 0.88). */
@Composable
fun Modifier.clickableRipple(scale: Float = 0.96f, enabled: Boolean = true, role: Role? = null, onClick: () -> Unit): Modifier {
    val source = remember { MutableInteractionSource() }
    return this.squish(source, scale).clickable(interactionSource = source, indication = ripple(), enabled = enabled, role = role, onClick = onClick)
}

/** Error shake: −10, 9, −6, 3, 0 dp over 530 ms, each time [trigger] changes. */
@Composable
fun Modifier.shake(trigger: Int): Modifier {
    val reduce = LocalReduceMotion.current
    val x = remember { Animatable(0f) }
    LaunchedEffect(trigger) {
        if (trigger > 0 && !reduce) {
            x.animateTo(0f, keyframes {
                durationMillis = Motion.SHAKE_MS
                -10f at 70; 9f at 160; -6f at 250; 3f at 330; 0f at Motion.SHAKE_MS
            })
        }
    }
    return graphicsLayer { translationX = x.value.dp.toPx() }
}

/** One-shot bounce (the plus on add buttons, the send arrow, the active tab icon), each time [trigger] changes. */
@Composable
fun Modifier.bounceOn(trigger: Any?, from: Float = 0.6f, enabled: Boolean = true): Modifier {
    val scale = remember { Animatable(1f) }
    var first by remember { mutableStateOf(true) }
    LaunchedEffect(trigger) {
        if (first) { first = false; return@LaunchedEffect }
        if (!enabled) return@LaunchedEffect
        scale.snapTo(from)
        scale.animateTo(1f, Motion.bouncy())
    }
    return graphicsLayer { scaleX = scale.value; scaleY = scale.value }
}

// MARK: Entrance

/** Entrance for list content: fades up with a bouncy spring, staggered by [index] for the first few siblings. */
@Composable
fun Modifier.popIn(index: Int = 0, rise: Dp = 18.dp): Modifier {
    var shown by rememberSaveable { mutableStateOf(false) }
    val progress = remember { Animatable(if (shown) 1f else 0f) }
    LaunchedEffect(Unit) {
        if (!shown) {
            if (index in 1 until Motion.STAGGER_LIMIT) delay(index * Motion.STAGGER_MS)
            progress.animateTo(1f, Motion.bouncy())
            shown = true
        }
    }
    return graphicsLayer {
        val v = progress.value
        alpha = v.coerceIn(0f, 1f)
        translationY = (1f - v) * rise.toPx()
        val s = 0.96f + 0.04f * v
        scaleX = s; scaleY = s
    }
}

/** Pops in from a corner (chat bubbles from their tail, banners, badges): scale [from]→1 plus fade. */
@Composable
fun Modifier.popFrom(enabled: Boolean, originX: Float, originY: Float, from: Float = 0.4f): Modifier {
    if (!enabled) return this
    val progress = remember { Animatable(0f) }
    LaunchedEffect(Unit) { progress.animateTo(1f, Motion.bouncy()) }
    return graphicsLayer {
        val v = progress.value
        alpha = (v * 1.5f).coerceIn(0f, 1f)
        val s = from + (1f - from) * v
        scaleX = s; scaleY = s
        transformOrigin = androidx.compose.ui.graphics.TransformOrigin(originX, originY)
    }
}

/** Digits roll up or down when [count] changes. */
@Composable
fun RollingCount(count: Int, modifier: Modifier = Modifier, content: @Composable (Int) -> Unit) {
    AnimatedContent(
        targetState = count,
        modifier = modifier,
        transitionSpec = {
            val up = targetState > initialState
            (slideInVertically(Motion.snappy()) { if (up) it else -it } + fadeIn(Motion.fade()))
                .togetherWith(slideOutVertically(Motion.snappy()) { if (up) -it else it } + fadeOut(Motion.fade()))
                .using(SizeTransform(clip = false))
        },
        contentAlignment = Alignment.Center,
    ) { content(it) }
}

/** Text that shrinks (down to [minScale]) before it truncates: long translations and large font scales. */
@Composable
fun FitText(
    text: String, style: TextStyle, modifier: Modifier = Modifier, color: Color = Color.Unspecified,
    minScale: Float = 0.7f, maxLines: Int = 1, textAlign: TextAlign? = null,
) {
    Text(
        text, modifier = modifier, color = color, style = style, maxLines = maxLines, overflow = TextOverflow.Ellipsis, textAlign = textAlign,
        autoSize = TextAutoSize.StepBased(minFontSize = style.fontSize * minScale, maxFontSize = style.fontSize),
    )
}

// MARK: Bubbles

/** A glossy bubble: the brand's basic shape. Radial fill, soft rim and a highlight at 10 o'clock. */
@Composable
fun BubbleOrb(hue: Hue, modifier: Modifier = Modifier) {
    Box(modifier.drawWithCache {
        val d = size.minDimension
        val center = Offset(size.width / 2, size.height / 2)
        val brush = Brush.radialGradient(
            listOf(hue.glow, hue.fill, hue.deep),
            center = Offset(center.x - d / 2 + d * 0.35f, center.y - d / 2 + d * 0.3f), radius = d * 0.75f,
        )
        val rimWidth = maxOf(1f, d * 0.03f)
        val rim = Stroke(rimWidth)
        val highlightCenter = Offset(center.x - d * 0.2f, center.y - d * 0.24f)
        val highlightSize = Size(d * 0.26f, d * 0.16f)
        onDrawBehind {
            drawCircle(brush, d / 2, center)
            drawCircle(RimColor, d / 2 - rimWidth / 2, center, style = rim)
            rotate(-35f, highlightCenter) {
                drawOval(HighlightColor, Offset(highlightCenter.x - highlightSize.width / 2, highlightCenter.y - highlightSize.height / 2), highlightSize)
            }
        }
    })
}

private val RimColor = Color.White.copy(alpha = 0.28f)
private val HighlightColor = Color.White.copy(alpha = 0.6f)
private val BackdropHues = listOf(Hue.grape, Hue.coral, Hue.mint, Hue.sunny, Hue.sky, Hue.pink)
private const val BACKDROP_COUNT = 16

/**
 * Ambient backdrop (auth, onboarding): a soft vertical gradient with translucent bubbles drifting upwards.
 * Same per-index formulas as iOS `BubbleBackdrop`; drawn once and still when animations are off.
 */
@Composable
fun BubbleBackdrop(modifier: Modifier = Modifier, intensity: Float = 1f) {
    val c = BoolaaTheme.colors
    val time = rememberAmbientTime()
    Box(modifier.fillMaxSize().drawWithCache {
        val alpha = (if (c.isDark) 0.22f else 0.42f) * intensity
        val sky = Brush.verticalGradient(listOf(c.backdropTop, c.background, c.backdropBottom))
        val radii = FloatArray(BACKDROP_COUNT) { (0.045f + 0.11f * fraction((it + 1) * 0.618f)) * size.width }
        val brushes = Array(BACKDROP_COUNT) {
            val hue = BackdropHues[it % BackdropHues.size]
            val r = radii[it]
            Brush.radialGradient(
                listOf(hue.glow.copy(alpha = alpha * 0.55f), hue.fill.copy(alpha = alpha)),
                center = Offset(-r * 0.3f, -r * 0.35f), radius = r * 1.4f,
            )
        }
        val rimColor = Color.White.copy(alpha = alpha * 0.9f)
        val highlight = Color.White.copy(alpha = min(1f, alpha * 1.5f))
        val rim = Stroke(1.5.dp.toPx())
        onDrawBehind {
            drawRect(sky)
            val t = time.floatValue
            for (index in 0 until BACKDROP_COUNT) {
                val seed = index + 1f
                val r = radii[index]
                val period = 20f + 16f * fraction(seed * 0.37f)
                val progress = fraction(t / period + fraction(seed * 0.754f))
                val sway = sin(t * 0.5f + seed * 1.7f) * 0.03f
                val x = (fraction(seed * 0.283f + 0.11f) + sway) * size.width
                val y = size.height + r - progress * (size.height + 2 * r)
                translate(x, y) {
                    drawCircle(brushes[index], r, Offset.Zero)
                    drawCircle(rimColor, r, Offset.Zero, style = rim)
                    translate(-r * 0.42f, -r * 0.48f) {
                        rotate(-35f, Offset.Zero) { drawOval(highlight, Offset(-r * 0.24f, -r * 0.13f), Size(r * 0.48f, r * 0.26f)) }
                    }
                }
            }
        }
    })
}

/** The logo: one large grape orb with three small friends, each bobbing on its own period. */
@Composable
fun BoolaaLogo(size: Dp, modifier: Modifier = Modifier) {
    val time = rememberAmbientTime()
    Box(modifier.size(size * 1.3f, size * 1.1f), contentAlignment = Alignment.Center) {
        BubbleOrb(Hue.coral, Modifier.size(size * 0.36f).offset(size * 0.42f, -size * 0.34f).floating(time, 4.dp, 3.6f, 0.3f))
        BubbleOrb(Hue.sunny, Modifier.size(size * 0.2f).offset(size * 0.6f, size * 0.02f).floating(time, 5.dp, 4.4f, 0.7f))
        BubbleOrb(Hue.mint, Modifier.size(size * 0.26f).offset(-size * 0.5f, size * 0.26f).floating(time, 4.dp, 5.2f, 0.1f))
        BubbleOrb(Hue.grape, Modifier.size(size).floating(time, 6.dp, 6f))
    }
}

/** Three bubbles with a symbol in the largest: the illustration for empty states and editors. */
@Composable
fun BubbleCluster(icon: ImageVector, hue: Hue, modifier: Modifier = Modifier, size: Dp = 96.dp, still: Boolean = false) {
    val (first, second) = when (hue) {
        Hue.coral -> Hue.sunny to Hue.grape
        Hue.tangerine -> Hue.coral to Hue.mint
        Hue.mint -> Hue.sky to Hue.sunny
        Hue.sky -> Hue.mint to Hue.pink
        else -> Hue.coral to Hue.mint
    }
    val time = if (still) remember { mutableFloatStateOf(0f) } else rememberAmbientTime()
    Box(modifier.size(size * 1.3f, size), contentAlignment = Alignment.Center) {
        BubbleOrb(first, Modifier.size(size * 0.34f).offset(size * 0.46f, -size * 0.3f).floating(time, 4.dp, 3.6f, 0.3f))
        BubbleOrb(second, Modifier.size(size * 0.24f).offset(-size * 0.5f, size * 0.28f).floating(time, 5.dp, 4.4f, 0.7f))
        Box(Modifier.size(size * 0.8f).floating(time, 3.dp, 5f), contentAlignment = Alignment.Center) {
            BubbleOrb(hue, Modifier.fillMaxSize())
            Icon(icon, contentDescription = null, tint = hue.onFill, modifier = Modifier.size(size * 0.36f))
        }
    }
}

// MARK: Confetti

/** Fires a confetti burst from a point in root coordinates; one overlay per screen draws it above the content. */
@Stable
class ConfettiState {
    internal var trigger by mutableIntStateOf(0)
    internal var origin by mutableStateOf(Offset.Zero)
    fun fire(at: Offset) { origin = at; trigger++ }
}

private val ConfettiHues = listOf(Hue.sunny, Hue.coral, Hue.mint, Hue.sky, Hue.pink, Hue.grape)
private const val CONFETTI_PIECES = 22

/** 22 pieces, 900 ms: fast start, ease-out, gravity, fade over the last 300 ms. Draws nothing when animations are off. */
@Composable
fun ConfettiOverlay(state: ConfettiState, modifier: Modifier = Modifier) {
    val reduce = LocalReduceMotion.current
    val elapsed = remember { mutableFloatStateOf(-1f) }
    var rootOffset by remember { mutableStateOf(Offset.Zero) }
    LaunchedEffect(state.trigger) {
        if (state.trigger == 0 || reduce) return@LaunchedEffect
        val duration = Motion.CONFETTI_MS / 1000f
        val start = androidx.compose.runtime.withFrameNanos { it }
        try {
            do {
                elapsed.floatValue = (androidx.compose.runtime.withFrameNanos { it } - start) / 1_000_000_000f
            } while (elapsed.floatValue < duration)
        } finally {
            elapsed.floatValue = -1f
        }
    }
    Canvas(modifier.fillMaxSize().onGloballyPositioned { rootOffset = it.positionInRoot() }) {
        val t = elapsed.floatValue
        val duration = Motion.CONFETTI_MS / 1000f
        if (t < 0f || t >= duration) return@Canvas
        val cx = state.origin.x - rootOffset.x
        val cy = state.origin.y - rootOffset.y
        val unit = 1.dp.toPx()
        val fade = min(1f, (duration - t) / 0.3f)
        val eased = 1f - (1f - t / duration).pow(3)
        for (index in 0 until CONFETTI_PIECES) {
            val seed = index + 1f
            val angle = seed / CONFETTI_PIECES * TWO_PI + fraction(seed * 0.618f) * 0.5f
            val velocity = 110f + 120f * fraction(seed * 0.37f)
            val travel = velocity * eased * 0.55f * unit
            val x = cx + cos(angle) * travel
            val y = cy + sin(angle) * travel + 160f * t * t * unit
            val side = (5f + 4f * fraction(seed * 0.283f)) * unit
            val round = index % 3 == 0
            val h = if (round) side else side * 0.55f
            val color = ConfettiHues[index % ConfettiHues.size].fill
            val degrees = (t * (4f + 6f * fraction(seed * 0.9f)) + seed) * 57.29578f
            translate(x, y) {
                rotate(degrees, Offset.Zero) {
                    if (round) drawOval(color, Offset(-side / 2, -h / 2), Size(side, h), alpha = fade)
                    else drawRoundRect(color, Offset(-side / 2, -h / 2), Size(side, h), CornerRadius(1.5f * unit), alpha = fade)
                }
            }
        }
    }
}

// MARK: Skeletons

/** A soft highlight sweeping left to right every 1.3 s over whatever the content draws. Still when animations are off. */
@Composable
fun Modifier.shimmer(): Modifier {
    if (LocalReduceMotion.current) return this
    val time = rememberAmbientTime()
    val strength = if (BoolaaTheme.colors.isDark) 0.10f else 0.55f
    return graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }.drawWithCache {
        val band = size.width * 0.6f
        val brush = Brush.horizontalGradient(listOf(Color.Transparent, Color.White.copy(alpha = strength), Color.Transparent), 0f, band)
        onDrawWithContent {
            drawContent()
            val phase = fraction(time.floatValue / (Motion.SHIMMER_MS / 1000f))
            translate(left = -band + phase * (size.width + band)) {
                drawRect(brush, size = Size(band, size.height), blendMode = BlendMode.SrcAtop)
            }
        }
    }
}

/** Skeleton of a feed card: icon block and three text lines. */
@Composable
fun SkeletonCard(modifier: Modifier = Modifier) {
    val field = BoolaaTheme.colors.field
    Row(modifier.boolaaCard().shimmer(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.size(44.dp).clip(RoundedCornerShape(14.dp)).background(field))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.size(90.dp, 10.dp).clip(CircleShape).background(field))
            Box(Modifier.fillMaxWidth().height(14.dp).clip(CircleShape).background(field))
            Box(Modifier.size(150.dp, 12.dp).clip(CircleShape).background(field))
        }
    }
}

/** Three skeleton cards, shown by every list while its first load is in flight (no spinners for first loads). */
@Composable
fun SkeletonList(modifier: Modifier = Modifier, count: Int = 3) {
    val loading = stringResource(R.string.loading)
    // Shown only after 300 ms, so fast loads don't flash (docs/boolaa-spec.md "Offline and poor network").
    Column(modifier.clearAndSetSemantics { contentDescription = loading }.testTag("loading"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        DelayedAppearance { Column(verticalArrangement = Arrangement.spacedBy(12.dp)) { repeat(count) { SkeletonCard() } } }
    }
}

/** Skeleton of a Marketplace tile: photo block, title and owner lines. */
@Composable
fun SkeletonTile(modifier: Modifier = Modifier) = DelayedAppearance { SkeletonTileNow(modifier) }

@Composable
private fun SkeletonTileNow(modifier: Modifier) {
    val field = BoolaaTheme.colors.field
    val loading = stringResource(R.string.loading)
    Column(modifier.boolaaCard(0.dp).shimmer().clearAndSetSemantics { contentDescription = loading }) {
        Box(Modifier.fillMaxWidth().height(140.dp).background(field))
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.size(110.dp, 14.dp).clip(CircleShape).background(field))
            Box(Modifier.size(70.dp, 10.dp).clip(CircleShape).background(field))
        }
    }
}

// MARK: Segmented pill

/** Segmented control with a pill that slides between options (snappy) and a selection tick. */
@Composable
fun <T> SegmentedPill(
    options: List<Pair<T, String>>, selected: T, onSelect: (T) -> Unit,
    modifier: Modifier = Modifier, hue: Hue = Hue.grape, tagFor: (T) -> String? = { null },
) {
    val c = BoolaaTheme.colors
    val view = LocalView.current
    val index = options.indexOfFirst { it.first == selected }.coerceAtLeast(0)
    val position by animateFloatAsState(index.toFloat(), Motion.snappy())
    val glowColor = hue.fill.copy(alpha = 0.3f)
    Box(modifier.fillMaxWidth().clip(CircleShape).background(c.field).padding(4.dp)) {
        Row(
            Modifier.fillMaxWidth().drawWithCache {
                val gap = 4.dp.toPx()
                val w = (size.width - gap * (options.size - 1)) / options.size
                val radius = CornerRadius(size.height / 2)
                val dy = 3.dp.toPx()
                onDrawBehind {
                    val x = position * (w + gap)
                    drawRoundRect(glowColor, Offset(x + 2.dp.toPx(), dy), Size(w - 4.dp.toPx(), size.height), radius)
                    drawRoundRect(hue.gradient, Offset(x, 0f), Size(w, size.height), radius)
                }
            },
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            options.forEach { (value, label) ->
                val active = value == selected
                val color by androidx.compose.animation.animateColorAsState(if (active) hue.onFill else c.textSecondary, Motion.fade())
                Box(
                    Modifier.weight(1f).heightIn(min = 40.dp).clip(CircleShape)
                        .clickableRipple(role = Role.Tab) { if (!active) { Haptics.selection(view); onSelect(value) } }
                        .semantics { this.selected = active }
                        .then(tagFor(value)?.let { Modifier.testTag(it) } ?: Modifier)
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                    contentAlignment = Alignment.Center,
                ) { FitText(label, Type.chip, color = color, textAlign = TextAlign.Center) }
            }
        }
    }
}

// MARK: Badges and round buttons

/** Squircle badge with a feature symbol on the feature's gradient. */
@Composable
fun FeatureBadge(icon: ImageVector, hue: Hue, modifier: Modifier = Modifier, size: Dp = 44.dp) {
    Box(modifier.size(size).clip(RoundedCornerShape(size * 0.32f)).background(hue.gradient), contentAlignment = Alignment.Center) {
        Icon(icon, contentDescription = null, tint = hue.onFill, modifier = Modifier.size(size * 0.5f))
    }
}

/** Round icon button: hue wash with a hue-text symbol, or (filled) hue gradient with an onFill symbol. */
@Composable
fun CircleIconButton(
    icon: ImageVector, contentDescription: String, onClick: () -> Unit, modifier: Modifier = Modifier,
    filled: Boolean = false, hue: Hue = Hue.grape, size: Dp = 42.dp, danger: Boolean = false, surface: Boolean = false,
) {
    val c = BoolaaTheme.colors
    val background = when {
        surface -> Modifier.glow(c.cardShadow, 10.dp, 4.dp).clip(CircleShape).background(c.card)
        danger -> Modifier.clip(CircleShape).background(c.dangerText.copy(alpha = 0.12f))
        filled -> Modifier.glow(hue.fill.copy(alpha = 0.35f), 8.dp, 4.dp).clip(CircleShape).background(hue.gradient)
        else -> Modifier.clip(CircleShape).background(hue.wash)
    }
    // The touch target is at least 44dp even when the visible circle is smaller.
    Box(
        modifier.size(maxOf(size, 44.dp)).clip(CircleShape).clickableRipple(scale = 0.88f, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.size(size).then(background), contentAlignment = Alignment.Center) {
            Icon(
                icon, contentDescription = contentDescription,
                tint = when { danger -> c.dangerText; filled -> hue.onFill; else -> hue.text },
                modifier = Modifier.size(size * 0.5f),
            )
        }
    }
}

/** A small bubble orb with an optional white ring, used in chips and under pushed-screen titles. */
@Composable
fun MiniOrb(hue: Hue, size: Dp, modifier: Modifier = Modifier) = BubbleOrb(hue, modifier.size(size))

/** Bottom inset that keeps scroll content clear of the floating dock (112dp) and the system navigation bar. */
@Composable
fun dockClearance(): Dp =
    com.boolaa.app.ui.theme.Brand.tabBarClearance + with(androidx.compose.ui.platform.LocalDensity.current) {
        androidx.compose.foundation.layout.WindowInsets.navigationBars.getBottom(this).toDp()
    }

/** Width helper for rows that keep a fixed gap. */
@Composable
fun Gap(width: Dp) = androidx.compose.foundation.layout.Spacer(Modifier.width(width))

/** Cards shrink to 0.94 and fade to 55% as they scroll off either edge of a lazy list, interpolated with scroll position. */
@Composable
fun Modifier.scrollFade(state: androidx.compose.foundation.lazy.LazyListState, key: Any): Modifier {
    if (LocalReduceMotion.current) return this
    return graphicsLayer {
        val info = state.layoutInfo
        val items = info.visibleItemsInfo
        for (i in items.indices) {
            val item = items[i]
            if (item.key != key) continue
            val hiddenTop = info.viewportStartOffset - item.offset
            val hiddenBottom = item.offset + item.size - info.viewportEndOffset
            val hidden = maxOf(hiddenTop, hiddenBottom, 0).toFloat()
            val f = (hidden / minOf(item.size.toFloat(), 96.dp.toPx())).coerceIn(0f, 1f)
            val s = 1f - 0.06f * f
            scaleX = s; scaleY = s
            alpha = 1f - 0.45f * f
            break
        }
    }
}

/** Pull to refresh with the platform indicator tinted grape; a success haptic when the reload finishes. */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun BoolaaRefreshBox(isRefreshing: Boolean, onRefresh: () -> Unit, modifier: Modifier = Modifier, content: @Composable androidx.compose.foundation.layout.BoxScope.() -> Unit) {
    val state = androidx.compose.material3.pulltorefresh.rememberPullToRefreshState()
    val view = LocalView.current
    var wasRefreshing by remember { mutableStateOf(false) }
    LaunchedEffect(isRefreshing) {
        if (wasRefreshing && !isRefreshing) Haptics.success(view)
        wasRefreshing = isRefreshing
    }
    androidx.compose.material3.pulltorefresh.PullToRefreshBox(
        isRefreshing = isRefreshing, onRefresh = onRefresh, modifier = modifier, state = state,
        indicator = {
            androidx.compose.material3.pulltorefresh.PullToRefreshDefaults.Indicator(
                state = state, isRefreshing = isRefreshing, modifier = Modifier.align(Alignment.TopCenter),
                containerColor = BoolaaTheme.colors.card, color = Hue.grape.fill,
            )
        },
        content = content,
    )
}
