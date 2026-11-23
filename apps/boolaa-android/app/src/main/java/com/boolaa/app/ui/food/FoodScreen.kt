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
import com.boolaa.app.ui.components.IWantItSheet
import com.boolaa.app.ui.components.OwnerRequestsButton
import com.boolaa.app.ui.components.RequestBadge
import com.boolaa.app.ui.components.RequestCountPill
import com.boolaa.app.ui.components.RequesterActions
import com.boolaa.app.ui.components.RequestsSheet
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

class FoodViewModel(container: AppContainer, bubbleId: String) :
    com.boolaa.app.ui.RequestsViewModel(container, bubbleId, com.boolaa.app.model.ItemKind.FOOD) {
    private val _posts = MutableStateFlow<List<FoodPost>?>(null)
    val posts = _posts.asStateFlow()
    val reactions = reactionStore(container.api, bubbleId, com.boolaa.app.model.ReactionTarget.FOOD_POST, _posts) { it.id }

    private val cacheKey = com.boolaa.app.core.CacheKeys.food(bubbleId)
    private val serializer = kotlinx.serialization.builtins.ListSerializer(FoodPost.serializer())

    init {
        offlineAware(container, _posts, cacheKey, serializer) { load() }
        load()
        reloadOnBlockChange(container.session) { load() }
    }

    /** Other members' inserts, edits, RSVPs and deletes stream in while the screen is shown (docs/boolaa-spec.md). */
    suspend fun keepLive() = container.api.keepFeedLive(FeedSpecs.food, bubbleId, _posts, reactions, requests) { load().join() }

    override fun applyItem(itemId: String, availability: com.boolaa.app.model.MarketAvailability?, countDelta: Int) = _posts.update { list ->
        list?.map { p ->
            if (p.id != itemId) p
            else p.copy(availability = availability ?: p.availability, requestCount = (p.requestCount + countDelta).coerceAtLeast(0))
        }
    }

    override fun reloadAll() { load() }

    fun react(postId: String, kind: com.boolaa.app.model.ReactionKind) =
        toggleReaction(reactions, postId, kind, container.session.state.value.userId)

    fun load(refresh: Boolean = false) = runLoad(container, hasData = { _posts.value != null }, trackBusy = refresh) {
        val loaded = container.api.foodPosts(bubbleId)
        _posts.value = loaded
        saveCache(container, cacheKey, serializer, loaded)
        reactions.refresh(loaded.map { it.id })
        // "I want it" rows after the list (docs/boolaa-spec.md "Requests and picking", Loading).
        runCatching { loadRequests() }.onFailure { android.util.Log.w("Boolaa", "food requests load failed", it) }
    }

    /** [expiresAt]: always on create; on edit only when the user changed it (null = unchanged). */
    fun save(existing: FoodPost?, picked: Uri?, description: String, expiresAt: java.time.Instant?, resolver: ContentResolver, onDone: () -> Unit) =
        launchCatching(onSuccess = onDone) {
            val image = picked?.let { uploadPicked(container, resolver, it, ImageBucket.FOOD) } ?: existing?.image ?: return@launchCatching
            val input = FoodInput(image, description.trim().ifEmpty { null }, expiresAt)
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

/** Re-reads the clock every minute and at the next expiry, so labels stay current and expired posts leave at once. */
@Composable
fun rememberExpiryClock(posts: List<FoodPost>?): java.time.Instant {
    var now by remember { mutableStateOf(java.time.Instant.now()) }
    LaunchedEffect(posts) {
        while (true) {
            now = java.time.Instant.now()
            val next = com.boolaa.app.core.FoodExpiry.nextExpiry(posts.orEmpty(), now)
            val untilNext = next?.let { java.time.Duration.between(now, it).toMillis() + 50 } ?: Long.MAX_VALUE
            kotlinx.coroutines.delay(minOf(60_000L - now.toEpochMilli() % 60_000L, untilNext).coerceAtLeast(50))
        }
    }
    return now
}

/** "My posts" and "From the bubble" with photo upload, expiry and "I want it" (spec §8, "Food expiry", "Requests and picking"). */
@Composable
fun FoodScreen() {
    val container = LocalAppContainer.current
    val state by container.session.state.collectAsStateWithLifecycle()
    val bubble = state.currentBubble ?: return
    val me = state.userId ?: return
    val vm: FoodViewModel = viewModel(key = "food-${bubble.id}") { FoodViewModel(container, bubble.id) }
    // Resubscribed (and reloaded once live) on every reconnect and return to the front.
    val generation by container.connectivity.refresh.collectAsStateWithLifecycle()
    LaunchedEffect(vm, generation) { vm.keepLive() }
    val allPosts by vm.posts.collectAsStateWithLifecycle()
    val now = rememberExpiryClock(allPosts)
    // Expired and handed-over posts are never rendered (the server hides expired ones at the next load).
    val posts = remember(allPosts, now) { allPosts?.let { com.boolaa.app.core.FoodExpiry.visible(it, now) } }
    val requests by vm.requests.rows.collectAsStateWithLifecycle()
    val working by vm.working.collectAsStateWithLifecycle()
    val issue by vm.loadIssue.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val reactionRows by vm.reactions.rows.collectAsStateWithLifecycle()
    val reactionsByPost = remember(reactionRows, me) { com.boolaa.app.core.ReactionMerge.summaries(reactionRows, me) }
    var editing by remember { mutableStateOf<FoodPost?>(null) }
    var creating by rememberSaveable { mutableStateOf(false) }
    // Bumped on every "new post", so the editor's saved state never carries over to the next post.
    var editorSession by rememberSaveable { mutableIntStateOf(0) }
    var deleting by remember { mutableStateOf<FoodPost?>(null) }
    var reporting by remember { mutableStateOf<ReportTarget?>(null) }
    var wanting by rememberSaveable { mutableStateOf<String?>(null) }
    var sheetFor by rememberSaveable { mutableStateOf<String?>(null) }
    val someone = stringResource(R.string.someone)
    val context = LocalContext.current
    val hue = Feature.FOOD.hue
    val listState = rememberLazyListState()
    PushHighlightScroll(listState, loaded = posts != null)
    // item_request / item_request_withdrawn push: open the Requests sheet on my post.
    val openRequests by container.push.openRequests.collectAsStateWithLifecycle()
    LaunchedEffect(openRequests, posts) {
        val id = openRequests ?: return@LaunchedEffect
        val post = posts?.firstOrNull { it.id == id } ?: return@LaunchedEffect
        container.push.consumeOpenRequests(id)
        if (post.userId == me) sheetFor = id
    }

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
                    action = { AddButton(stringResource(R.string.new_food_post), onClick = { editorSession++; editing = null; creating = true }, hue = hue) })
            }
            item(key = "stale") { com.boolaa.app.ui.components.StaleNotice(issue, vm::retryNow) }
            if (list == null) { item(key = "loading") { com.boolaa.app.ui.components.LoadingOrFailed(issue, vm::retryNow) }; return@LazyColumn }
            if (list.isEmpty()) {
                item(key = "empty") { EmptyState(stringResource(R.string.food_empty_title), stringResource(R.string.food_empty_message), hue = hue) }
                return@LazyColumn
            }
            if (mine.isEmpty()) item(key = "my-empty") {
                EmptyState(stringResource(R.string.food_empty_mine_title), stringResource(R.string.my_posts_empty), hue = hue)
            }
            itemsIndexed(mine, key = { _, p -> p.id }) { index, p ->
                val pick = com.boolaa.app.core.RequestRules.pick(requests, p.id)
                FoodCard(p, now, onEdit = { editorSession++; creating = false; editing = p }, onDelete = { deleting = p },
                    modifier = Modifier.pushHighlight(p.id).scrollFade(listState, p.id).popIn(index + 1),
                    reactions = reactionsByPost[p.id].orEmpty(), onReact = { vm.react(p.id, it) },
                    reservedFor = pick?.let { displayName(it.requester) },
                    footer = { OwnerRequestsButton(p.requestCount, hue, onClick = { sheetFor = p.id }) },
                    onCountClick = { sheetFor = p.id })
            }
            item(key = "bubble-header") { SectionHeader(stringResource(R.string.from_the_bubble), others.size, hue = hue) }
            if (others.isEmpty()) item(key = "bubble-empty") {
                EmptyState(stringResource(R.string.food_empty_others_title), stringResource(R.string.from_the_bubble_empty), hue = hue)
            }
            itemsIndexed(others, key = { _, p -> p.id }) { index, p ->
                val myRequest = com.boolaa.app.core.RequestRules.mine(requests, p.id, me)
                val view = com.boolaa.app.core.RequestRules.viewerState(p.availability, myRequest)
                val ownerName = p.user?.name?.takeIf { it.isNotBlank() } ?: someone
                val title = p.description?.takeIf { it.isNotBlank() } ?: stringResource(R.string.feed_new_food_post)
                FoodCard(p, now, onEdit = null, onDelete = null, modifier = Modifier.pushHighlight(p.id).scrollFade(listState, p.id).popIn(mine.size + index + 2),
                    reactions = reactionsByPost[p.id].orEmpty(), onReact = { vm.react(p.id, it) }, onReport = {
                        reporting = ReportTarget(ReportTargetType.FOOD_POST, p.id, p.userId, ownerName)
                    },
                    reservedForYou = view == com.boolaa.app.core.RequesterView.RESERVED_FOR_YOU,
                    footer = {
                        RequesterActions(view, title, ownerName, hue, busy = working == p.id,
                            onWant = { wanting = p.id }, onWithdraw = { myRequest?.let(vm::withdraw) })
                    })
            }
        }
    }
    if (creating || editing != null) {
        val resolver = LocalContext.current.contentResolver
        androidx.compose.runtime.key(editorSession) {
            FoodEditor(editing, busy, onDismiss = { creating = false; editing = null }) { picked, description, expiresAt ->
                val first = editing == null && posts.orEmpty().none { it.userId == me }
                vm.save(editing, picked, description, expiresAt, resolver) {
                    creating = false; editing = null
                    if (first) com.boolaa.app.ui.components.CheerCenter.show(com.boolaa.app.core.Cheer.FIRST_POST)
                }
            }
        }
    }
    wanting?.let { id -> posts?.firstOrNull { it.id == id } }?.let { post ->
        val id = post.id
        val ownerName = post.user?.name?.takeIf { it.isNotBlank() } ?: someone
        val sent = stringResource(R.string.requests_sent_toast, ownerName)
        IWantItSheet(hue, busy = working == id, onDismiss = { wanting = null }) { note ->
            wanting = null
            vm.request(id, post.userId, note) { android.widget.Toast.makeText(context, sent, android.widget.Toast.LENGTH_SHORT).show() }
        }
    }
    // Gone, expired or handed over: the sheet closes with it.
    sheetFor?.let { id -> posts?.firstOrNull { it.id == id } }?.let { post ->
        val id = post.id
        val rows = com.boolaa.app.core.RequestRules.sheetRows(requests, id)
        val pickedTemplate = stringResource(R.string.requests_picked_toast)
        RequestsSheet(com.boolaa.app.model.ItemKind.FOOD, post.description.orEmpty(), rows, busy = working == id, hue = hue,
            onPick = { r ->
                val text = pickedTemplate.format(r.requester?.name?.takeIf { it.isNotBlank() } ?: someone)
                vm.pick(r) { android.widget.Toast.makeText(context, text, android.widget.Toast.LENGTH_SHORT).show() }
            },
            onUndo = { vm.unpick(id) },
            onHandOver = { sheetFor = null; vm.handOver(id) },
            onDismiss = { sheetFor = null })
    }
    deleting?.let { p ->
        ConfirmDialog(stringResource(R.string.delete_post_title), p.description.orEmpty(), stringResource(R.string.delete),
            onConfirm = { vm.delete(p) }, onDismiss = { deleting = null })
    }
    reporting?.let { ReportSheet(it, onDismiss = { reporting = null }) }
    ErrorDialogFor(vm)
}

