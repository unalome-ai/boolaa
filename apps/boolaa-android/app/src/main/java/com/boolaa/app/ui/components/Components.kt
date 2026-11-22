package com.boolaa.app.ui.components

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.boolaa.app.R
import com.boolaa.app.model.UserProfile
import com.boolaa.app.ui.theme.BoolaaTheme
import com.boolaa.app.ui.theme.Brand
import com.boolaa.app.ui.theme.Display
import com.boolaa.app.ui.theme.Hue
import com.boolaa.app.ui.theme.Motion
import com.boolaa.app.ui.theme.Radius
import com.boolaa.app.ui.theme.Type

private val RainbowRing = Brush.sweepGradient(listOf(Hue.grape.fill, Hue.pink.fill, Hue.sunny.fill, Hue.mint.fill, Hue.sky.fill, Hue.grape.fill))

/**
 * Circle avatar with a ring in the card colour. With a photo: the photo. Without: initials on the gradient of
 * the person's own hue (derived from their id, like bubble colours). [rainbow] adds the profile sheet's ring.
 */
@Composable
fun Avatar(user: UserProfile?, size: Dp, modifier: Modifier = Modifier, rainbow: Boolean = false) {
    val name = user?.name.orEmpty()
    val hue = Hue.forId(user?.id)
    val ring = if (size < 32.dp) 1.5.dp else 2.dp
    Box(
        modifier
            .size(size)
            .then(if (rainbow) Modifier.border(3.dp, RainbowRing, CircleShape).padding(5.dp) else Modifier)
            .clip(CircleShape)
            .background(BoolaaTheme.colors.card)
            .padding(ring)
            .clip(CircleShape)
            .background(hue.gradient),
        contentAlignment = Alignment.Center,
    ) {
        val avatar = user?.avatar
        if (!avatar.isNullOrBlank()) {
            AsyncImage(model = avatar, contentDescription = name, contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize().clip(CircleShape))
        } else {
            // Fixed to the circle, not the font scale: the initials must always fit their badge.
            Text(
                initials(name), color = hue.onFill, fontFamily = Display, fontWeight = FontWeight.ExtraBold,
                fontSize = with(androidx.compose.ui.platform.LocalDensity.current) { (size * 0.38f).toSp() }, maxLines = 1,
                modifier = Modifier.clearAndSetSemantics { },
            )
        }
    }
}

/**
 * A bubble's logo as a circle: the photo when it has one (center-cropped), otherwise the bubble's own glossy orb in
 * its id-derived hue, with initials on larger sizes ([showInitials]). The photo is described as "Photo of <name>".
 */
@Composable
fun BubbleLogo(bubbleId: String, name: String, logo: String?, size: Dp, modifier: Modifier = Modifier, showInitials: Boolean = size >= 32.dp) {
    val hue = Hue.forId(bubbleId)
    Box(modifier.size(size).clip(CircleShape), contentAlignment = Alignment.Center) {
        if (!logo.isNullOrBlank()) {
            AsyncImage(
                model = logo, contentDescription = stringResource(R.string.bubble_photo_of, name),
                contentScale = ContentScale.Crop,
                modifier = Modifier.matchParentSize().clip(CircleShape).background(hue.wash).testTag("bubble-logo-image"),
            )
        } else {
            BubbleOrb(hue, Modifier.matchParentSize())
            if (showInitials) {
                Text(
                    initials(name), color = hue.onFill, fontFamily = Display, fontWeight = FontWeight.ExtraBold,
                    fontSize = with(androidx.compose.ui.platform.LocalDensity.current) { (size * 0.36f).toSp() }, maxLines = 1,
                    modifier = Modifier.clearAndSetSemantics { },
                )
            }
        }
    }
}

fun initials(name: String): String =
    name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }.take(2).joinToString("") { it.first().uppercase() }
        .ifEmpty { "?" }

@Composable
fun displayName(user: UserProfile?): String =
    user?.name?.takeIf { it.isNotBlank() } ?: stringResource(R.string.someone)

