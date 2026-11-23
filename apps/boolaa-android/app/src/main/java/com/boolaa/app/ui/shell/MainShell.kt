package com.boolaa.app.ui.shell

import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.consumeWindowInsets
import com.boolaa.app.ui.settings.NotificationsScreen
import com.boolaa.app.core.SearchHit
import com.boolaa.app.core.SearchKind
import com.boolaa.app.ui.search.SearchScreen
import com.boolaa.app.ui.components.CircleIconButton
import androidx.annotation.StringRes
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Stable
import androidx.compose.runtime.key
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.asComposeRenderEffect
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import com.boolaa.app.core.BandScreen
import com.boolaa.app.core.DockLayout
import com.boolaa.app.ui.components.BandedHeader
import com.boolaa.app.ui.components.CheerCenter
import com.boolaa.app.ui.components.CheerHost
import com.boolaa.app.ui.components.DisplayTitle
import kotlinx.coroutines.delay
import androidx.compose.material3.PlainTooltip
import com.boolaa.app.R
import com.boolaa.app.model.Bubble
import com.boolaa.app.ui.LocalAppContainer
import com.boolaa.app.ui.chat.ChatScreen
import com.boolaa.app.ui.components.Avatar
import com.boolaa.app.ui.components.BoolaaIcons
import com.boolaa.app.ui.components.BubbleOrb
import com.boolaa.app.ui.components.BubbleLogo
import com.boolaa.app.ui.components.FitText
import com.boolaa.app.ui.components.Haptics
import com.boolaa.app.ui.components.UnreadBadge
import com.boolaa.app.ui.components.bounceOn
import com.boolaa.app.ui.components.clickableRipple
import com.boolaa.app.ui.components.dashedBorder
import com.boolaa.app.ui.components.glow
import com.boolaa.app.ui.components.rememberAmbientTime
import com.boolaa.app.ui.components.tapArea
import com.boolaa.app.ui.components.tapVisual
import com.boolaa.app.ui.events.EventsScreen
import com.boolaa.app.ui.food.FoodScreen
import com.boolaa.app.ui.home.HomeScreen
import com.boolaa.app.ui.links.LinksScreen
import com.boolaa.app.ui.market.MarketplaceScreen
import com.boolaa.app.ui.profile.ProfileSheet
import com.boolaa.app.ui.settings.SettingsScreen
import com.boolaa.app.ui.theme.BoolaaTheme
import com.boolaa.app.ui.theme.Hue
import com.boolaa.app.ui.theme.Motion
import com.boolaa.app.ui.theme.Type
import kotlin.math.floor

/**
 * The five tabs. [title] is the screen title (full name), [dock] the short dock name (`nav.dock.*`, docs/i18n-glossary.md
 * "Dock short labels"): the active pill's label and every tab's content description.
 */
enum class MainTab(
    val route: String, @param:StringRes val title: Int, @param:StringRes val dock: Int, val icon: ImageVector, val activeIcon: ImageVector,
    val band: BandScreen,
) {
    HOME("home", R.string.tab_home, R.string.dock_home, BoolaaIcons.HomeOutline, BoolaaIcons.Home, BandScreen.HOME),
    EVENTS("events", R.string.tab_events, R.string.dock_events, BoolaaIcons.EventsOutline, BoolaaIcons.Events, BandScreen.EVENTS),
    FOOD("food", R.string.tab_food, R.string.dock_food, BoolaaIcons.FoodOutline, BoolaaIcons.Food, BandScreen.FOOD),
    MARKETPLACE("marketplace", R.string.tab_marketplace, R.string.dock_marketplace, BoolaaIcons.MarketOutline, BoolaaIcons.Market, BandScreen.MARKETPLACE),
    SETTINGS("settings", R.string.tab_settings, R.string.dock_settings, BoolaaIcons.SettingsOutline, BoolaaIcons.Settings, BandScreen.SETTINGS);

    /** The feature colour: the band and the dock pill (§8.1). */
    val hue: Hue get() = band.hue(Hue.grape)

    companion object {
        fun fromRoute(route: String?): MainTab? = entries.firstOrNull { it.route == route }
    }
}

object ShellRoutes {
    const val CHAT = "chat"
    const val LINKS = "links"
    const val NOTIFICATIONS = "notifications"
    const val SEARCH = "search"
}