/** "Expires in 25 minutes" (warning colour under an hour), "Good until tomorrow 18:00", … (docs/boolaa-spec.md "Food expiry"). */
@Composable
fun expiryText(expiresAt: java.time.Instant, now: java.time.Instant): Pair<String, Boolean> {
    val locale = LocalConfiguration.current.locales[0]
    val zone = java.time.ZoneId.systemDefault()
    val label = com.boolaa.app.core.FoodExpiry.label(expiresAt, now, zone)
    fun time(at: java.time.Instant) = Formats.time(at, locale, zone)
    val text = when (label) {
        is com.boolaa.app.core.ExpiryLabel.Minutes -> pluralStringResource(R.plurals.food_expires_in_minutes, label.count, label.count)
        is com.boolaa.app.core.ExpiryLabel.Hours -> pluralStringResource(R.plurals.food_expires_in_hours, label.count, label.count)
        is com.boolaa.app.core.ExpiryLabel.Today -> stringResource(R.string.food_good_until_today, time(label.at))
        is com.boolaa.app.core.ExpiryLabel.Tomorrow -> stringResource(R.string.food_good_until_tomorrow, time(label.at))
        is com.boolaa.app.core.ExpiryLabel.Weekday -> stringResource(R.string.food_good_until_day,
            label.at.atZone(zone).dayOfWeek.getDisplayName(java.time.format.TextStyle.FULL, locale), time(label.at))
        is com.boolaa.app.core.ExpiryLabel.Date -> stringResource(R.string.food_good_until_date,
            java.time.format.DateTimeFormatter.ofPattern(
                android.text.format.DateFormat.getBestDateTimePattern(locale, "dMMM"), locale).format(label.at.atZone(zone)),
            time(label.at))
    }
    return text to label.warning
}

