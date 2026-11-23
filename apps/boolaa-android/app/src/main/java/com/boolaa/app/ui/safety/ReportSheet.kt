package com.boolaa.app.ui.safety

import androidx.annotation.StringRes
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.boolaa.app.AppContainer
import com.boolaa.app.R
import com.boolaa.app.model.ReportReason
import com.boolaa.app.model.ReportTarget
import com.boolaa.app.ui.BaseViewModel
import com.boolaa.app.ui.ErrorDialogFor
import com.boolaa.app.ui.LocalAppContainer
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed as gridItemsIndexed
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.boolaa.app.ui.components.AddButton
import com.boolaa.app.ui.components.Avatar
import com.boolaa.app.ui.components.BoolaaChip
import com.boolaa.app.ui.components.BoolaaIcons
import com.boolaa.app.ui.components.BoolaaRefreshBox
import com.boolaa.app.ui.components.BoolaaSheet
import com.boolaa.app.ui.components.BoolaaTextField
import com.boolaa.app.ui.components.BubbleOrb
import com.boolaa.app.ui.components.CircleIconButton
import com.boolaa.app.ui.components.ConfettiOverlay
import com.boolaa.app.ui.components.ConfettiState
import com.boolaa.app.ui.components.ConfirmDialog
import com.boolaa.app.ui.components.FeatureBadge
import com.boolaa.app.ui.components.FitText
import com.boolaa.app.ui.components.Haptics
import com.boolaa.app.ui.components.HintCard
import com.boolaa.app.ui.components.ItemMenu
import com.boolaa.app.ui.components.MorphIcon
import com.boolaa.app.ui.components.PhotoField
import com.boolaa.app.ui.components.PrimaryButton
import com.boolaa.app.ui.components.PushedHeader
import com.boolaa.app.ui.components.RemoteImage
import com.boolaa.app.ui.components.RollingCount
import com.boolaa.app.ui.components.SecondaryButton
import com.boolaa.app.ui.components.SectionHeader
import com.boolaa.app.ui.components.SegmentedPill
import com.boolaa.app.ui.components.SkeletonList
import com.boolaa.app.ui.components.SkeletonTile
import com.boolaa.app.ui.components.StatusBadge
import com.boolaa.app.ui.components.boolaaCard
import com.boolaa.app.ui.components.bounceOn
import com.boolaa.app.ui.components.clickableRipple
import com.boolaa.app.ui.components.dashedBorder
import com.boolaa.app.ui.components.displayName
import com.boolaa.app.ui.components.dockClearance
import com.boolaa.app.ui.components.glow
import com.boolaa.app.ui.components.popIn
import com.boolaa.app.ui.components.scrollFade
import com.boolaa.app.ui.components.uploadPicked
import com.boolaa.app.ui.theme.BoolaaTheme
import com.boolaa.app.ui.theme.Brand
import com.boolaa.app.ui.theme.Display
import com.boolaa.app.ui.theme.Feature
import com.boolaa.app.ui.theme.Hue
import com.boolaa.app.ui.theme.Motion
import com.boolaa.app.ui.theme.Radius
import com.boolaa.app.ui.theme.Type

@StringRes
fun ReportReason.label(): Int = when (this) {
    ReportReason.SPAM -> R.string.report_reason_spam
    ReportReason.HARASSMENT -> R.string.report_reason_harassment
    ReportReason.HATE -> R.string.report_reason_hate
    ReportReason.SEXUAL -> R.string.report_reason_sexual
    ReportReason.VIOLENCE -> R.string.report_reason_violence
    ReportReason.SELF_HARM -> R.string.report_reason_self_harm
    ReportReason.OTHER -> R.string.report_reason_other
}

class ReportViewModel(private val container: AppContainer) : BaseViewModel() {
    private val _sent = MutableStateFlow(false)
    val sent = _sent.asStateFlow()

    fun submit(target: ReportTarget, reason: ReportReason, details: String) = launchCatching {
        container.api.report(target.type, target.id, reason, details.trim().take(1000))
        _sent.value = true
    }

    fun block(userId: String, onDone: () -> Unit) = launchCatching(onSuccess = onDone) { container.session.block(userId) }
}

