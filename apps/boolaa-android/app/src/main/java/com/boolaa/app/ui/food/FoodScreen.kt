package com.boolaa.app.ui.food

import com.boolaa.app.ui.shell.pushHighlight
import com.boolaa.app.ui.shell.PushHighlightScroll
import android.content.ContentResolver
import android.net.Uri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.boolaa.app.AppContainer
import com.boolaa.app.R
import com.boolaa.app.core.FeedSpecs
import com.boolaa.app.core.keepFeedLive
import com.boolaa.app.core.Formats
import com.boolaa.app.core.FoodInput
import com.boolaa.app.core.ImageBucket
import com.boolaa.app.model.FoodPost
import com.boolaa.app.model.ReportTarget
import com.boolaa.app.model.ReportTargetType
import com.boolaa.app.ui.safety.ReportSheet
import com.boolaa.app.ui.BaseViewModel
import com.boolaa.app.ui.ErrorDialogFor
import com.boolaa.app.ui.LocalAppContainer
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
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
import com.boolaa.app.ui.components.longPressToReact
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
import com.boolaa.app.ui.components.EmptyState
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

class FoodViewModel(private val container: AppContainer, private val bubbleId: String) : BaseViewModel() {
    private val _posts = MutableStateFlow<List<FoodPost>?>(null)
    val posts = _posts.asStateFlow()
    val reactions = reactionStore(container.api, bubbleId, com.boolaa.app.model.ReactionTarget.FOOD_POST, _posts) { it.id }

    init {
        load()
        reloadOnBlockChange(container.session) { load() }
    }

    /** Other members' inserts, edits, RSVPs and deletes stream in while the screen is shown (docs/boolaa-spec.md). */
    suspend fun keepLive() = container.api.keepFeedLive(FeedSpecs.food, bubbleId, _posts, reactions) { load().join() }

    fun react(postId: String, kind: com.boolaa.app.model.ReactionKind) =
        toggleReaction(reactions, postId, kind, container.session.state.value.userId)

    fun load(refresh: Boolean = false) = launchCatching(trackBusy = refresh) {
        val loaded = container.api.foodPosts(bubbleId)
        _posts.value = loaded
        reactions.refresh(loaded.map { it.id })
    }.also { it.invokeOnCompletion { if (_posts.value == null) _posts.value = emptyList() } }

    fun save(existing: FoodPost?, picked: Uri?, description: String, resolver: ContentResolver, onDone: () -> Unit) =
        launchCatching(onSuccess = onDone) {
            val image = picked?.let { uploadPicked(container, resolver, it, ImageBucket.FOOD) } ?: existing?.image ?: return@launchCatching
            val input = FoodInput(image, description.trim().ifEmpty { null })
            val userId = container.session.state.value.userId ?: return@launchCatching
            if (existing == null) container.api.createFoodPost(bubbleId, userId, input) else container.api.updateFoodPost(existing.id, input)
            if (existing != null && existing.image != image) container.api.deleteImage(existing.image, ImageBucket.FOOD, userId)
            load()
        }

    fun delete(post: FoodPost) = launchCatching {
        container.api.deleteFoodPost(post.id)
        container.session.state.value.userId?.let { container.api.deleteImage(post.image, ImageBucket.FOOD, it) }
        _posts.update { it?.filterNot { p -> p.id == post.id } }
    }
}

/** "My posts" and "From the bubble" with photo upload (spec §8). */
@Composable
fun FoodScreen() {
    val container = LocalAppContainer.current
    val state by container.session.state.collectAsStateWithLifecycle()
    val bubble = state.currentBubble ?: return
    val me = state.userId ?: return
    val vm: FoodViewModel = viewModel(key = "food-${bubble.id}") { FoodViewModel(container, bubble.id) }
    LaunchedEffect(vm) { vm.keepLive() }
    val posts by vm.posts.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val reactionRows by vm.reactions.rows.collectAsStateWithLifecycle()
    val reactionsByPost = remember(reactionRows, me) { com.boolaa.app.core.ReactionMerge.summaries(reactionRows, me) }
    var editing by remember { mutableStateOf<FoodPost?>(null) }
    var creating by rememberSaveable { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<FoodPost?>(null) }
    var reporting by remember { mutableStateOf<ReportTarget?>(null) }
    val someone = stringResource(R.string.someone)
    val hue = Feature.FOOD.hue
    val listState = rememberLazyListState()
    PushHighlightScroll(listState, loaded = posts != null)

    BoolaaRefreshBox(isRefreshing = busy && posts != null && !creating && editing == null, onRefresh = { vm.load(refresh = true) },
        modifier = Modifier.fillMaxSize().testTag("food-screen")) {
        LazyColumn(
            state = listState,
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 0.dp, bottom = dockClearance()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            val list = posts
            val mine = list.orEmpty().filter { it.userId == me }
            val others = list.orEmpty().filter { it.userId != me }
            item(key = "my-header") {
                SectionHeader(stringResource(R.string.my_posts), if (list == null) null else mine.size, hue = hue,
                    action = { AddButton(stringResource(R.string.new_food_post), onClick = { creating = true }, hue = hue) })
            }
            if (list == null) { item(key = "loading") { SkeletonList() }; return@LazyColumn }
            if (list.isEmpty()) {
                item(key = "empty") { EmptyState(BoolaaIcons.Food, stringResource(R.string.food_empty_title), stringResource(R.string.food_empty_message), hue = hue) }
                return@LazyColumn
            }
            if (mine.isEmpty()) item(key = "my-empty") {
                EmptyState(BoolaaIcons.Food, stringResource(R.string.food_empty_title), stringResource(R.string.my_posts_empty), hue = hue)
            }
            itemsIndexed(mine, key = { _, p -> p.id }) { index, p ->
                FoodCard(p, onEdit = { editing = p }, onDelete = { deleting = p }, modifier = Modifier.pushHighlight(p.id).scrollFade(listState, p.id).popIn(index + 1),
                    reactions = reactionsByPost[p.id].orEmpty(), onReact = { vm.react(p.id, it) })
            }
            item(key = "bubble-header") { SectionHeader(stringResource(R.string.from_the_bubble), others.size, hue = hue) }
            if (others.isEmpty()) item(key = "bubble-empty") {
                EmptyState(BoolaaIcons.Takeout, stringResource(R.string.food_empty_title), stringResource(R.string.from_the_bubble_empty), hue = hue)
            }
            itemsIndexed(others, key = { _, p -> p.id }) { index, p ->
                FoodCard(p, onEdit = null, onDelete = null, modifier = Modifier.pushHighlight(p.id).scrollFade(listState, p.id).popIn(mine.size + index + 2),
                    reactions = reactionsByPost[p.id].orEmpty(), onReact = { vm.react(p.id, it) }, onReport = {
                    reporting = ReportTarget(ReportTargetType.FOOD_POST, p.id, p.userId, p.user?.name?.takeIf { it.isNotBlank() } ?: someone)
                })
            }
        }
    }
    if (creating || editing != null) {
        val resolver = LocalContext.current.contentResolver
        FoodEditor(editing, busy, onDismiss = { creating = false; editing = null }) { picked, description ->
            vm.save(editing, picked, description, resolver) { creating = false; editing = null }
        }
    }
    deleting?.let { p ->
        ConfirmDialog(stringResource(R.string.delete_post_title), p.description.orEmpty(), stringResource(R.string.delete),
            onConfirm = { vm.delete(p) }, onDismiss = { deleting = null })
    }
    reporting?.let { ReportSheet(it, onDismiss = { reporting = null }) }
    ErrorDialogFor(vm)
}

