package com.boolaa.app.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CloudDone
import androidx.compose.material.icons.rounded.CloudOff
import androidx.compose.material.icons.rounded.WifiOff
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.boolaa.app.R
import com.boolaa.app.core.NetStatus
import com.boolaa.app.ui.LoadIssue
import com.boolaa.app.ui.LocalAppContainer
import com.boolaa.app.ui.theme.BoolaaTheme
import com.boolaa.app.ui.theme.Hue
import com.boolaa.app.ui.theme.LocalReduceMotion
import com.boolaa.app.ui.theme.Type
import kotlinx.coroutines.delay

/**
 * The calm connectivity pill under the shell header: "You're offline — showing what you saw last", "Can't reach
 * Boolaa — …", or "Back online" for 2.5 s. Announced politely to TalkBack; no motion under Reduce Motion.
 */
@Composable
fun ConnectivityBanner(modifier: Modifier = Modifier) {
    val connectivity = LocalAppContainer.current.connectivity
    val status by connectivity.status.collectAsStateWithLifecycle()
    val backOnline by connectivity.backOnline.collectAsStateWithLifecycle()
    val visible = status != NetStatus.ONLINE || backOnline
    val reduce = LocalReduceMotion.current
    AnimatedVisibility(
        visible, modifier = modifier,
        enter = if (reduce) fadeIn() else fadeIn() + expandVertically(),
        exit = if (reduce) fadeOut() else fadeOut() + shrinkVertically(),
    ) {
        val c = BoolaaTheme.colors
        val (icon, text, tint) = when (status) {
            NetStatus.OFFLINE -> Triple(Icons.Rounded.WifiOff, stringResource(R.string.offline_banner), c.textSecondary)
            NetStatus.UNREACHABLE -> Triple(Icons.Rounded.CloudOff, stringResource(R.string.offline_unreachable), c.textSecondary)
            NetStatus.ONLINE -> Triple(Icons.Rounded.CloudDone, stringResource(R.string.offline_back_online), Hue.mint.text)
        }
        Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), contentAlignment = Alignment.Center) {
            Row(
                Modifier.clip(CircleShape).background(c.card).border(1.dp, c.hairline, CircleShape)
                    .semantics { liveRegion = LiveRegionMode.Polite }
                    .testTag(if (status == NetStatus.ONLINE) "back-online" else "offline-banner")
                    .padding(horizontal = 14.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(18.dp))
                Text(text, style = Type.subheadline, color = c.textPrimary)
            }
        }
    }
}

/** Nothing could be loaded and nothing is cached: an inline error with Try again (never an empty screen). */
@Composable
fun LoadFailed(onRetry: () -> Unit, modifier: Modifier = Modifier) {
    val c = BoolaaTheme.colors
    Column(
        modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(c.card).border(1.dp, c.hairline, RoundedCornerShape(24.dp))
            .padding(20.dp).testTag("load-failed"),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(Icons.Rounded.CloudOff, contentDescription = null, tint = c.textSecondary, modifier = Modifier.size(32.dp))
        Text(stringResource(R.string.offline_load_failed), style = Type.body, color = c.textPrimary, textAlign = TextAlign.Center)
        SecondaryButton(stringResource(R.string.offline_retry), onClick = onRetry, modifier = Modifier.testTag("load-retry"))
    }
}

/**
 * A refresh failed while older data stays on screen. Hidden while the offline / unreachable banner already says so.
 */
@Composable
fun StaleNotice(issue: LoadIssue, onRetry: () -> Unit, modifier: Modifier = Modifier) {
    val status by LocalAppContainer.current.connectivity.status.collectAsStateWithLifecycle()
    if (issue != LoadIssue.STALE || status != NetStatus.ONLINE) return
    val c = BoolaaTheme.colors
    Row(
        modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(c.field).heightIn(min = 44.dp)
            .padding(start = 14.dp, end = 6.dp, top = 4.dp, bottom = 4.dp).testTag("stale-notice"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(stringResource(R.string.offline_stale_notice), style = Type.subheadline, color = c.textSecondary, modifier = Modifier.weight(1f))
        Text(
            stringResource(R.string.offline_retry), style = Type.subheadline, color = Hue.grape.text,
            modifier = Modifier.clip(CircleShape).clickableRipple(role = Role.Button, onClick = onRetry).padding(horizontal = 10.dp, vertical = 10.dp)
                .testTag("stale-retry"),
        )
    }
}

/** While a list is still null: the delayed skeleton, or [LoadFailed] once the load failed. */
@Composable
fun LoadingOrFailed(issue: LoadIssue, onRetry: () -> Unit, modifier: Modifier = Modifier) {
    if (issue == LoadIssue.FAILED) LoadFailed(onRetry, modifier) else SkeletonList(modifier)
}

/** Loading indicators appear only after [delayMs], so fast loads don't flash a skeleton. */
@Composable
fun DelayedAppearance(delayMs: Long = 300, content: @Composable () -> Unit) {
    var shown by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { delay(delayMs); shown = true }
    if (shown) content()
}
