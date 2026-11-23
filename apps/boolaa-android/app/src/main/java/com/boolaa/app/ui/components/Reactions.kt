package com.boolaa.app.ui.components

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.material3.ripple
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.toggleableState
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.boolaa.app.R
import com.boolaa.app.core.Formats
import com.boolaa.app.core.ReactionSummary
import com.boolaa.app.model.ReactionKind
import com.boolaa.app.ui.theme.BoolaaTheme
import com.boolaa.app.ui.theme.Hue
import com.boolaa.app.ui.theme.Radius
import com.boolaa.app.ui.theme.Type

/** The translated name of a reaction (accessibility labels, picker buttons). */
@Composable
fun reactionName(kind: ReactionKind): String = stringResource(
    when (kind) {
        ReactionKind.LIKE -> R.string.reaction_like
        ReactionKind.LOVE -> R.string.reaction_love
        ReactionKind.LAUGH -> R.string.reaction_laugh
        ReactionKind.WOW -> R.string.reaction_wow
        ReactionKind.SAD -> R.string.reaction_sad
        ReactionKind.THANKS -> R.string.reaction_thanks
    },
)

/** Open state of a reaction picker, so a long press on the item can open the one anchored in its [ReactionBar]. */
@Composable
fun rememberReactionPicker(): MutableState<Boolean> = remember { mutableStateOf(false) }

/**
 * Long press opens the reaction [picker] (TalkBack: the "React" long-click action). With [onClick] the area keeps its
 * tap action and ripple; without, taps do nothing.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun Modifier.longPressToReact(picker: MutableState<Boolean>, onClick: (() -> Unit)? = null): Modifier {
    val label = stringResource(R.string.reaction_react)
    val view = LocalView.current
    return this.combinedClickable(
        interactionSource = remember { MutableInteractionSource() },
        indication = if (onClick != null) ripple() else null,
        onClick = onClick ?: {},
        onLongClick = { Haptics.light(view); picker.value = true },
        onLongClickLabel = label,
    )
}

/**
 * Chips "👍 3" for every reaction with a count (fixed order, yours filled with [hue]), tap toggles yours; then the
 * "Add a reaction" button opening the picker (docs/boolaa-spec.md "Reactions").
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ReactionBar(
    summaries: List<ReactionSummary>,
    onToggle: (ReactionKind) -> Unit,
    modifier: Modifier = Modifier,
    hue: Hue = Hue.grape,
    picker: MutableState<Boolean> = rememberReactionPicker(),
    tag: String = "reactions",
) {
    val c = BoolaaTheme.colors
    val view = LocalView.current
    val locale = LocalConfiguration.current.locales[0]
    val youReacted = stringResource(R.string.reaction_by_you)
    FlowRow(
        modifier.testTag(tag),
        // Each chip sits in a 48dp touch target, which already spaces the rows.
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        itemVerticalAlignment = Alignment.CenterVertically,
    ) {
        summaries.forEach { s ->
            val label = pluralStringResource(R.plurals.reaction_chip, s.count, reactionName(s.kind), s.count) +
                if (s.mine) ", $youReacted" else ""
            val shape = CircleShape
            val source = remember { MutableInteractionSource() }
            // A toggle: "Love: 3 reactions, You reacted" + on/off; double tap adds or removes yours.
            Box(
                Modifier.tapArea(source) { Haptics.selection(view); onToggle(s.kind) }
                    .testTag("$tag-chip-${s.kind.wire}")
                    .clearAndSetSemantics {
                        contentDescription = label; role = Role.Switch
                        toggleableState = androidx.compose.ui.state.ToggleableState(s.mine)
                    },
                contentAlignment = Alignment.Center,
            ) {
                Row(
                    Modifier.heightIn(min = 34.dp)
                        .tapVisual(source, shape, Modifier.background(if (s.mine) hue.wash else c.field)
                            .border(if (s.mine) 1.5.dp else 1.dp, if (s.mine) hue.fill else c.hairline, shape), scale = 0.9f)
                        .padding(horizontal = 10.dp, vertical = 5.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text(s.kind.emoji, fontSize = 15.sp)
                    Text(Formats.number(s.count.toLong(), locale), style = Type.caption, color = if (s.mine) hue.text else c.textSecondary)
                }
            }
        }
        Box {
            val addLabel = stringResource(R.string.reaction_add)
            val addSource = remember { MutableInteractionSource() }
            Box(
                Modifier.tapArea(addSource, role = Role.Button) { picker.value = true }
                    .semantics { contentDescription = addLabel }
                    .testTag("$tag-add"),
                contentAlignment = Alignment.Center,
            ) {
                Box(Modifier.size(34.dp).tapVisual(addSource, CircleShape, Modifier.background(c.field), scale = 0.88f), contentAlignment = Alignment.Center) {
                    Icon(BoolaaIcons.AddReaction, contentDescription = null, tint = c.textSecondary, modifier = Modifier.size(18.dp))
                }
            }
            ReactionPickerMenu(picker.value, onDismiss = { picker.value = false }, onPick = { picker.value = false; onToggle(it) }, tag = tag)
        }
    }
}

/** A dropdown holding the six reactions in one row (optionally with more menu items below, e.g. Report / Delete). */
@Composable
fun ReactionPickerMenu(
    expanded: Boolean, onDismiss: () -> Unit, onPick: (ReactionKind) -> Unit, tag: String = "reactions",
    content: @Composable () -> Unit = {},
) {
    val c = BoolaaTheme.colors
    DropdownMenu(expanded = expanded, onDismissRequest = onDismiss, shape = RoundedCornerShape(Radius.field), containerColor = c.card) {
        ReactionPickerRow(onPick, tag)
        content()
    }
}

@Composable
fun ReactionPickerRow(onPick: (ReactionKind) -> Unit, tag: String = "reactions") {
    val view = LocalView.current
    Row(Modifier.padding(horizontal = 6.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        ReactionKind.entries.forEach { kind ->
            val name = reactionName(kind)
            Box(
                Modifier.size(48.dp).clip(CircleShape)
                    .clickableRipple(scale = 0.85f) { Haptics.light(view); onPick(kind) }
                    .testTag("$tag-pick-${kind.wire}")
                    .clearAndSetSemantics { contentDescription = name; role = Role.Button },
                contentAlignment = Alignment.Center,
            ) { Text(kind.emoji, fontSize = 24.sp) }
        }
    }
}
