package com.boolaa.app.ui.components

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.window.DialogProperties
import com.boolaa.app.BuildConfig
import com.boolaa.app.R
import com.boolaa.app.core.AndroidRelease
import com.boolaa.app.core.AppUpdate
import com.boolaa.app.core.UpdateKind
import com.boolaa.app.ui.theme.BoolaaTheme
import com.boolaa.app.ui.theme.Hue
import com.boolaa.app.ui.theme.Radius
import com.boolaa.app.ui.theme.Type

/**
 * Checks boolaa.ro/android/latest.json once per launch (release builds only) and offers the new APK. An optional
 * update is offered once per version ("Later" hides it until the next version); below `minSupported` the dialog
 * can't be dismissed. "Download" opens the APK link in the browser, which downloads it; Android then installs it
 * over this one (same signing key), keeping the account and data.
 */
@Composable
fun UpdatePrompt() {
    if (BuildConfig.DEBUG) return
    val context = LocalContext.current
    var release by remember { mutableStateOf<AndroidRelease?>(null) }
    var kind by remember { mutableStateOf(UpdateKind.NONE) }
    LaunchedEffect(Unit) {
        val r = AppUpdate.fetch("${BuildConfig.WEB_BASE_URL}/android/latest.json")
        release = r
        kind = AppUpdate.kind(BuildConfig.VERSION_CODE, r, AppUpdate.dismissed(context))
    }
    val r = release ?: return
    if (kind == UpdateKind.NONE) return
    val required = kind == UpdateKind.REQUIRED
    val later = { AppUpdate.dismiss(context, r.versionCode); kind = UpdateKind.NONE }
    AlertDialog(
        onDismissRequest = { if (!required) later() },
        properties = DialogProperties(dismissOnBackPress = !required, dismissOnClickOutside = !required),
        confirmButton = {
            TextButton(
                onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(r.url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) },
                modifier = Modifier.testTag("update-download"),
            ) { Text(stringResource(R.string.update_download), style = Type.headline, color = Hue.grape.text) }
        },
        dismissButton = if (required) null else {
            { TextButton(onClick = later) { Text(stringResource(R.string.update_later), style = Type.headline, color = Hue.grape.text) } }
        },
        title = { Text(stringResource(R.string.update_title), style = Type.title2) },
        text = {
            Text(
                stringResource(if (required) R.string.update_required_body else R.string.update_body, r.versionName),
                style = Type.body,
            )
        },
        shape = RoundedCornerShape(Radius.hero), containerColor = BoolaaTheme.colors.card,
    )
}
