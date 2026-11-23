package com.boolaa.app.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.boolaa.app.R
import com.boolaa.app.core.BoolaaJson
import com.boolaa.app.core.MentionToken
import com.boolaa.app.core.Mentions
import com.boolaa.app.model.MentionCandidate
import com.boolaa.app.ui.components.Avatar
import com.boolaa.app.ui.components.clickableRipple
import com.boolaa.app.ui.theme.BoolaaTheme
import com.boolaa.app.ui.theme.Type
import kotlinx.serialization.builtins.ListSerializer

/**
 * A prefilled chat composer text (not sent): the marketplace "Ask in chat" draft. [mentionUserId] / [mentionName]: the
 * owner whose `@name` starts the text; it becomes a mention token when they're a candidate.
 */
data class ChatDraft(val text: String, val mentionUserId: String? = null, val mentionName: String? = null)

/**
 * The composer: its [value] (text, selection, IME composition) and the mention [tokens] beside it (UTF-16 ranges,
 * see [Mentions.applyEdit]). Survives configuration changes and process death via [Saver].
 */
@Stable
class ComposerState(value: TextFieldValue = TextFieldValue(), tokens: List<MentionToken> = emptyList()) {
    var value by mutableStateOf(value)
        private set
    var tokens by mutableStateOf(tokens)
        private set
    /** The `@` closed with Escape: the list stays closed for it (it reopens only with a new `@`). */
    var dismissedAt by mutableStateOf<Int?>(null)
    /** The active row of the list (↑/↓, Enter). */
    var active by mutableIntStateOf(0)

    val text: String get() = value.text

    /** The open `@` query at the caret, or null. */
    val query: Mentions.Query? get() = if (value.selection.collapsed) Mentions.query(text, value.selection.start, tokens) else null

    /** Every change from the text field: tokens follow the edit (one-unit deletion, typing inside, shifts). */
    fun onValueChange(new: TextFieldValue) {
        val old = value
        val edit = Mentions.applyEdit(old.text, old.selection.min, old.selection.max, tokens, new.text, new.selection.start, new.selection.end)
        value = if (edit.text == new.text) new.copy(selection = TextRange(edit.selectionStart, edit.selectionEnd))
            else TextFieldValue(edit.text, TextRange(edit.selectionStart, edit.selectionEnd))
        tokens = edit.tokens
        val d = dismissedAt
        if (d != null && (d >= value.text.length || value.text[d] != '@')) dismissedAt = null
    }

    /** Replaces everything (sent, restored after a failure). */
    fun set(text: String, tokens: List<MentionToken>) {
        value = TextFieldValue(text, TextRange(text.length))
        this.tokens = tokens.filter { it.end <= text.length }
        dismissedAt = null
        active = 0
    }

    /** A prefilled draft: put in an empty composer, or on a new line after what was typed. */
    fun append(draft: String, token: MentionToken?) {
        if (text.isBlank()) set(draft, listOfNotNull(token))
        else {
            val prefix = text.trimEnd() + "\n"
            val kept = tokens.filter { it.end <= prefix.length }
            set(prefix + draft, kept + listOfNotNull(token?.let { it.copy(start = it.start + prefix.length, end = it.end + prefix.length) }))
        }
    }

    /** Picks [candidate] for [query]: `@<name>` and a space, caret after it. */
    fun pick(query: Mentions.Query, candidate: MentionCandidate) {
        val edit = Mentions.insert(text, tokens, query, value.selection.max, candidate)
        value = TextFieldValue(edit.text, TextRange(edit.selectionStart, edit.selectionEnd))
        tokens = edit.tokens
        active = 0
    }

    companion object {
        private val tokensSerializer = ListSerializer(MentionToken.serializer())
        val Saver = listSaver<ComposerState, Any>(
            save = { listOf(it.value.text, it.value.selection.start, it.value.selection.end, BoolaaJson.json.encodeToString(tokensSerializer, it.tokens)) },
            restore = {
                val text = it[0] as String
                val tokens = runCatching { BoolaaJson.json.decodeFromString(tokensSerializer, it[3] as String) }.getOrDefault(emptyList())
                ComposerState(TextFieldValue(text, TextRange(it[1] as Int, it[2] as Int)), tokens.filter { t -> t.end <= text.length })
            },
        )
    }
}