/** Full-width photo with the author pill floating bottom-left; badges top-left; description, expiry and actions below. */
@Composable
fun FoodCard(
    post: FoodPost, now: java.time.Instant, onEdit: (() -> Unit)?, onDelete: (() -> Unit)?, modifier: Modifier = Modifier, onReport: (() -> Unit)? = null,
    reactions: List<com.boolaa.app.core.ReactionSummary> = emptyList(), onReact: ((com.boolaa.app.model.ReactionKind) -> Unit)? = null,
    /** Owner: the picked person's name ("Reserved for {name}"). */
    reservedFor: String? = null,
    /** Requester: my request is the pick ("Reserved for you"). */
    reservedForYou: Boolean = false,
    onCountClick: (() -> Unit)? = null,
    footer: (@Composable () -> Unit)? = null,
) {
    val locale = LocalConfiguration.current.locales[0]
    val c = BoolaaTheme.colors
    val hue = Feature.FOOD.hue
    val picker = com.boolaa.app.ui.components.rememberReactionPicker()
    Column(modifier.boolaaCard(0.dp).testTag("food-${post.id}")) {
        // Long press on the photo opens the reaction picker.
        Box(if (onReact != null) Modifier.longPressToReact(picker) else Modifier) {
            RemoteImage(post.image, Modifier.fillMaxWidth().height(210.dp), stringResource(R.string.a11y_photo_from, displayName(post.user)))
            Row(Modifier.align(Alignment.TopStart).padding(10.dp), horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically) {
                when {
                    reservedForYou -> RequestBadge(stringResource(R.string.requests_reserved_for_you), hue, "reserved-for-you")
                    reservedFor != null -> RequestBadge(stringResource(R.string.requests_reserved_for, reservedFor), hue, "reserved-for")
                    else -> com.boolaa.app.ui.market.AvailabilityBadge(post.availability)
                }
                RequestCountPill(post.requestCount, hue, onClick = onCountClick)
            }
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
            Row(Modifier.padding(start = 16.dp, end = 4.dp, top = 6.dp, bottom = 0.dp).heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(description.orEmpty(), style = Type.body.copy(fontWeight = FontWeight.Medium), color = c.textPrimary, modifier = Modifier.weight(1f).padding(vertical = 6.dp))
                if (hasMenu) ItemMenu(onEdit, onDelete, onReport)
            }
        }
        post.expiresAt?.let { at ->
            val (text, warning) = expiryText(at, now)
            Row(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 6.dp, top = if (description != null || hasMenu) 0.dp else 10.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Icon(BoolaaIcons.Pending, contentDescription = null, tint = if (warning) c.dangerText else hue.text, modifier = Modifier.size(14.dp))
                Text(text, style = Type.caption, color = if (warning) c.dangerText else hue.text, modifier = Modifier.testTag("expiry-${post.id}"))
            }
        }
        if (footer != null) Box(Modifier.padding(start = 14.dp, end = 14.dp, bottom = 6.dp)) { footer() }
        if (onReact != null) {
            com.boolaa.app.ui.components.ReactionBar(reactions, onReact, Modifier.padding(start = 14.dp, end = 14.dp, bottom = 12.dp, top = 2.dp),
                hue = Feature.FOOD.hue, picker = picker, tag = "reactions-${post.id}")
        }
    }
}

