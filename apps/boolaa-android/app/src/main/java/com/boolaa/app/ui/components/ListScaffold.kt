package com.boolaa.app.ui.components

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.MoreVert
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.boolaa.app.R
import com.boolaa.app.ui.theme.Brand

/** "Add" pill shown at the top of the list screens (Events, Food Circle, Marketplace, Links). */
@Composable
fun AddRow(label: String, onClick: () -> Unit, modifier: Modifier = Modifier, trailing: @Composable () -> Unit = {}) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Row(
            Modifier.clip(CircleShape).clickableRipple(onClick).padding(vertical = 2.dp).testTag("add-button"),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BoolaaChip(title = label, active = true, icon = Icons.Default.Add)
        }
        Spacer(Modifier.weight(1f))
        trailing()
    }
}

/** Edit / delete for the user's own content (Report on everyone else's). */
@Composable
fun OwnerMenu(onEdit: (() -> Unit)?, onDelete: () -> Unit, modifier: Modifier = Modifier) =
    ItemMenu(onEdit = onEdit, onDelete = onDelete, onReport = null, modifier = modifier)

/** Overflow menu on cards: edit/delete for own content, report for others' (App Store 1.2). */
@Composable
fun ItemMenu(onEdit: (() -> Unit)?, onDelete: (() -> Unit)?, onReport: (() -> Unit)?, modifier: Modifier = Modifier) {
    var open by remember { mutableStateOf(false) }
    IconButton(onClick = { open = true }, modifier = modifier.size(36.dp).testTag(if (onReport != null) "item-menu" else "owner-menu")) {
        Icon(Icons.Default.MoreVert, contentDescription = stringResource(R.string.more_actions), tint = Brand.purple)
    }
    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
        if (onEdit != null) DropdownMenuItem(text = { Text(stringResource(R.string.edit)) }, onClick = { open = false; onEdit() })
        if (onDelete != null) DropdownMenuItem(text = { Text(stringResource(R.string.delete), color = Brand.danger) }, onClick = { open = false; onDelete() })
        if (onReport != null) DropdownMenuItem(text = { Text(stringResource(R.string.report)) }, onClick = { open = false; onReport() },
            modifier = Modifier.testTag("menu-report"))
    }
}