@OptIn(ExperimentalLayoutApi::class)
/**
 * Report flow (App Store 1.2): 7 reasons + optional details, then "Also block <name>?".
 * A safety surface: flat buttons, plain cards, a system symbol and standard fades only. Grape marks the selected
 * reason, mint the "report sent" confirmation, danger the block.
 * Calm surface: no mascot draws inside it (design-system.md §8.4).
 */
@Composable
fun ReportSheet(target: ReportTarget, onDismiss: () -> Unit) = com.boolaa.app.ui.components.CalmSurface { ReportSheetContent(target, onDismiss) }

@Composable
private fun ReportSheetContent(target: ReportTarget, onDismiss: () -> Unit) {
    val container = LocalAppContainer.current
    val state by container.session.state.collectAsStateWithLifecycle()
    val vm: ReportViewModel = viewModel(key = "report-${target.type}-${target.id}") { ReportViewModel(container) }
    val sent by vm.sent.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    var reason by rememberSaveable { mutableStateOf<ReportReason?>(null) }
    var details by rememberSaveable { mutableStateOf("") }
    val c = BoolaaTheme.colors
    val view = LocalView.current

    BoolaaSheet(onDismiss, stringResource(if (sent) R.string.report else R.string.report_title), tag = "report-sheet", spacing = 12.dp) {
        if (!sent) {
            Text(stringResource(R.string.report_subtitle, target.authorName), style = Type.body, color = c.textSecondary)
            Column(Modifier.boolaaCard(6.dp).selectableGroup()) {
                ReportReason.entries.forEach { r ->
                    val selected = reason == r
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(Radius.field))
                            .then(if (selected) Modifier.background(Hue.grape.wash) else Modifier)
                            .selectable(selected = selected, onClick = { Haptics.selection(view); reason = r }, role = Role.RadioButton)
                            .padding(horizontal = 14.dp, vertical = 10.dp).testTag("reason-${r.wire}"),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(stringResource(r.label()), style = if (selected) Type.bodyStrong else Type.body,
                            color = if (selected) Hue.grape.text else c.textPrimary, modifier = Modifier.weight(1f))
                        if (selected) Icon(BoolaaIcons.Check, contentDescription = null, tint = Hue.grape.text, modifier = Modifier.size(22.dp))
                    }
                }
            }
            BoolaaTextField(details, { details = it.take(1000) }, stringResource(R.string.report_details), singleLine = false, minLines = 2)
            PrimaryButton(stringResource(R.string.report_submit), onClick = { reason?.let { vm.submit(target, it, details) } },
                enabled = reason != null, loading = busy, calm = true, modifier = Modifier.testTag("report-submit"))
        } else {
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(Radius.field)).background(Hue.mint.wash).padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(BoolaaIcons.Done, contentDescription = null, tint = Hue.mint.text)
                Text(stringResource(R.string.report_sent), style = Type.bodyStrong, color = Hue.mint.text, modifier = Modifier.padding(start = 10.dp))
            }
            if (target.authorId != state.userId && target.authorId !in state.blockedIds) {
                Column(Modifier.boolaaCard(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(stringResource(R.string.also_block, target.authorName), style = Type.headline, color = c.textPrimary)
                    Text(stringResource(R.string.block_explainer), style = Type.subheadline, color = c.textSecondary)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        CalmSecondaryButton(stringResource(R.string.not_now), onDismiss, Modifier.weight(1f))
                        PrimaryButton(stringResource(R.string.block), onClick = { vm.block(target.authorId, onDismiss) }, loading = busy, danger = true,
                            modifier = Modifier.weight(1f).testTag("report-block"))
                    }
                }
            } else {
                PrimaryButton(stringResource(R.string.done), onClick = onDismiss, calm = true)
            }
        }
        ErrorDialogFor(vm)
    }
}

/** Flat secondary button for safety flows: radius 16, field fill, no squish. */
@Composable
private fun CalmSecondaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val c = BoolaaTheme.colors
    Box(
        modifier.heightIn(min = 54.dp).clip(RoundedCornerShape(Radius.field)).background(c.field)
            .clickableRipple(scale = 1f, role = Role.Button, onClick = onClick).padding(horizontal = 16.dp, vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) { Text(text, style = Type.headline, color = c.textPrimary, textAlign = TextAlign.Center) }
}