/** Navigation actions the tab screens use (deep links from Home cards, Links from Settings). */
class ShellNavigator(private val nav: NavHostController) {
    /** Text to prefill (not send) in the chat composer, e.g. "Ask in chat" on a market item. Consumed by the chat. */
    var chatDraft by mutableStateOf<com.boolaa.app.ui.chat.ChatDraft?>(null)
    /** A chat message to open in context (a search hit). Consumed by the chat. */
    var chatJump by mutableStateOf<String?>(null)

    fun openTab(tab: MainTab) = nav.navigate(tab.route) {
        popUpTo(MainTab.HOME.route) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
    fun openChat(draft: com.boolaa.app.ui.chat.ChatDraft? = null) {
        if (draft != null) chatDraft = draft
        nav.navigate(ShellRoutes.CHAT) { launchSingleTop = true }
    }
    fun openLinks() = nav.navigate(ShellRoutes.LINKS) { launchSingleTop = true }
    fun openNotifications() = nav.navigate(ShellRoutes.NOTIFICATIONS) { launchSingleTop = true }
    fun openSearch() = nav.navigate(ShellRoutes.SEARCH) { launchSingleTop = true }

    /**
     * A tapped search hit: close search and open it in context with the push highlight machinery (scroll to it, ring
     * for 4 s). Chat messages load the chat around the message ([chatJump]).
     */
    fun openSearchHit(hit: SearchHit, highlight: (String) -> Unit) {
        if (nav.currentBackStackEntry?.destination?.route == ShellRoutes.SEARCH) nav.popBackStack()
        when (hit.kind) {
            SearchKind.CHAT_MESSAGE -> { chatJump = hit.id; nav.navigate(ShellRoutes.CHAT) { launchSingleTop = true } }
            SearchKind.EVENT -> { highlight(hit.id); openTab(MainTab.EVENTS) }
            SearchKind.FOOD_POST -> { highlight(hit.id); openTab(MainTab.FOOD) }
            SearchKind.MARKET_ITEM -> { highlight(hit.id); openTab(MainTab.MARKETPLACE) }
            SearchKind.SHARED_LINK -> { highlight(hit.id); openLinks() }
        }
    }
    fun back() = nav.popBackStack()
}

/** Main shell (spec §4): feature band + header with the bubble switcher, the tab content, the glass dock and the cheer toast. */
@Composable
fun MainShell(initialTab: String? = null, initialOpen: String? = null, initialCheer: String? = null) {
    val nav = rememberNavController()
    val navigator = remember(nav) { ShellNavigator(nav) }
    val backStack by nav.currentBackStackEntryAsState()
    val route = backStack?.destination?.route
    val tab = MainTab.fromRoute(route)
    var lastTab by remember { mutableStateOf(MainTab.HOME) }
    if (tab != null) lastTab = tab
    var showProfile by rememberSaveable { mutableStateOf(false) }
    var showAddBubble by rememberSaveable { mutableStateOf(false) }
    var showMascots by rememberSaveable { mutableStateOf(false) }
    val container = LocalAppContainer.current
    val state by container.session.state.collectAsStateWithLifecycle()
    val unread by container.unread.counts.collectAsStateWithLifecycle()
    val view = LocalView.current

    LaunchedEffect(Unit) {
        MainTab.entries.firstOrNull { it.route == initialTab }?.let { if (it != MainTab.HOME) navigator.openTab(it) }
        when (initialOpen) {
            "chat" -> navigator.openChat()
            "links" -> navigator.openLinks()
            "profile" -> showProfile = true
            "addBubble" -> showAddBubble = true
            "mascots" -> if (com.boolaa.app.BuildConfig.DEBUG) showMascots = true
        }
        // Screenshot aid (debug builds): a cheer toast on demand.
        com.boolaa.app.core.Cheer.fromDebug(initialCheer)?.let { cheer ->
            delay(600)
            val bubble = container.session.state.value.currentBubble
            CheerCenter.show(cheer, Hue.forId(bubble?.id), bubble?.name)
        }
    }
    // Admitted to a bubble: its Home cheers once, in that bubble's colour (§8.4).
    val currentId = state.currentBubble?.id
    LaunchedEffect(currentId, tab) {
        val bubble = state.currentBubble ?: return@LaunchedEffect
        if (tab == MainTab.HOME && container.session.takeWelcome(bubble.id)) {
            delay(300)
            CheerCenter.show(com.boolaa.app.core.Cheer.JOINED, Hue.forId(bubble.id), bubble.name)
        }
    }
    // §8.3 glass: what scrolls under the dock is recorded once per frame and drawn blurred behind the bar (API 31+).
    val backdrop = remember { DockBackdrop() }
    // A tapped notification: switch bubble and open its screen.
    PushRouter(navigator)

    val contentLayer = androidx.compose.ui.graphics.rememberGraphicsLayer()
    backdrop.layer = contentLayer
    Box(Modifier.fillMaxSize().background(BoolaaTheme.colors.background)) {
        Column(
            Modifier.fillMaxSize()
                .onGloballyPositioned { backdrop.origin = it.positionInRoot() }
                .drawWithContent {
                    contentLayer.record { this@drawWithContent.drawContent() }
                    drawLayer(contentLayer)
                    // Without read observation: the content must not invalidate itself by bumping the counter.
                    androidx.compose.runtime.snapshots.Snapshot.withoutReadObservation { backdrop.frames.longValue++ }
                },
        ) {
            AnimatedVisibility(tab != null, enter = fadeIn(Motion.fade()), exit = fadeOut(Motion.fade())) {
                // §8.1: the band is exactly as tall as the header (and the status bar above it), in the tab's feature colour.
                BandedHeader(lastTab.band.hue(Hue.forId(state.currentBubble?.id))) {
                    ShellHeader(title = stringResource(lastTab.title), onProfile = { showProfile = true }, onAddBubble = { showAddBubble = true },
                        onSearch = { navigator.openSearch() }, gradientTitle = lastTab == MainTab.HOME)
                }
            }
            // Offline / unreachable / "Back online" (docs/boolaa-spec.md "Offline and poor network"). On pushed screens
            // (no shell header) it sits under the status bar and the screen below gives up its own status-bar padding.
            val netStatus by container.connectivity.status.collectAsStateWithLifecycle()
            val backOnline by container.connectivity.backOnline.collectAsStateWithLifecycle()
            val bannerOnTop = tab == null && (netStatus != com.boolaa.app.core.NetStatus.ONLINE || backOnline)
            com.boolaa.app.ui.components.ConnectivityBanner(if (bannerOnTop) Modifier.statusBarsPadding() else Modifier)
            val rise = with(androidx.compose.ui.platform.LocalDensity.current) { 14.dp.roundToPx() }
            // Reduced motion: every screen change is the 200 ms fade, nothing rises, scales or slides.
            val reduce = BoolaaTheme.reduceMotion
            NavHost(
                nav, startDestination = MainTab.HOME.route,
                modifier = Modifier.weight(1f).then(
                    if (bannerOnTop) Modifier.consumeWindowInsets(androidx.compose.foundation.layout.WindowInsets.statusBars) else Modifier,
                ),
                // Tab switch: new content rises 14dp with scale 0.98→1 and fades in; old content fades out.
                enterTransition = {
                    if (reduce) fadeIn(Motion.fade())
                    else fadeIn(tween(220)) + slideInVertically(Motion.gentle()) { rise } + scaleIn(Motion.gentle(), initialScale = 0.98f)
                },
                exitTransition = { fadeOut(tween(120)) },
                popEnterTransition = { fadeIn(tween(220)) },
                popExitTransition = { fadeOut(tween(120)) },
            ) {
                composable(MainTab.HOME.route) { HomeScreen(navigator) }
                composable(MainTab.EVENTS.route) { EventsScreen() }
                composable(MainTab.FOOD.route) { FoodScreen() }
                composable(MainTab.MARKETPLACE.route) { MarketplaceScreen(onAskInChat = { navigator.openChat(it) }) }
                composable(MainTab.SETTINGS.route) { SettingsScreen(navigator) }
                // Pushed screens slide in from the trailing edge, the platform's own idiom.
                val push = if (reduce) fadeIn(Motion.fade()) else fadeIn(tween(200)) + slideInHorizontally(Motion.gentle()) { it / 5 }
                val pop = if (reduce) fadeOut(Motion.fade()) else fadeOut(tween(160)) + slideOutHorizontally(Motion.gentle()) { it / 5 }
                composable(ShellRoutes.CHAT, enterTransition = { push }, popExitTransition = { pop }) {
                    ChatScreen(onBack = { navigator.back() }, pendingDraft = navigator.chatDraft, onDraftTaken = { navigator.chatDraft = null },
                        pendingJump = navigator.chatJump, onJumpTaken = { navigator.chatJump = null })
                }
                composable(ShellRoutes.LINKS, enterTransition = { push }, popExitTransition = { pop }) { LinksScreen(onBack = { navigator.back() }) }
                composable(ShellRoutes.NOTIFICATIONS, enterTransition = { push }, popExitTransition = { pop }) {
                    NotificationsScreen(onBack = { navigator.back() })
                }
                composable(ShellRoutes.SEARCH, enterTransition = { push }, popExitTransition = { pop }) {
                    SearchScreen(onBack = { navigator.back() }, onOpen = { hit -> navigator.openSearchHit(hit) { container.push.setHighlight(it) } })
                }
            }
        }
        AnimatedVisibility(
            tab != null, modifier = Modifier.align(Alignment.BottomCenter),
            enter = fadeIn(Motion.fade()) + slideInVertically(Motion.gentle()) { it / 2 },
            exit = fadeOut(Motion.fade()) + slideOutVertically(Motion.gentle()) { it / 2 },
        ) {
            Dock(
                selected = lastTab,
                onSelect = { if (it != tab) { Haptics.selection(view); navigator.openTab(it) } },
                onChat = { Haptics.light(view); navigator.openChat() },
                chatUnread = state.currentBubble?.let { unread[it.id]?.unreadCount } ?: 0,
                backdrop = backdrop,
            )
        }
        CheerHost()
    }
    if (showProfile) ProfileSheet(onDismiss = { showProfile = false })
    if (showAddBubble) AddBubbleSheet(onDismiss = { showAddBubble = false })
    if (showMascots) com.boolaa.app.ui.components.MascotGallery(onDismiss = { showMascots = false })
}

/**
 * Display title (§8.5, the brand gradient on Home only), search and avatar buttons and the bubble chips with "+ New".
 * No background: it sits on the feature band, and every control on it has its own opaque surface.
 */
@Composable
fun ShellHeader(title: String, onProfile: () -> Unit, onAddBubble: () -> Unit, onSearch: () -> Unit = {}, gradientTitle: Boolean = false) {
    val container = LocalAppContainer.current
    val session = container.session
    val state by session.state.collectAsStateWithLifecycle()
    val unread by container.unread.counts.collectAsStateWithLifecycle()
    val view = LocalView.current
    // 16 below the visible chips: the chip row's 7 + the chips' 5 inset + 4.
    Column(Modifier.fillMaxWidth().statusBarsPadding().padding(top = 8.dp, bottom = 4.dp)) {
        Row(Modifier.padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
            val reduce = BoolaaTheme.reduceMotion
            AnimatedContent(
                title, modifier = Modifier.weight(1f),
                transitionSpec = {
                    if (reduce) return@AnimatedContent fadeIn(Motion.fade()) togetherWith fadeOut(Motion.fade())
                    (slideInVertically(Motion.snappy()) { it / 2 } + fadeIn(Motion.fade()))
                        .togetherWith(slideOutVertically(Motion.snappy()) { -it / 2 } + fadeOut(tween(90)))
                        .using(SizeTransform(clip = false))
                },
            ) { text ->
                // 38 black, up to two lines, auto-sized down to 26 before it would truncate a long translation.
                DisplayTitle(text, gradient = gradientTitle, modifier = Modifier.fillMaxWidth().testTag("screen-title"))
            }
            // Search this bubble, next to the avatar.
            CircleIconButton(BoolaaIcons.Search, stringResource(R.string.search_open), onSearch,
                Modifier.padding(start = 10.dp).testTag("search-button"), surface = true, size = 44.dp)
            val profileLabel = stringResource(R.string.profile)
            Box(
                Modifier.padding(start = 8.dp).size(48.dp).clip(CircleShape)
                    .clickableRipple(scale = 0.88f, onClick = onProfile)
                    .semantics { contentDescription = profileLabel; role = Role.Button }
                    .testTag("profile-button"),
                contentAlignment = Alignment.Center,
            ) { Avatar(state.profile, 44.dp, Modifier.glow(BoolaaTheme.colors.cardShadow, 10.dp, 4.dp)) }
        }
        BubbleChips(
            bubbles = state.bubbles, currentId = state.currentBubble?.id,
            unread = { unread[it]?.unreadCount ?: 0 },
            onSelect = { if (it.id != state.currentBubble?.id) { Haptics.bubble(view); session.selectBubble(it.id) } },
            onAdd = onAddBubble,
        )
    }
}

/**
 * Bubble switcher. One capsule in the active bubble's gradient slides between the chips (snappy) and takes the
 * new bubble's colour; the chip's orb pulses; the row scrolls the active chip to the centre.
 */
@Composable
private fun BubbleChips(bubbles: List<Bubble>, currentId: String?, unread: (String) -> Int, onSelect: (Bubble) -> Unit, onAdd: () -> Unit) {
    val c = BoolaaTheme.colors
    val scroll = rememberScrollState()
    // Chip id → (x, width) inside the row, for the sliding capsule and the inactive chip surfaces.
    val bounds = remember { mutableStateMapOf<String, Offset>() }
    val hue = Hue.forId(currentId)
    val target = currentId?.let { bounds[it] }
    var placed by remember { mutableStateOf(false) }
    val spec = if (placed) Motion.snappy<Float>() else snap()
    val x by animateFloatAsState(target?.x ?: 0f, spec)
    val w by animateFloatAsState(target?.y ?: 0f, spec)
    val top by animateColorAsState(hue.gradientTop, Motion.snappy())
    val bottom by animateColorAsState(hue.gradientBottom, Motion.snappy())
    LaunchedEffect(target) {
        if (target == null) return@LaunchedEffect
        placed = true
        val centre = target.x + target.y / 2 - scroll.viewportSize / 2
        scroll.animateScrollTo(centre.toInt().coerceIn(0, scroll.maxValue.coerceAtLeast(0)))
    }
    Box(Modifier.fillMaxWidth().horizontalScroll(scroll).padding(horizontal = 16.dp, vertical = 7.dp).selectableGroup()) {
        Row(
            Modifier.drawWithCache {
                val radius = CornerRadius(size.height / 2)
                val capsule = Brush.verticalGradient(listOf(top, bottom))
                val glowColor = top.copy(alpha = 0.32f)
                val hairline = Stroke(1.dp.toPx())
                // Chips are 48dp tall touch targets; the visible capsule stays 38dp (inset 5dp) until the text needs more.
                val inset = if (size.height <= 48.5f.dp.toPx()) 5.dp.toPx() else 0f
                val h = size.height - 2 * inset
                val visible = CornerRadius(h / 2)
                onDrawBehind {
                    bounds.forEach { (id, b) ->
                        if (id != currentId) {
                            drawRoundRect(c.card, Offset(b.x, inset), Size(b.y, h), visible)
                            drawRoundRect(c.hairline, Offset(b.x, inset), Size(b.y, h), visible, style = hairline)
                        }
                    }
                    if (w > 0f) {
                        drawRoundRect(glowColor, Offset(x + 6.dp.toPx(), inset + 5.dp.toPx()), Size(w - 12.dp.toPx(), h), visible)
                        drawRoundRect(capsule, Offset(x, inset), Size(w, h), visible)
                    }
                }
            },
            horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            bubbles.forEach { bubble ->
                androidx.compose.runtime.key(bubble.id) {
                    val active = bubble.id == currentId
                    val chipHue = Hue.forId(bubble.id)
                    val textColor by animateColorAsState(if (active) chipHue.onFill else c.textPrimary, Motion.fade())
                    val count = unread(bubble.id)
                    val unreadLabel = if (count > 0) pluralStringResource(R.plurals.chat_unread, count, count) else null
                    // One TalkBack stop per chip: "Flatmates, 3 unread messages", tab role, "Selected" on the current one.
                    val chipLabel = listOfNotNull(bubble.name, unreadLabel).joinToString(", ")
                    Row(
                        Modifier
                            .onGloballyPositioned { bounds[bubble.id] = Offset(it.positionInParent().x, it.size.width.toFloat()) }
                            .heightIn(min = 48.dp)
                            .clip(CircleShape)
                            .clickableRipple(role = Role.Tab) { onSelect(bubble) }
                            .testTag("bubble-chip-${bubble.name}")
                            .clearAndSetSemantics { contentDescription = chipLabel; selected = active; role = Role.Tab }
                            .padding(start = 11.dp, end = 16.dp, top = 8.dp, bottom = 8.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp),
                    ) {
                        // Logo photo when set (a 20dp circle reads as a photo), else the bubble's 16dp orb.
                        BubbleLogo(
                            bubble.id, bubble.name, bubble.logo, size = if (bubble.logo.isNullOrBlank()) 16.dp else 20.dp,
                            modifier = Modifier.bounceOn(active, from = 1.45f, enabled = active)
                                .then(if (active) Modifier.border(1.5.dp, Color.White, CircleShape) else Modifier),
                        )
                        Text(bubble.name, color = textColor, style = Type.chip, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        UnreadBadge(count, tag = "unread-chip-${bubble.name}")
                    }
                }
            }
            val grapeText = Hue.grape.text
            val newSource = remember { MutableInteractionSource() }
            val view = LocalView.current
            var addTaps by remember { mutableIntStateOf(0) }
            Box(Modifier.tapArea(newSource, role = Role.Button) { addTaps++; Haptics.light(view); onAdd() }.testTag("bubble-chip-new"), contentAlignment = Alignment.Center) {
                Row(
                    Modifier.heightIn(min = 38.dp)
                        // On a card fill: it sits on the feature band (§8.1), where only opaque controls go.
                        .tapVisual(newSource, CircleShape, Modifier.background(c.card).dashedBorder(grapeText.copy(alpha = 0.55f), null, dash = 5.dp, gap = 4.dp))
                        .padding(start = 12.dp, end = 16.dp, top = 8.dp, bottom = 8.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Icon(BoolaaIcons.Add, contentDescription = null, tint = grapeText, modifier = Modifier.size(18.dp).bounceOn(addTaps))
                    Text(stringResource(R.string.new_bubble_chip), color = grapeText, style = Type.chip, maxLines = 1)
                }
            }
        }
    }
    // Forget chips of bubbles the user has left.
    LaunchedEffect(bubbles) { bounds.keys.retainAll(bubbles.map { it.id }.toSet()) }
}

/**
 * What scrolls beneath the dock: the shell content recorded into [layer] each time it draws, with its root position,
 * so the glass can draw it blurred (§8.3). [frames] ticks on every recording so the dock redraws with it.
 */
@Stable
class DockBackdrop {
    var layer: androidx.compose.ui.graphics.layer.GraphicsLayer? = null
    var origin by mutableStateOf(Offset.Zero)
    val frames = androidx.compose.runtime.mutableLongStateOf(0L)
}

/** The dock (§8.3): the labelled glass tab bar plus the chat button, floating above a fade that lets content dissolve. */
@Composable
fun Dock(
    selected: MainTab, onSelect: (MainTab) -> Unit, onChat: () -> Unit, modifier: Modifier = Modifier, chatUnread: Int = 0,
    backdrop: DockBackdrop? = null,
) {
    val c = BoolaaTheme.colors
    androidx.compose.foundation.layout.BoxWithConstraints(
        modifier.fillMaxWidth().drawWithCache {
            val fade = Brush.verticalGradient(listOf(Color.Transparent, c.background.copy(alpha = 0.92f)), endY = size.height * 0.45f)
            onDrawBehind { drawRect(fade) }
        },
    ) {
        // Re-measured on rotation, window resize, text-size and locale change (all recompose this).
        val rowWidth = maxWidth.value
        val margin = DockLayout.sideMargin(rowWidth).dp
        Row(
            Modifier.fillMaxWidth().navigationBarsPadding().padding(start = margin, end = margin, top = 28.dp, bottom = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(DockLayout.GAP.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            PillTabBar(selected, onSelect, Modifier.weight(1f), rowWidth = rowWidth, backdrop = backdrop)
            ChatButton(onChat, unread = chatUnread)
        }
    }
}

/** The pill's label: fades in over 200 ms after 60 ms while moving 4 → 0 dp from the leading side (reduced motion: fade only). */
@Composable
private fun DockLabel(text: String, color: Color) {
    val reduce = BoolaaTheme.reduceMotion
    val progress = remember { androidx.compose.animation.core.Animatable(0f) }
    LaunchedEffect(Unit) {
        progress.animateTo(1f, tween(200, delayMillis = if (reduce) 0 else 60, easing = androidx.compose.animation.core.LinearOutSlowInEasing))
    }
    Text(
        text, style = Type.dockLabel, color = color, maxLines = 1, softWrap = false,
        // The tab's content description is the same word (label in name); the text itself is not a second stop.
        modifier = Modifier.clearAndSetSemantics { }.graphicsLayer {
            alpha = progress.value
            if (!reduce) translationX = -(1f - progress.value) * 4.dp.toPx()
        },
    )
}

/**
 * Glass pill tab bar. The active tab is a capsule in the feature gradient with icon + short label that slides and
 * stretches between tabs (`snappy`) and changes colour (200 ms); when the label doesn't fit (or at font scale ≥ 1.5)
 * it is a 46 dp circle and the name lives on as the content description. Reduced motion: the pill jumps, the label fades.
 */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun PillTabBar(
    selected: MainTab, onSelect: (MainTab) -> Unit, modifier: Modifier = Modifier, rowWidth: Float = 412f, backdrop: DockBackdrop? = null,
) {
    val c = BoolaaTheme.colors
    val reduce = BoolaaTheme.reduceMotion
    val density = LocalDensity.current
    val measurer = androidx.compose.ui.text.rememberTextMeasurer()
    val label = stringResource(selected.dock)
    val labelWidth = with(density) { measurer.measure(label, Type.dockLabel, maxLines = 1, softWrap = false).size.width.toDp().value }
    val showsLabel = DockLayout.showsLabel(labelWidth, rowWidth, density.fontScale)
    val pill = if (showsLabel) DockLayout.labelledPillWidth(labelWidth) else null
    val barWidth = DockLayout.barWidth(rowWidth)
    val active = MainTab.entries.indexOf(selected)
    val slots = DockLayout.slotWidths(barWidth, active, pill)
    val before = slots.take(active).sum()
    val indicatorWidth = pill ?: DockLayout.TAB_HEIGHT
    val indicatorX = before + if (pill == null) (slots[active] - DockLayout.TAB_HEIGHT) / 2 else 0f
    val move: androidx.compose.animation.core.AnimationSpec<Float> = if (reduce) snap() else Motion.snappy()
    val x by animateFloatAsState(indicatorX, move)
    val w by animateFloatAsState(indicatorWidth, move)
    val hue = selected.hue
    val top by animateColorAsState(hue.gradientTop, tween(200))
    val bottom by animateColorAsState(hue.gradientBottom, tween(200))
    val blur = android.os.Build.VERSION.SDK_INT >= 31 && backdrop != null
    val glass = when {
        !blur -> com.boolaa.app.ui.theme.BrandTokens.GLASS_NO_BLUR
        c.isDark -> com.boolaa.app.ui.theme.BrandTokens.GLASS_DARK
        else -> com.boolaa.app.ui.theme.BrandTokens.GLASS_LIGHT
    }
    val edge = Color.White.copy(alpha = if (c.isDark) com.boolaa.app.ui.theme.BrandTokens.GLASS_EDGE_DARK else com.boolaa.app.ui.theme.BrandTokens.GLASS_EDGE_LIGHT)
    val shadowBig = if (c.isDark) Color.Black.copy(alpha = 0.6f) else Color(0x522A1B5E)
    val shadowSmall = if (c.isDark) Color.Black.copy(alpha = 0.3f) else Color(0x142A1B5E)
    val blurLayer = androidx.compose.ui.graphics.rememberGraphicsLayer()
    var barOrigin by remember { mutableStateOf(Offset.Zero) }
    if (blur) {
        LaunchedEffect(blurLayer, density) {
            val r = with(density) { 24.dp.toPx() }
            val saturate = android.graphics.ColorMatrixColorFilter(android.graphics.ColorMatrix().apply { setSaturation(1.8f) })
            blurLayer.renderEffect = android.graphics.RenderEffect.createChainEffect(
                android.graphics.RenderEffect.createColorFilterEffect(saturate),
                android.graphics.RenderEffect.createBlurEffect(r, r, android.graphics.Shader.TileMode.CLAMP),
            ).asComposeRenderEffect()
        }
    }
    Box(
        modifier
            .width(barWidth.coerceAtLeast(0f).dp)
            .glow(shadowBig, 36.dp, 16.dp, spread = (-12).dp)
            .glow(shadowSmall, 6.dp, 2.dp)
            .clip(CircleShape)
            .onGloballyPositioned { barOrigin = it.positionInRoot() }
            .drawBehind {
                val source = backdrop?.layer
                if (blur && source != null && source.size.width > 0) {
                    backdrop.frames.longValue // redraw whenever the content re-records
                    blurLayer.record(source.size) { drawLayer(source) }
                    translate(backdrop.origin.x - barOrigin.x, backdrop.origin.y - barOrigin.y) { drawLayer(blurLayer) }
                }
                drawRect(c.card.copy(alpha = glass))
            }
            .border(1.dp, c.hairline, CircleShape)
            .drawWithCache {
                // 1 dp inner highlight along the top edge.
                val highlight = Brush.verticalGradient(0f to edge, 0.3f to Color.Transparent)
                val stroke = Stroke(1.dp.toPx())
                val inset = 0.5.dp.toPx()
                onDrawWithContent {
                    drawRoundRect(highlight, Offset(inset, inset), Size(size.width - 2 * inset, size.height - 2 * inset), CornerRadius(size.height / 2), style = stroke)
                    drawContent()
                }
            }
            .padding(horizontal = DockLayout.BAR_PADDING.dp)
            .testTag("pill-tab-bar"),
    ) {
        // The active pill (decorative): feature gradient with its glow.
        Box(
            Modifier.align(Alignment.CenterStart).offset { IntOffset(x.dp.roundToPx(), 0) }.width(w.dp).height(DockLayout.TAB_HEIGHT.dp)
                .glow(top.copy(alpha = 0.45f), 16.dp, 4.dp)
                .clip(CircleShape).background(Brush.verticalGradient(listOf(top, bottom))),
        )
        Row(Modifier.selectableGroup(), verticalAlignment = Alignment.CenterVertically) {
            MainTab.entries.forEachIndexed { index, tab ->
                val isActive = tab == selected
                val labelled = isActive && pill != null
                val name = stringResource(tab.dock)
                val tint by animateColorAsState(if (isActive) tab.hue.onFill else c.textSecondary, Motion.fade())
                val tooltip = androidx.compose.material3.rememberTooltipState()
                androidx.compose.material3.TooltipBox(
                    positionProvider = androidx.compose.material3.TooltipDefaults.rememberTooltipPositionProvider(
                        androidx.compose.material3.TooltipAnchorPosition.Above),
                    tooltip = { PlainTooltip { Text(name) } },
                    state = tooltip, enableUserInput = !isActive,
                ) {
                    Row(
                        Modifier
                            .width(slots[index].coerceAtLeast(0f).dp)
                            // Touch target: the slot's width and the bar's full height (56 dp).
                            .height((DockLayout.TAB_HEIGHT + 2 * DockLayout.BAR_PADDING).dp)
                            .clickableRipple(scale = 0.88f) { onSelect(tab) }
                            .semantics { contentDescription = name; role = Role.Tab; this.selected = isActive }
                            .testTag("tab-${tab.route}")
                            .padding(start = if (labelled) DockLayout.PILL_LEADING.dp else 0.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = if (labelled) Arrangement.Start else Arrangement.Center,
                    ) {
                        // Icon pop: 0.4 → 1 with `bouncy` when the tab becomes active (still under reduced motion).
                        Icon(
                            if (isActive) tab.activeIcon else tab.icon, contentDescription = null, tint = tint,
                            modifier = Modifier.size(DockLayout.ICON.dp).bounceOn(isActive, from = 0.4f, enabled = isActive),
                        )
                        if (labelled) {
                            Spacer(Modifier.width(DockLayout.ICON_GAP.dp))
                            key(tab) { DockLabel(name, tint) }
                        }
                    }
                }
            }
        }
    }
}


/** 60dp grape bubble orb that opens the chat; a ring pulses outward every 3.2 s. [unread] shows as a badge. */
@Composable
fun ChatButton(onClick: () -> Unit, modifier: Modifier = Modifier, unread: Int = 0) {
    val unreadLabel = if (unread > 0) pluralStringResource(R.plurals.chat_unread, unread, unread) else null
    // "Open chat, 3 unread messages": the badge is read with the button, not as a separate stop.
    val label = listOfNotNull(stringResource(R.string.open_chat), unreadLabel).joinToString(", ")
    val time = rememberAmbientTime()
    var taps by remember { mutableIntStateOf(0) }
    Box(modifier.size(60.dp), contentAlignment = Alignment.Center) {
        Box(
            Modifier.matchParentSize().graphicsLayer {
                val p = time.floatValue / 3.2f
                val phase = p - floor(p)
                val running = time.floatValue > 0f
                scaleX = 1f + 0.4f * phase; scaleY = scaleX
                alpha = if (running) 0.45f * (1f - phase) else 0f
            }.border(2.dp, Hue.grape.fill, CircleShape),
        )
        Box(
            Modifier.matchParentSize()
                .glow(Hue.grape.fill.copy(alpha = 0.45f), 16.dp, 8.dp)
                .clip(CircleShape)
                .clickableRipple(scale = 0.88f) { taps++; onClick() }
                .semantics { contentDescription = label; role = Role.Button }
                .testTag("chat-fab"),
            contentAlignment = Alignment.Center,
        ) {
            BubbleOrb(Hue.grape, Modifier.matchParentSize())
            Icon(BoolaaIcons.Chat, contentDescription = null, tint = Color.White, modifier = Modifier.size(26.dp).bounceOn(taps))
        }
        UnreadBadge(unread, Modifier.align(Alignment.TopEnd).offset(x = 4.dp, y = (-2).dp), tag = "chat-fab-badge", labelled = false)
    }
}