/**
 * New / edit food post: photo, description and "Good until" (Today · Tomorrow · In 3 days · Custom, default Tomorrow).
 * [onSave] gets the expiry to send: always on create, on edit only when it was changed (else null).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FoodEditor(existing: FoodPost?, busy: Boolean, onDismiss: () -> Unit, onSave: (Uri?, String, java.time.Instant?) -> Unit) {
    val zone = java.time.ZoneId.systemDefault()
    val opened = remember { java.time.Instant.now() }
    var picked by rememberSaveable { mutableStateOf<Uri?>(null) }
    var description by rememberSaveable { mutableStateOf(existing?.description.orEmpty()) }
    val initialPreset = remember { existing?.expiresAt?.let { com.boolaa.app.core.FoodExpiry.presetFor(it, opened, zone) } ?: com.boolaa.app.core.ExpiryPreset.TOMORROW }
    var preset by rememberSaveable { mutableStateOf(initialPreset) }
    var custom by rememberSaveable {
        mutableStateOf(existing?.expiresAt?.takeIf { initialPreset == com.boolaa.app.core.ExpiryPreset.CUSTOM }?.toEpochMilli()
            ?: com.boolaa.app.core.FoodExpiry.defaultCustom(opened, zone).toEpochMilli())
    }
    var changed by rememberSaveable { mutableStateOf(existing == null) }
    var pickDate by rememberSaveable { mutableStateOf(false) }
    var pickTime by rememberSaveable { mutableStateOf(false) }
    val hue = Feature.FOOD.hue
    val c = BoolaaTheme.colors
    val locale = LocalConfiguration.current.locales[0]
    val todayOk = com.boolaa.app.core.FoodExpiry.todayEnabled(java.time.Instant.now(), zone)
    fun value(now: java.time.Instant): java.time.Instant =
        com.boolaa.app.core.FoodExpiry.presetValue(preset, now, zone) ?: java.time.Instant.ofEpochMilli(custom)
    BoolaaSheet(onDismiss, stringResource(if (existing == null) R.string.new_food_post else R.string.edit_food_post), tag = "food-editor", spacing = 12.dp) {
        PhotoField(existing?.image, picked, onPick = { picked = it }, hue = hue)
        BoolaaTextField(description, { description = it }, stringResource(R.string.description), Modifier.testTag("food-description"),
            singleLine = false, minLines = 2)
        Text(stringResource(R.string.food_good_until), style = Type.subheadline, color = c.textSecondary, modifier = Modifier.semantics { heading() })
        val options = buildList {
            if (todayOk || preset == com.boolaa.app.core.ExpiryPreset.TODAY) add(com.boolaa.app.core.ExpiryPreset.TODAY to stringResource(R.string.food_expiry_today))
            add(com.boolaa.app.core.ExpiryPreset.TOMORROW to stringResource(R.string.food_expiry_tomorrow))
            add(com.boolaa.app.core.ExpiryPreset.IN_3_DAYS to stringResource(R.string.food_expiry_in_3_days))
            add(com.boolaa.app.core.ExpiryPreset.CUSTOM to stringResource(R.string.food_expiry_custom))
        }
        SegmentedPill(options, preset, { p ->
            preset = p; changed = true
            if (p == com.boolaa.app.core.ExpiryPreset.CUSTOM) pickDate = true
        }, hue = hue, tagFor = { "expiry-${it.name.lowercase()}" })
        if (preset == com.boolaa.app.core.ExpiryPreset.CUSTOM) {
            val at = java.time.Instant.ofEpochMilli(custom)
            SecondaryButton(Formats.dateTime(at, locale, zone), onClick = { pickDate = true }, hue = hue,
                modifier = Modifier.fillMaxWidth().testTag("expiry-custom-value"))
        }
        Text(stringResource(R.string.food_expiry_hint), style = Type.caption, color = c.textSecondary)
        PrimaryButton(stringResource(R.string.save), onClick = {
            val now = java.time.Instant.now()
            val at = if (preset == com.boolaa.app.core.ExpiryPreset.CUSTOM) com.boolaa.app.core.FoodExpiry.clampCustom(value(now), now) else value(now)
            onSave(picked, description, if (changed) at else null)
        }, enabled = picked != null || existing != null, loading = busy, hue = hue, modifier = Modifier.padding(top = 4.dp).testTag("food-save"))
    }
    if (pickDate) {
        val now = java.time.Instant.now()
        val min = com.boolaa.app.core.FoodExpiry.customMin(now).atZone(zone).toLocalDate()
        val max = com.boolaa.app.core.FoodExpiry.customMax(now).atZone(zone).toLocalDate()
        val current = java.time.Instant.ofEpochMilli(custom).atZone(zone)
        val dpState = rememberDatePickerState(
            initialSelectedDateMillis = current.toLocalDate().atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toEpochMilli(),
            selectableDates = object : androidx.compose.material3.SelectableDates {
                override fun isSelectableDate(utcTimeMillis: Long): Boolean {
                    val d = java.time.Instant.ofEpochMilli(utcTimeMillis).atZone(java.time.ZoneOffset.UTC).toLocalDate()
                    return !d.isBefore(min) && !d.isAfter(max)
                }
                override fun isSelectableYear(year: Int) = year in min.year..max.year
            },
        )
        DatePickerDialog(
            onDismissRequest = { pickDate = false },
            confirmButton = {
                TextButton(onClick = {
                    dpState.selectedDateMillis?.let {
                        val d = java.time.Instant.ofEpochMilli(it).atZone(java.time.ZoneOffset.UTC).toLocalDate()
                        custom = d.atTime(current.toLocalTime()).atZone(zone).toInstant().toEpochMilli()
                    }
                    pickDate = false; pickTime = true
                }) { Text(stringResource(R.string.ok), style = Type.headline) }
            },
            dismissButton = { TextButton(onClick = { pickDate = false }) { Text(stringResource(R.string.cancel), style = Type.headline) } },
        ) { DatePicker(dpState) }
    }
    if (pickTime) {
        val current = java.time.Instant.ofEpochMilli(custom).atZone(zone)
        val tpState = rememberTimePickerState(current.hour, current.minute, android.text.format.DateFormat.is24HourFormat(LocalContext.current))
        AlertDialog(
            onDismissRequest = { pickTime = false },
            confirmButton = {
                TextButton(onClick = {
                    val chosen = current.toLocalDate().atTime(tpState.hour, tpState.minute).atZone(zone).toInstant()
                    custom = com.boolaa.app.core.FoodExpiry.clampCustom(chosen, java.time.Instant.now()).toEpochMilli()
                    pickTime = false
                }) { Text(stringResource(R.string.ok), style = Type.headline) }
            },
            dismissButton = { TextButton(onClick = { pickTime = false }) { Text(stringResource(R.string.cancel), style = Type.headline) } },
            text = { TimePicker(tpState) },
        )
    }
}