/** Filter / tag chip: field fill when inactive; hue gradient, onFill text and glow when active. */
@Composable
fun BoolaaChip(title: String, active: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier, hue: Hue = Hue.grape) {
    val c = BoolaaTheme.colors
    val view = LocalView.current
    val fill by animateFloatAsState(if (active) 1f else 0f, Motion.snappy())
    val textColor by animateColorAsState(if (active) hue.onFill else c.textSecondary, Motion.fade())
    Box(
        modifier
            .heightIn(min = 38.dp)
            .then(if (active) Modifier.glow(hue.fill.copy(alpha = 0.35f), 8.dp, 4.dp) else Modifier)
            .clip(CircleShape)
            .background(c.field)
            .drawBehind { drawRect(hue.gradient, alpha = fill.coerceIn(0f, 1f)) }
            .clickableRipple(role = Role.Tab) { Haptics.selection(view); onClick() }
            .semantics { selected = active }
            .padding(horizontal = 16.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) { Text(title, color = textColor, style = Type.chip, maxLines = 1, overflow = TextOverflow.Ellipsis) }
}

/** Section title with a rolling counter badge and an optional action that wraps below when translations run long. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SectionHeader(title: String, count: Int? = null, modifier: Modifier = Modifier, hue: Hue = Hue.grape, action: (@Composable () -> Unit)? = null) {
    FlowRow(
        modifier.fillMaxWidth().padding(top = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        Row(Modifier.weight(1f, fill = action != null).heightIn(min = 40.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(title, style = Type.sectionTitle, color = BoolaaTheme.colors.textPrimary, modifier = Modifier.weight(1f, fill = false).semantics { heading() })
            if (count != null) {
                Spacer(Modifier.width(8.dp))
                Box(Modifier.clip(CircleShape).background(hue.wash).padding(horizontal = 9.dp, vertical = 3.dp)) {
                    RollingCount(count) { Text(it.toString(), color = hue.text, style = Type.caption) }
                }
            }
        }
        action?.invoke()
    }
}

/** "Add" capsule in the feature's gradient; the plus bounces on tap. */
@Composable
fun AddButton(label: String, onClick: () -> Unit, modifier: Modifier = Modifier, hue: Hue = Hue.grape) {
    val view = LocalView.current
    var taps by remember { mutableIntStateOf(0) }
    Row(
        modifier
            .heightIn(min = 40.dp)
            .glow(hue.fill.copy(alpha = 0.4f), 10.dp, 5.dp)
            .clip(CircleShape)
            .background(hue.gradient)
            .clickableRipple(role = Role.Button) { taps++; Haptics.light(view); onClick() }
            .testTag("add-button")
            .padding(start = 14.dp, end = 16.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(Icons.Rounded.Add, contentDescription = null, tint = hue.onFill, modifier = Modifier.size(20.dp).bounceOn(taps))
        Text(label, color = hue.onFill, style = Type.chip, maxLines = 1)
    }
}

/** A block in the feature's wash with a dashed outline and a floating bubble cluster (one per empty section). */
@Composable
fun EmptyState(icon: ImageVector, title: String, message: String, modifier: Modifier = Modifier, hue: Hue = Hue.grape) {
    Column(
        modifier.fillMaxWidth().popIn()
            .clip(RoundedCornerShape(Radius.card)).background(hue.wash.copy(alpha = hue.wash.alpha * 0.6f))
            .dashedBorder(hue.text.copy(alpha = 0.25f), Radius.card)
            .padding(horizontal = 24.dp, vertical = 28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        BubbleCluster(icon, hue, size = 84.dp, modifier = Modifier.padding(bottom = 6.dp))
        Text(title, style = Type.headline, color = BoolaaTheme.colors.textPrimary, textAlign = TextAlign.Center)
        Text(message, style = Type.subheadline, color = BoolaaTheme.colors.textSecondary, textAlign = TextAlign.Center)
    }
}

/** A quiet one-line hint card for an empty sub-section. */
@Composable
fun HintCard(text: String, modifier: Modifier = Modifier) {
    Text(text, color = BoolaaTheme.colors.textSecondary, style = Type.subheadline, modifier = modifier.boolaaCard())
}

/** First-load placeholder: skeleton cards, never a spinner. */
@Composable
fun LoadingBox(modifier: Modifier = Modifier) = SkeletonList(modifier)

/**
 * Full-width pill. Playful by default (hue gradient, glow, squish); [calm] is flat and still for safety flows;
 * [danger] is the flat destructive button.
 */
@Composable
fun PrimaryButton(
    text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, loading: Boolean = false,
    hue: Hue = Hue.grape, calm: Boolean = false, danger: Boolean = false,
) {
    val active = enabled && !loading
    val flat = calm || danger
    val shape = RoundedCornerShape(if (flat) Radius.field else 27.dp)
    val onFill = if (danger) Color.White else hue.onFill
    val solid = if (danger) Brand.danger else hue.fill
    val fillAlpha by animateFloatAsState(if (enabled) 1f else if (danger) 0.35f else 0.38f, Motion.fade())
    val brush: Brush = if (flat) SolidColor(solid) else hue.gradient
    Box(
        modifier
            .fillMaxWidth()
            .heightIn(min = 54.dp)
            .then(if (active && !flat) Modifier.glow(hue.fill.copy(alpha = 0.38f), 14.dp, 8.dp, 27.dp) else Modifier)
            .clip(shape)
            .drawBehind { drawRect(brush, alpha = fillAlpha) }
            .then(if (enabled && !flat) Modifier.border(1.dp, Color.White.copy(alpha = 0.22f), shape) else Modifier)
            .clickableRipple(scale = if (flat) 1f else 0.96f, enabled = active, role = Role.Button, onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        if (loading) CircularProgressIndicator(color = onFill, strokeWidth = 2.5.dp, modifier = Modifier.size(22.dp))
        else Text(text, color = onFill.copy(alpha = if (enabled) 1f else 0.85f), style = Type.headline, textAlign = TextAlign.Center)
    }
}

/** Full-width pill with a soft wash instead of a fill; [danger] is the soft destructive variant (Leave bubble). */
@Composable
fun SecondaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, hue: Hue = Hue.grape, enabled: Boolean = true, danger: Boolean = false) {
    val c = BoolaaTheme.colors
    Box(
        modifier
            .heightIn(min = 54.dp)
            .clip(CircleShape)
            .background(if (danger) c.dangerText.copy(alpha = if (c.isDark) 0.16f else 0.10f) else hue.wash)
            .clickableRipple(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) { Text(text, color = if (danger) c.dangerText else hue.text, style = Type.headline, textAlign = TextAlign.Center) }
}

/** Text field: soft fill, radius 16 and a 2dp grape ring while focused. The floating label is the Material idiom. */
@Composable
fun BoolaaTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    singleLine: Boolean = true,
    minLines: Int = 1,
    keyboardType: KeyboardType = KeyboardType.Text,
    isPassword: Boolean = false,
    enabled: Boolean = true,
) {
    val c = BoolaaTheme.colors
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    val ring by animateColorAsState(if (focused) Hue.grape.fill else Color.Transparent, Motion.fade())
    val shape = RoundedCornerShape(Radius.field)
    TextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        singleLine = singleLine,
        minLines = minLines,
        enabled = enabled,
        interactionSource = source,
        textStyle = Type.body,
        keyboardOptions = KeyboardOptions(keyboardType = if (isPassword) KeyboardType.Password else keyboardType),
        visualTransformation = if (isPassword) PasswordVisualTransformation() else VisualTransformation.None,
        shape = shape,
        colors = TextFieldDefaults.colors(
            focusedContainerColor = c.field, unfocusedContainerColor = c.field, disabledContainerColor = c.field,
            focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
            disabledIndicatorColor = Color.Transparent, focusedLabelColor = Hue.grape.text, unfocusedLabelColor = c.textSecondary,
            disabledLabelColor = c.textSecondary, disabledTextColor = c.textSecondary, cursorColor = Hue.grape.fill,
            focusedTextColor = c.textPrimary, unfocusedTextColor = c.textPrimary,
        ),
        modifier = modifier.fillMaxWidth().border(2.dp, ring, shape),
    )
}

/** Translated error dialog; [message] is already user-facing. */
@Composable
fun ErrorDialog(message: String?, onDismiss: () -> Unit) {
    if (message == null) return
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.ok), style = Type.headline, color = Hue.grape.text) } },
        title = { Text(stringResource(R.string.error_title), style = Type.title2) },
        text = { Text(message, style = Type.body) },
        shape = RoundedCornerShape(Radius.hero), containerColor = BoolaaTheme.colors.card,
    )
}

