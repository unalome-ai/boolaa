package com.boolaa.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.boolaa.app.R
import com.boolaa.app.core.Formats
import com.boolaa.app.core.MascotExpression
import com.boolaa.app.core.RequestRules
import com.boolaa.app.core.RequesterView
import com.boolaa.app.model.ItemKind
import com.boolaa.app.model.ItemRequest
import com.boolaa.app.model.RequestStatus
import com.boolaa.app.ui.theme.BoolaaTheme
import com.boolaa.app.ui.theme.Hue
import com.boolaa.app.ui.theme.Radius
import com.boolaa.app.ui.theme.Type

// "I want it" UI shared by Food and Marketplace (docs/boolaa-spec.md "Requests and picking", UI rules).

/** "3 requests" pill next to the availability badge (everyone; the owner's opens the Requests sheet). */
@Composable
fun RequestCountPill(count: Int, hue: Hue, modifier: Modifier = Modifier, onClick: (() -> Unit)? = null) {
    if (count <= 0) return
    val text = pluralStringResource(R.plurals.requests_count, count, count)
    val c = BoolaaTheme.colors
    Row(
        modifier.clip(CircleShape).background(c.card.copy(alpha = 0.92f))
            .then(if (onClick != null) Modifier.clickableRipple(role = Role.Button, onClick = onClick) else Modifier)
            .testTag("request-count")
            .padding(horizontal = 10.dp, vertical = 4.dp)
            .clearAndSetSemantics { contentDescription = text; if (onClick != null) role = Role.Button },
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Icon(BoolaaIcons.Pending, contentDescription = null, tint = hue.text, modifier = Modifier.size(13.dp))
        Text(text, style = Type.caption, color = hue.text, maxLines = 1)
    }
}

/** "Reserved for you" (requester) / "It's yours" (received) / "Reserved for {name}" (owner): replaces the plain badge. */
@Composable
fun RequestBadge(text: String, hue: Hue, tag: String, modifier: Modifier = Modifier) {
    StatusBadge(text, modifier.testTag(tag), hue = hue, icon = BoolaaIcons.Reserved)
}

