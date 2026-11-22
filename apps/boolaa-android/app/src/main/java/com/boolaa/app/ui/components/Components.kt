package com.boolaa.app.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
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
import androidx.compose.foundation.text.KeyboardOptions
import coil3.compose.AsyncImage
import com.boolaa.app.R
import com.boolaa.app.model.UserProfile
import com.boolaa.app.ui.theme.Brand
import com.boolaa.app.ui.theme.BoolaaTheme

/** Rounded card with a soft shadow. */
@Composable
fun Modifier.boolaaCard(padding: Dp = 14.dp): Modifier {
    val c = BoolaaTheme.colors
    val shape = RoundedCornerShape(Brand.cardRadius)
    return this
        .fillMaxWidth()
        .shadow(if (c.isDark) 0.dp else 6.dp, shape, ambientColor = Color.Black.copy(alpha = 0.10f), spotColor = Color.Black.copy(alpha = 0.10f))
        .clip(shape)
        .background(c.card)
        .padding(padding)
}

/** Circle avatar with a 2dp purple border; initials when the user has no photo. */
@Composable
fun Avatar(user: UserProfile?, size: Dp, modifier: Modifier = Modifier) {
    val name = user?.name.orEmpty()
    Box(
        modifier
            .size(size)
            .clip(CircleShape)
            .border(2.dp, Brand.purple, CircleShape)
            .background(Brand.purple.copy(alpha = 0.15f)),
        contentAlignment = Alignment.Center,
    ) {
        val avatar = user?.avatar
        if (!avatar.isNullOrBlank()) {
            AsyncImage(
                model = avatar, contentDescription = name,
                contentScale = ContentScale.Crop,
                modifier = Modifier.size(size).clip(CircleShape),
            )
        } else {
            Text(
                initials(name),
                color = Brand.purple,
                fontWeight = FontWeight.Bold,
                fontSize = (size.value * 0.38f).sp,
                maxLines = 1,
            )
        }
    }
}

fun initials(name: String): String =
    name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }.take(2).joinToString("") { it.first().uppercase() }
        .ifEmpty { "?" }

@Composable
fun displayName(user: UserProfile?): String =
    user?.name?.takeIf { it.isNotBlank() } ?: stringResource(R.string.someone)

/** Rounded chip used in the bubble switcher and filters. */
@Composable
fun BoolaaChip(
    title: String,
    active: Boolean,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    outlined: Boolean = false,
) {
    val c = BoolaaTheme.colors
    Row(
        modifier
            .clip(CircleShape)
            .then(if (outlined) Modifier.border(BorderStroke(1.5.dp, Brand.purple), CircleShape) else Modifier)
            .background(if (active) Brand.purple else if (outlined) Color.Transparent else c.chipInactive)
            .padding(horizontal = 16.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (icon != null) Icon(icon, contentDescription = null, tint = if (active) Color.White else Brand.purple, modifier = Modifier.size(16.dp))
        Text(
            title,
            color = if (active) Color.White else if (outlined) Brand.purple else c.textPrimary,
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
fun NewChip(title: String, modifier: Modifier = Modifier) =
    BoolaaChip(title = title, active = false, icon = Icons.Default.Add, outlined = true, modifier = modifier)

@Composable
fun SectionHeader(title: String, count: Int? = null, modifier: Modifier = Modifier) {
    Row(modifier.padding(top = 8.dp, bottom = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        if (count != null) {
            Spacer(Modifier.width(8.dp))
            Text(
                count.toString(),
                color = Brand.purple,
                fontWeight = FontWeight.Bold,
                style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.clip(CircleShape).background(Brand.purple.copy(alpha = 0.14f)).padding(horizontal = 8.dp, vertical = 2.dp),
            )
        }
    }
}

@Composable
fun EmptyState(icon: ImageVector, title: String, message: String, modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxWidth().padding(vertical = 32.dp, horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(Modifier.size(64.dp).clip(CircleShape).background(Brand.purple.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = Brand.purple, modifier = Modifier.size(30.dp))
        }
        Text(title, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        Text(message, style = MaterialTheme.typography.bodyMedium, color = BoolaaTheme.colors.textSecondary, textAlign = TextAlign.Center)
    }
}

@Composable
fun LoadingBox(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = Brand.purple)
    }
}

@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    loading: Boolean = false,
) {
    Button(
        onClick = onClick,
        enabled = enabled && !loading,
        modifier = modifier.fillMaxWidth().heightIn(min = 50.dp),
        shape = RoundedCornerShape(14.dp),
        colors = ButtonDefaults.buttonColors(containerColor = Brand.purple, contentColor = Color.White,
            disabledContainerColor = Brand.purple.copy(alpha = 0.45f), disabledContentColor = Color.White),
    ) {
        if (loading) CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
        else Text(text, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, textAlign = TextAlign.Center)
    }
}

@Composable
fun SecondaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, color: Color = Brand.purple, enabled: Boolean = true) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.heightIn(min = 50.dp),
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(2.dp, color),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = color),
    ) { Text(text, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, textAlign = TextAlign.Center) }
}

/** Filled rounded text field in the Boolaa style. */
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
    TextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        singleLine = singleLine,
        minLines = minLines,
        enabled = enabled,
        keyboardOptions = KeyboardOptions(keyboardType = if (isPassword) KeyboardType.Password else keyboardType),
        visualTransformation = if (isPassword) PasswordVisualTransformation() else VisualTransformation.None,
        shape = RoundedCornerShape(14.dp),
        colors = TextFieldDefaults.colors(
            focusedContainerColor = c.field, unfocusedContainerColor = c.field, disabledContainerColor = c.field,
            focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
            disabledIndicatorColor = Color.Transparent, focusedLabelColor = Brand.purple, cursorColor = Brand.purple,
        ),
        modifier = modifier.fillMaxWidth(),
    )
}

/** Translated error dialog; [message] is already user-facing. */
@Composable
fun ErrorDialog(message: String?, onDismiss: () -> Unit) {
    if (message == null) return
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.ok)) } },
        title = { Text(stringResource(R.string.error_title)) },
        text = { Text(message) },
    )
}

@Composable
fun ConfirmDialog(title: String, message: String, confirm: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = { TextButton(onClick = { onDismiss(); onConfirm() }) { Text(confirm, color = Brand.danger) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
        title = { Text(title) },
        text = { Text(message) },
    )
}

/** Small filled circle icon button (copy/share/edit/approve). */
@Composable
fun CircleIconButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    filled: Boolean = false,
    tint: Color = Brand.purple,
    size: Dp = 40.dp,
) {
    Box(
        modifier
            .size(size)
            .clip(CircleShape)
            .background(if (filled) tint else tint.copy(alpha = 0.12f))
            .semantics { role = Role.Button }
            .then(Modifier.clickableRipple(onClick)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = contentDescription, tint = if (filled) Color.White else tint, modifier = Modifier.size(size * 0.5f))
    }
}

@Composable
fun RemoteImage(url: String?, modifier: Modifier = Modifier, contentDescription: String? = null) {
    AsyncImage(
        model = url,
        contentDescription = contentDescription,
        contentScale = ContentScale.Crop,
        modifier = modifier.background(Brand.purple.copy(alpha = 0.10f)),
    )
}

@Composable
fun StatusBadge(text: String, modifier: Modifier = Modifier, color: Color = Brand.purple) {
    Text(
        text,
        color = Color.White,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.Bold,
        maxLines = 1,
        modifier = modifier.clip(CircleShape).background(color).padding(horizontal = 10.dp, vertical = 4.dp),
    )
}
