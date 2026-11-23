package com.boolaa.app.ui.components

import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.boolaa.app.R
import com.boolaa.app.ui.theme.BoolaaTheme
import com.boolaa.app.ui.theme.Radius
import com.boolaa.app.ui.theme.Type

/** An extra entry in [ItemMenu] (e.g. "Mark as Taken"), already localized. */
data class MenuExtra(val title: String, val tag: String, val onClick: () -> Unit)

/** Overflow menu on cards: edit/delete for own content, report for others' (App Store 1.2), plus [extra] entries first. */
@Composable
fun ItemMenu(onEdit: (() -> Unit)?, onDelete: (() -> Unit)?, onReport: (() -> Unit)?, modifier: Modifier = Modifier, extra: List<MenuExtra> = emptyList()) {
    val c = BoolaaTheme.colors
    var open by remember { mutableStateOf(false) }
    IconButton(onClick = { open = true }, modifier = modifier.size(48.dp).testTag(if (onReport != null) "item-menu" else "owner-menu")) {
        Icon(BoolaaIcons.More, contentDescription = stringResource(R.string.more_actions), tint = c.textSecondary)
    }
    DropdownMenu(expanded = open, onDismissRequest = { open = false }, shape = RoundedCornerShape(Radius.field), containerColor = c.card) {
        extra.forEach { e ->
            DropdownMenuItem(text = { Text(e.title, style = Type.body) }, onClick = { open = false; e.onClick() }, modifier = Modifier.testTag(e.tag))
        }
        if (onEdit != null) DropdownMenuItem(
            text = { Text(stringResource(R.string.edit), style = Type.body) }, onClick = { open = false; onEdit() },
            leadingIcon = { Icon(BoolaaIcons.Edit, contentDescription = null) },
        )
        if (onDelete != null) DropdownMenuItem(
            text = { Text(stringResource(R.string.delete), style = Type.body, color = c.dangerText) }, onClick = { open = false; onDelete() },
            leadingIcon = { Icon(BoolaaIcons.Delete, contentDescription = null, tint = c.dangerText) },
        )
        if (onReport != null) DropdownMenuItem(
            text = { Text(stringResource(R.string.report), style = Type.body) }, onClick = { open = false; onReport() },
            leadingIcon = { Icon(BoolaaIcons.Report, contentDescription = null) },
            modifier = Modifier.testTag("menu-report"),
        )
    }
}