/** A compact full-width pill button (48dp target) in the feature colour; [filled] for the primary "I want it". */
@Composable
fun FeaturePillButton(
    text: String, hue: Hue, onClick: () -> Unit, modifier: Modifier = Modifier, filled: Boolean = true,
    a11yLabel: String? = null, loading: Boolean = false, enabled: Boolean = true,
) {
    val source = remember { MutableInteractionSource() }
    Box(
        modifier.fillMaxWidth().tapArea(source, enabled = enabled && !loading, role = Role.Button, onClick = onClick)
            .then(if (a11yLabel != null) Modifier.semantics { contentDescription = a11yLabel } else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 40.dp)
                .tapVisual(source, CircleShape, if (filled) Modifier.background(hue.gradient) else Modifier.background(hue.wash))
                .padding(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
        ) {
            if (loading) CircularProgressIndicator(color = if (filled) hue.onFill else hue.text, strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
            else Text(text, style = Type.caption.copy(fontWeight = FontWeight.Bold), color = if (filled) hue.onFill else hue.text,
                maxLines = 2, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
        }
    }
}

/**
 * The bottom action row on someone else's item: "I want it", "Requested" + "Withdraw request", "Reserved · you're on
 * the list", "Withdraw request" under "Reserved for you" (asks first), or "Someone else got it".
 */
@Composable
fun RequesterActions(
    view: RequesterView, itemTitle: String, ownerName: String, hue: Hue, busy: Boolean,
    onWant: () -> Unit, onWithdraw: () -> Unit, modifier: Modifier = Modifier,
) {
    val c = BoolaaTheme.colors
    var confirm by rememberSaveable { mutableStateOf(false) }
    val withdrawLabel = stringResource(R.string.requests_action_a11y, stringResource(R.string.requests_withdraw), itemTitle)
    when (view) {
        RequesterView.NONE, RequesterView.YOURS -> Unit
        RequesterView.I_WANT_IT -> FeaturePillButton(
            stringResource(R.string.requests_i_want_it), hue, onWant, modifier.testTag("i-want-it"),
            a11yLabel = stringResource(R.string.requests_i_want_it_a11y, itemTitle), loading = busy,
        )
        RequesterView.REQUESTED, RequesterView.ON_LIST, RequesterView.RESERVED_FOR_YOU -> Row(
            modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (view != RequesterView.RESERVED_FOR_YOU) {
                Row(
                    Modifier.weight(1f, fill = false).clip(CircleShape).border(1.dp, hue.text.copy(alpha = 0.6f), CircleShape)
                        .padding(horizontal = 10.dp, vertical = 6.dp).semantics { liveRegion = LiveRegionMode.Polite }.testTag("request-status"),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Icon(BoolaaIcons.Check, contentDescription = null, tint = hue.text, modifier = Modifier.size(14.dp))
                    Text(stringResource(if (view == RequesterView.ON_LIST) R.string.requests_on_list else R.string.requests_requested),
                        style = Type.caption, color = hue.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
            TextButton(
                onClick = { if (view == RequesterView.RESERVED_FOR_YOU) confirm = true else onWithdraw() }, enabled = !busy,
                modifier = Modifier.heightIn(min = 48.dp).semantics { contentDescription = withdrawLabel }.testTag("withdraw-request"),
            ) { Text(stringResource(R.string.requests_withdraw), style = Type.caption.copy(fontWeight = FontWeight.Bold), color = c.textSecondary) }
        }
        RequesterView.MISSED -> Text(stringResource(R.string.requests_someone_else), style = Type.caption, color = c.textSecondary,
            modifier = modifier.padding(vertical = 4.dp).testTag("request-missed"))
    }
    if (confirm) {
        ConfirmDialog(
            stringResource(R.string.requests_withdraw_confirm_title), stringResource(R.string.requests_withdraw_confirm_body, ownerName),
            stringResource(R.string.requests_withdraw), onConfirm = onWithdraw, onDismiss = { confirm = false },
        )
    }
}

/** Owner: "Requests · 3" (opens the sheet), or the muted "No requests yet." at 0. */
@Composable
fun OwnerRequestsButton(count: Int, hue: Hue, onClick: () -> Unit, modifier: Modifier = Modifier) {
    if (count > 0) {
        FeaturePillButton(stringResource(R.string.requests_button, count), hue, onClick, modifier.testTag("owner-requests"), filled = false)
    } else {
        Text(stringResource(R.string.requests_none_yet), style = Type.caption, color = BoolaaTheme.colors.textSecondary,
            modifier = modifier.padding(vertical = 4.dp).testTag("owner-no-requests"))
    }
}

/** "I want it": an optional note (≤ 200, live counter), Send request / Cancel. */
@Composable
fun IWantItSheet(hue: Hue, busy: Boolean, onDismiss: () -> Unit, onSend: (String) -> Unit) {
    var note by rememberSaveable { mutableStateOf("") }
    BoolaaSheet(onDismiss, stringResource(R.string.requests_i_want_it), tag = "i-want-it-sheet", spacing = 12.dp) {
        BoolaaTextField(note, { note = it.take(RequestRules.NOTE_MAX) }, stringResource(R.string.requests_note_placeholder),
            Modifier.testTag("request-note"), singleLine = false, minLines = 2)
        Text(stringResource(R.string.requests_note_counter, note.length, RequestRules.NOTE_MAX), style = Type.caption2, color = BoolaaTheme.colors.textSecondary,
            textAlign = TextAlign.End, modifier = Modifier.fillMaxWidth().testTag("request-note-counter"))
        PrimaryButton(stringResource(R.string.requests_send), onClick = { onSend(note) }, loading = busy, hue = hue,
            modifier = Modifier.testTag("request-send"))
        SecondaryButton(stringResource(R.string.cancel), onClick = onDismiss, hue = hue, modifier = Modifier.fillMaxWidth())
    }
}

/**
 * The owner's Requests sheet: oldest first, the pick pinned on top with "Your pick", "Mark as handed over" and
 * "Undo pick"; "Pick" / "Pick instead" on the others. Updates live (the rows come from the screen's RequestStore).
 */
@Composable
fun RequestsSheet(
    kind: ItemKind, itemTitle: String, rows: List<ItemRequest>, busy: Boolean, hue: Hue,
    onPick: (ItemRequest) -> Unit, onUndo: () -> Unit, onHandOver: () -> Unit, onDismiss: () -> Unit,
) {
    val c = BoolaaTheme.colors
    val locale = LocalConfiguration.current.locales[0]
    val pick = rows.firstOrNull { it.status == RequestStatus.PICKED }
    var confirmHandOver by rememberSaveable { mutableStateOf(false) }
    BoolaaSheet(onDismiss, stringResource(R.string.requests_title), tag = "requests-sheet", spacing = 10.dp) {
        if (rows.isEmpty()) {
            Column(Modifier.fillMaxWidth().padding(vertical = 16.dp), horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Mascot(MascotExpression.CURIOUS, hue, size = 80.dp, companions = false)
                Text(stringResource(R.string.requests_none_yet), style = Type.headline, color = c.textPrimary, textAlign = TextAlign.Center)
                Text(stringResource(R.string.requests_none_yet_hint), style = Type.subheadline, color = c.textSecondary, textAlign = TextAlign.Center)
            }
        }
        rows.forEach { r ->
            val name = displayName(r.requester)
            val picked = r.status == RequestStatus.PICKED
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(Radius.card)).background(if (picked) hue.wash else c.card)
                    .padding(12.dp).testTag("request-row-${r.requesterId}"),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Avatar(r.requester, 36.dp)
                    Column(Modifier.weight(1f)) {
                        Text(name, style = Type.bodyStrong, color = c.textPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(Formats.relative(r.createdAt, locale), style = Type.caption2, color = c.textSecondary)
                    }
                    if (picked) Box(Modifier.semantics { liveRegion = LiveRegionMode.Polite }) {
                        RequestBadge(stringResource(R.string.requests_your_pick), hue, "your-pick")
                    }
                }
                r.note?.takeIf { it.isNotBlank() }?.let { Text(it, style = Type.body, color = c.textPrimary) }
                if (picked) {
                    FeaturePillButton(stringResource(R.string.requests_hand_over), hue, { confirmHandOver = true },
                        Modifier.testTag("hand-over"), loading = busy)
                    FeaturePillButton(stringResource(R.string.requests_undo_pick), hue, onUndo, Modifier.testTag("undo-pick"),
                        filled = false, enabled = !busy)
                } else {
                    val label = stringResource(if (pick == null) R.string.requests_pick else R.string.requests_pick_instead)
                    FeaturePillButton(label, hue, { onPick(r) }, Modifier.testTag("pick-${r.requesterId}"), filled = pick == null,
                        a11yLabel = stringResource(R.string.requests_action_a11y, label, name), enabled = !busy)
                }
            }
        }
    }
    if (confirmHandOver && pick != null) {
        val name = displayName(pick.requester)
        val body = if (kind == ItemKind.FOOD) stringResource(R.string.requests_hand_over_body_food, name)
        else stringResource(R.string.requests_hand_over_body_market, name, itemTitle)
        HandOverDialog(body, onConfirm = onHandOver, onDismiss = { confirmHandOver = false })
    }
}

/** "Mark as handed over?" (sheet and market "Mark as → Taken" with a pick): not destructive, so the confirm is grape. */
@Composable
fun HandOverDialog(body: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = { onDismiss(); onConfirm() }, modifier = Modifier.testTag("hand-over-confirm")) {
                Text(stringResource(R.string.requests_hand_over), style = Type.headline, color = Hue.grape.text)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel), style = Type.headline, color = Hue.grape.text) } },
        title = { Text(stringResource(R.string.requests_hand_over_title), style = Type.title2) },
        text = { Text(body, style = Type.body) },
        shape = RoundedCornerShape(Radius.hero), containerColor = BoolaaTheme.colors.card,
    )
}