@Composable
fun ConfirmDialog(title: String, message: String, confirm: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = { onDismiss(); onConfirm() }, modifier = Modifier.testTag("confirm-dialog-confirm")) {
                Text(confirm, style = Type.headline, color = BoolaaTheme.colors.dangerText)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel), style = Type.headline, color = Hue.grape.text) } },
        title = { Text(title, style = Type.title2) },
        text = { Text(message, style = Type.body) },
        shape = RoundedCornerShape(Radius.hero), containerColor = BoolaaTheme.colors.card,
    )
}

@Composable
fun RemoteImage(url: String?, modifier: Modifier = Modifier, contentDescription: String? = null) {
    AsyncImage(
        model = url,
        contentDescription = contentDescription,
        contentScale = ContentScale.Crop,
        modifier = modifier.background(BoolaaTheme.colors.field),
    )
}

/** Capsule badge in a hue's gradient (Free, Trade, Owner) or, with [danger], a quiet red wash (Blocked). */
@Composable
fun StatusBadge(text: String, modifier: Modifier = Modifier, hue: Hue = Hue.grape, icon: ImageVector? = null, danger: Boolean = false) {
    val c = BoolaaTheme.colors
    val content = if (danger) c.dangerText else hue.onFill
    Row(
        modifier.clip(CircleShape)
            .then(if (danger) Modifier.background(c.dangerText.copy(alpha = 0.14f)) else Modifier.background(hue.gradient))
            .padding(horizontal = 10.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (icon != null) Icon(icon, contentDescription = null, tint = content, modifier = Modifier.size(14.dp))
        Text(text, color = content, style = Type.caption, maxLines = 1)
    }
}

/** Icon that morphs to another (copy → check, plus → check) with a small pop. */
@Composable
fun MorphIcon(icon: ImageVector, tint: Color, modifier: Modifier = Modifier, contentDescription: String? = null) {
    AnimatedContent(
        icon, modifier = modifier, contentAlignment = Alignment.Center,
        transitionSpec = { (scaleIn(Motion.bouncy(), initialScale = 0.4f) + fadeIn(Motion.fade())) togetherWith (scaleOut(targetScale = 0.4f) + fadeOut(Motion.fade())) },
    ) { Icon(it, contentDescription = contentDescription, tint = tint, modifier = Modifier.fillMaxWidth()) }
}

/** Platform bottom sheet in the app background: radius 32, grabber, a display title, scrollable padded content. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BoolaaSheet(onDismiss: () -> Unit, title: String, tag: String? = null, spacing: Dp = 14.dp, content: @Composable ColumnScope.() -> Unit) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = BoolaaTheme.colors.background,
        shape = RoundedCornerShape(topStart = Radius.hero, topEnd = Radius.hero),
    ) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).imePadding().padding(horizontal = 20.dp).padding(bottom = 32.dp)
                .then(if (tag != null) Modifier.testTag(tag) else Modifier),
            verticalArrangement = Arrangement.spacedBy(spacing),
        ) {
            Text(title, style = Type.title2, color = BoolaaTheme.colors.textPrimary, modifier = Modifier.semantics { heading() })
            content()
        }
    }
}

/** Pushed-screen header (Chat, Links): round back button, title and the bubble name with its orb. */
@Composable
fun PushedHeader(title: String, bubbleName: String, bubbleHue: Hue, onBack: () -> Unit, backTag: String, modifier: Modifier = Modifier) {
    Row(modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        CircleIconButton(BoolaaIcons.Back, stringResource(R.string.back), onBack, Modifier.testTag(backTag), surface = true, size = 44.dp)
        Column(Modifier.padding(start = 12.dp)) {
            FitText(title, Type.title, color = BoolaaTheme.colors.textPrimary, modifier = Modifier.testTag("screen-title").semantics { heading() })
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                MiniOrb(bubbleHue, 12.dp)
                Text(bubbleName, style = Type.chip.copy(fontSize = 14.sp), color = bubbleHue.text, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.widthIn(max = 260.dp))
            }
        }
    }
}
