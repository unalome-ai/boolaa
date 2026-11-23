package com.boolaa.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp
import com.boolaa.app.R
import com.boolaa.app.model.ChatUnread
import com.boolaa.app.ui.theme.BoolaaTheme
import com.boolaa.app.ui.theme.Hue
import com.boolaa.app.ui.theme.Type

/**
 * Unread chat count capsule ("99+" above 99); nothing for 0. Read out as "N unread messages", or not at all with
 * [labelled] = false when the control it sits on already says it (chat button, bubble chips).
 */
@Composable
fun UnreadBadge(count: Int, modifier: Modifier = Modifier, tag: String = "unread-badge", labelled: Boolean = true) {
    val text = ChatUnread.badgeText(count) ?: return
    val label = pluralStringResource(R.plurals.chat_unread, count, count)
    Box(
        modifier
            .testTag(tag)
            .clearAndSetSemantics { if (labelled) contentDescription = label }
            .defaultMinSize(minWidth = 20.dp, minHeight = 20.dp)
            .border(1.5.dp, BoolaaTheme.colors.background, CircleShape)
            .clip(CircleShape)
            .background(Hue.coral.gradient)
            .padding(horizontal = 6.dp, vertical = 2.dp),
        contentAlignment = Alignment.Center,
    ) { Text(text, color = Hue.coral.onFill, style = Type.caption, maxLines = 1) }
}