/** Shows the composer's tokens in the mention style; offsets are unchanged (identity mapping). */
internal class MentionHighlight(private val tokens: List<MentionToken>, private val style: SpanStyle) : VisualTransformation {
    override fun filter(text: AnnotatedString): TransformedText {
        if (tokens.isEmpty()) return TransformedText(text, OffsetMapping.Identity)
        val styled = AnnotatedString.Builder(text).apply {
            tokens.forEach { if (it.start >= 0 && it.end <= text.length && it.start < it.end) addStyle(style, it.start, it.end) }
        }.toAnnotatedString()
        return TransformedText(styled, OffsetMapping.Identity)
    }

    override fun equals(other: Any?) = other is MentionHighlight && other.tokens == tokens && other.style == style
    override fun hashCode() = tokens.hashCode() * 31 + style.hashCode()
}

/** Hardware keys while the list is open (↑/↓ wrap, Enter / numpad Enter picks, Escape closes); updated each composition. */
internal class MentionKeys {
    private var open = false
    private var move: (Int) -> Unit = {}
    private var pick: () -> Unit = {}
    private var dismiss: () -> Unit = {}

    fun update(open: Boolean, count: Int, move: (Int) -> Unit, pick: () -> Unit, dismiss: () -> Unit) {
        this.open = open
        this.move = move
        this.pick = if (count > 0) pick else ({})
        this.dismiss = dismiss
    }

    fun handle(e: KeyEvent): Boolean {
        if (!open) return false
        val handled = when (e.key) {
            Key.DirectionDown -> { if (e.type == KeyEventType.KeyDown) move(1); true }
            Key.DirectionUp -> { if (e.type == KeyEventType.KeyDown) move(-1); true }
            Key.Enter, Key.NumPadEnter -> { if (e.type == KeyEventType.KeyDown) pick(); true }
            Key.Escape -> { if (e.type == KeyEventType.KeyDown) dismiss(); true }
            else -> false
        }
        return handled
    }
}

/**
 * The list above the composer: avatar + name rows (at least 48 dp, at most 5 visible, scrollable), the first active;
 * "No members match" or the 10-mention limit as one non-interactive row. Rows are buttons labelled "Mention {name}";
 * the strip is a polite live region with the count.
 */
@Composable
internal fun MentionStrip(state: Mentions.ListState, active: Int, onPick: (MentionCandidate) -> Unit) {
    val c = BoolaaTheme.colors
    val rows = (state as? Mentions.ListState.Rows)?.candidates.orEmpty()
    val label = stringResource(R.string.chat_mention_list_label)
    val count = when (state) {
        is Mentions.ListState.Rows -> pluralStringResource(R.plurals.chat_mention_count, rows.size, rows.size)
        Mentions.ListState.NoMatch -> stringResource(R.string.chat_mention_no_match)
        Mentions.ListState.Limit -> stringResource(R.string.chat_mention_limit)
        Mentions.ListState.Closed -> ""
    }
    val list = rememberLazyListState()
    LaunchedEffect(active, rows.size) { if (active in rows.indices) list.animateScrollToItem(active) }
    LazyColumn(
        state = list,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp).heightIn(max = (5 * 52).dp)
            .clip(RoundedCornerShape(18.dp)).background(c.card)
            .testTag("mention-strip")
            .semantics {
                contentDescription = label
                stateDescription = count
                liveRegion = LiveRegionMode.Polite
            },
    ) {
        when (state) {
            is Mentions.ListState.Rows -> itemsIndexed(rows, key = { _, it -> it.userId }) { index, candidate ->
                val rowLabel = stringResource(R.string.chat_mention_a11y, candidate.name)
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 52.dp)
                        .background(if (index == active) c.field else Color.Transparent)
                        .clickableRipple(role = Role.Button) { onPick(candidate) }
                        .testTag("mention-row-${candidate.userId}")
                        .clearAndSetSemantics { contentDescription = rowLabel; role = Role.Button }
                        .padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Avatar(candidate.profile, 32.dp)
                    Text(candidate.name, style = Type.body, color = c.textPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            else -> item(key = "note") {
                Text(
                    count, style = Type.body, color = c.textSecondary,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 14.dp, vertical = 14.dp)
                        .testTag(if (state == Mentions.ListState.Limit) "mention-limit" else "mention-no-match"),
                )
            }
        }
    }
}