/** Full-width photo with the author pill floating bottom-left; description and the overflow menu below. */
@Composable
fun FoodCard(
    post: FoodPost, onEdit: (() -> Unit)?, onDelete: (() -> Unit)?, modifier: Modifier = Modifier, onReport: (() -> Unit)? = null,
    reactions: List<com.boolaa.app.core.ReactionSummary> = emptyList(), onReact: ((com.boolaa.app.model.ReactionKind) -> Unit)? = null,
) {
    val locale = LocalConfiguration.current.locales[0]
    val c = BoolaaTheme.colors
    val picker = com.boolaa.app.ui.components.rememberReactionPicker()
    Column(modifier.boolaaCard(0.dp).testTag("food-${post.id}")) {
        // Long press on the photo opens the reaction picker.
        Box(if (onReact != null) Modifier.longPressToReact(picker) else Modifier) {
            RemoteImage(post.image, Modifier.fillMaxWidth().height(210.dp), stringResource(R.string.a11y_photo_from, displayName(post.user)))
            Row(
                Modifier.align(Alignment.BottomStart).padding(10.dp).clip(CircleShape).background(c.card.copy(alpha = 0.9f))
                    .padding(start = 4.dp, end = 12.dp, top = 4.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Avatar(post.user, 24.dp)
                Text(displayName(post.user), style = Type.caption, color = c.textPrimary, maxLines = 1)
                Text(Formats.relative(post.createdAt, locale), style = Type.caption2, color = c.textSecondary, maxLines = 1)
            }
        }
        val description = post.description?.takeIf { it.isNotBlank() }
        val hasMenu = onDelete != null || onReport != null
        if (description != null || hasMenu) {
            Row(Modifier.padding(start = 16.dp, end = 4.dp, top = 6.dp, bottom = 6.dp).heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(description.orEmpty(), style = Type.body.copy(fontWeight = FontWeight.Medium), color = c.textPrimary, modifier = Modifier.weight(1f).padding(vertical = 6.dp))
                if (hasMenu) ItemMenu(onEdit, onDelete, onReport)
            }
        }
        if (onReact != null) {
            com.boolaa.app.ui.components.ReactionBar(reactions, onReact, Modifier.padding(start = 14.dp, end = 14.dp, bottom = 12.dp, top = 2.dp),
                hue = Feature.FOOD.hue, picker = picker, tag = "reactions-${post.id}")
        }
    }
}

@Composable
fun FoodEditor(existing: FoodPost?, busy: Boolean, onDismiss: () -> Unit, onSave: (Uri?, String) -> Unit) {
    var picked by remember { mutableStateOf<Uri?>(null) }
    var description by rememberSaveable { mutableStateOf(existing?.description.orEmpty()) }
    val hue = Feature.FOOD.hue
    BoolaaSheet(onDismiss, stringResource(if (existing == null) R.string.new_food_post else R.string.edit_food_post), spacing = 12.dp) {
        PhotoField(existing?.image, picked, onPick = { picked = it }, hue = hue)
        BoolaaTextField(description, { description = it }, stringResource(R.string.description), singleLine = false, minLines = 2)
        PrimaryButton(stringResource(R.string.save), onClick = { onSave(picked, description) },
            enabled = picked != null || existing != null, loading = busy, hue = hue, modifier = Modifier.padding(top = 4.dp))
    }
}
