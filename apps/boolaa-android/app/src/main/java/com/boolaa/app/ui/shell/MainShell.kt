package com.boolaa.app.ui.shell

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
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
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

enum class MainTab(val route: String, @param:StringRes val title: Int, val icon: ImageVector, val activeIcon: ImageVector, val hue: Hue) {
    HOME("home", R.string.tab_home, BoolaaIcons.HomeOutline, BoolaaIcons.Home, Hue.grape),
    EVENTS("events", R.string.tab_events, BoolaaIcons.EventsOutline, BoolaaIcons.Events, Hue.coral),
    FOOD("food", R.string.tab_food, BoolaaIcons.FoodOutline, BoolaaIcons.Food, Hue.tangerine),
    MARKETPLACE("marketplace", R.string.tab_marketplace, BoolaaIcons.MarketOutline, BoolaaIcons.Market, Hue.mint),
    SETTINGS("settings", R.string.tab_settings, BoolaaIcons.SettingsOutline, BoolaaIcons.Settings, Hue.indigo);

    companion object {
        fun fromRoute(route: String?): MainTab? = entries.firstOrNull { it.route == route }
    }
}

object ShellRoutes {
    const val CHAT = "chat"
    const val LINKS = "links"
}

/** Navigation actions the tab screens use (deep links from Home cards, Links from Settings). */
class ShellNavigator(private val nav: NavHostController) {
    fun openTab(tab: MainTab) = nav.navigate(tab.route) {
        popUpTo(MainTab.HOME.route) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
    fun openChat() = nav.navigate(ShellRoutes.CHAT) { launchSingleTop = true }
    fun openLinks() = nav.navigate(ShellRoutes.LINKS) { launchSingleTop = true }
    fun back() = nav.popBackStack()
}

/** Main shell (spec §4): bubble glow, header with the bubble switcher, the tab content and the floating dock. */
@Composable
fun MainShell(initialTab: String? = null, initialOpen: String? = null) {
    val nav = rememberNavController()
    val navigator = remember(nav) { ShellNavigator(nav) }
    val backStack by nav.currentBackStackEntryAsState()
    val route = backStack?.destination?.route
    val tab = MainTab.fromRoute(route)
    var lastTab by remember { mutableStateOf(MainTab.HOME) }
    if (tab != null) lastTab = tab
    var showProfile by rememberSaveable { mutableStateOf(false) }
    var showAddBubble by rememberSaveable { mutableStateOf(false) }
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
        }
    }

    Box(Modifier.fillMaxSize().background(BoolaaTheme.colors.background)) {
        BubbleGlow(Hue.forId(state.currentBubble?.id))
        Column(Modifier.fillMaxSize()) {
            AnimatedVisibility(tab != null, enter = fadeIn(Motion.fade()), exit = fadeOut(Motion.fade())) {
                ShellHeader(title = stringResource(lastTab.title), onProfile = { showProfile = true }, onAddBubble = { showAddBubble = true })
            }
            val rise = with(androidx.compose.ui.platform.LocalDensity.current) { 14.dp.roundToPx() }
            NavHost(
                nav, startDestination = MainTab.HOME.route, modifier = Modifier.weight(1f),
                // Tab switch: new content rises 14dp with scale 0.98→1 and fades in; old content fades out.
                enterTransition = { fadeIn(tween(220)) + slideInVertically(Motion.gentle()) { rise } + scaleIn(Motion.gentle(), initialScale = 0.98f) },
                exitTransition = { fadeOut(tween(120)) },
                popEnterTransition = { fadeIn(tween(220)) },
                popExitTransition = { fadeOut(tween(120)) },
            ) {
                composable(MainTab.HOME.route) { HomeScreen(navigator) }
                composable(MainTab.EVENTS.route) { EventsScreen() }
                composable(MainTab.FOOD.route) { FoodScreen() }
                composable(MainTab.MARKETPLACE.route) { MarketplaceScreen() }
                composable(MainTab.SETTINGS.route) { SettingsScreen(navigator) }
                // Pushed screens slide in from the trailing edge, the platform's own idiom.
                val push = fadeIn(tween(200)) + slideInHorizontally(Motion.gentle()) { it / 5 }
                val pop = fadeOut(tween(160)) + slideOutHorizontally(Motion.gentle()) { it / 5 }
                composable(ShellRoutes.CHAT, enterTransition = { push }, popExitTransition = { pop }) { ChatScreen(onBack = { navigator.back() }) }
                composable(ShellRoutes.LINKS, enterTransition = { push }, popExitTransition = { pop }) { LinksScreen(onBack = { navigator.back() }) }
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
            )
        }
    }
    if (showProfile) ProfileSheet(onDismiss = { showProfile = false })
    if (showAddBubble) AddBubbleSheet(onDismiss = { showAddBubble = false })
}

/**
 * The app background is not flat: a soft radial glow in the current bubble's hue sits behind the header
 * (top-right, radius 340, plus a smaller wash top-left) and cross-fades when the bubble changes.
 */
@Composable
private fun BubbleGlow(hue: Hue) {
    val dark = BoolaaTheme.colors.isDark
    val main by animateColorAsState(hue.fill.copy(alpha = if (dark) 0.20f else 0.30f), Motion.gentle())
    val side by animateColorAsState(hue.glow.copy(alpha = if (dark) 0.12f else 0.22f), Motion.gentle())
    Box(Modifier.fillMaxWidth().height(380.dp).drawWithCache {
        val r = 340.dp.toPx()
        val mainBrush = Brush.radialGradient(listOf(main, Color.Transparent), center = Offset(size.width, 0f), radius = r)
        val sideBrush = Brush.radialGradient(listOf(side, Color.Transparent), center = Offset(0f, 20.dp.toPx()), radius = 240.dp.toPx())
        onDrawBehind { drawRect(mainBrush); drawRect(sideBrush) }
    })
}

/** Large rolling title, avatar button and the bubble chips with "+ New". No background: the glow shows through. */
@Composable
fun ShellHeader(title: String, onProfile: () -> Unit, onAddBubble: () -> Unit) {
    val container = LocalAppContainer.current
    val session = container.session
    val state by session.state.collectAsStateWithLifecycle()
    val unread by container.unread.counts.collectAsStateWithLifecycle()
    val view = LocalView.current
    Column(Modifier.fillMaxWidth().statusBarsPadding().padding(top = 8.dp, bottom = 6.dp)) {
        Row(Modifier.padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
            AnimatedContent(
                title, modifier = Modifier.weight(1f),
                transitionSpec = {
                    (slideInVertically(Motion.snappy()) { it / 2 } + fadeIn(Motion.fade()))
                        .togetherWith(slideOutVertically(Motion.snappy()) { -it / 2 } + fadeOut(tween(90)))
                        .using(SizeTransform(clip = false))
                },
            ) { text ->
                FitText(text, Type.screenTitle, color = BoolaaTheme.colors.textPrimary, minScale = 0.6f,
                    modifier = Modifier.fillMaxWidth().testTag("screen-title").semantics { heading() })
            }
            val profileLabel = stringResource(R.string.profile)
            Box(
                Modifier.padding(start = 12.dp).glow(BoolaaTheme.colors.cardShadow, 10.dp, 4.dp).clip(CircleShape)
                    .clickableRipple(scale = 0.88f, onClick = onProfile)
                    .semantics { contentDescription = profileLabel; role = Role.Button }
                    .testTag("profile-button"),
            ) { Avatar(state.profile, 44.dp) }
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
    Box(Modifier.fillMaxWidth().horizontalScroll(scroll).padding(horizontal = 16.dp, vertical = 12.dp)) {
        Row(
            Modifier.drawWithCache {
                val radius = CornerRadius(size.height / 2)
                val capsule = Brush.verticalGradient(listOf(top, bottom))
                val glowColor = top.copy(alpha = 0.32f)
                val hairline = Stroke(1.dp.toPx())
                onDrawBehind {
                    bounds.forEach { (id, b) ->
                        if (id != currentId) {
                            drawRoundRect(c.card, Offset(b.x, 0f), Size(b.y, size.height), radius)
                            drawRoundRect(c.hairline, Offset(b.x, 0f), Size(b.y, size.height), radius, style = hairline)
                        }
                    }
                    if (w > 0f) {
                        drawRoundRect(glowColor, Offset(x + 6.dp.toPx(), 5.dp.toPx()), Size(w - 12.dp.toPx(), size.height), radius)
                        drawRoundRect(capsule, Offset(x, 0f), Size(w, size.height), radius)
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
                    Row(
                        Modifier
                            .onGloballyPositioned { bounds[bubble.id] = Offset(it.positionInParent().x, it.size.width.toFloat()) }
                            .heightIn(min = 38.dp)
                            .clip(CircleShape)
                            .clickableRipple(role = Role.Tab) { onSelect(bubble) }
                            .semantics { selected = active }
                            .testTag("bubble-chip-${bubble.name}")
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
                        UnreadBadge(unread(bubble.id), tag = "unread-chip-${bubble.name}")
                    }
                }
            }
            val grapeText = Hue.grape.text
            Row(
                Modifier.heightIn(min = 38.dp).clip(CircleShape).dashedBorder(grapeText.copy(alpha = 0.55f), null, dash = 5.dp, gap = 4.dp)
                    .clickableRipple(role = Role.Button, onClick = onAdd).testTag("bubble-chip-new")
                    .padding(start = 12.dp, end = 16.dp, top = 8.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Icon(BoolaaIcons.Add, contentDescription = null, tint = grapeText, modifier = Modifier.size(18.dp))
                Text(stringResource(R.string.new_bubble_chip), color = grapeText, style = Type.chip, maxLines = 1)
            }
        }
    }
    // Forget chips of bubbles the user has left.
    LaunchedEffect(bubbles) { bounds.keys.retainAll(bubbles.map { it.id }.toSet()) }
}

/** The dock: pill tab bar plus the chat button, floating above a fade that lets content dissolve underneath. */
@Composable
fun Dock(selected: MainTab, onSelect: (MainTab) -> Unit, onChat: () -> Unit, modifier: Modifier = Modifier, chatUnread: Int = 0) {
    val c = BoolaaTheme.colors
    Box(
        modifier.fillMaxWidth().drawWithCache {
            val fade = Brush.verticalGradient(listOf(Color.Transparent, c.background.copy(alpha = 0.92f)), endY = size.height * 0.45f)
            onDrawBehind { drawRect(fade) }
        },
    ) {
        Row(
            Modifier.fillMaxWidth().navigationBarsPadding().padding(start = 16.dp, end = 16.dp, top = 28.dp, bottom = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically,
        ) {
            PillTabBar(selected, onSelect, Modifier.weight(1f))
            ChatButton(onChat, unread = chatUnread)
        }
    }
}

/** Floating capsule with five icon buttons. One filled circle slides to the active tab and takes its colour. */
@Composable
fun PillTabBar(selected: MainTab, onSelect: (MainTab) -> Unit, modifier: Modifier = Modifier) {
    val c = BoolaaTheme.colors
    val hue = selected.hue
    val position by animateFloatAsState(selected.ordinal.toFloat(), Motion.snappy())
    val top by animateColorAsState(hue.gradientTop, Motion.snappy())
    val bottom by animateColorAsState(hue.gradientBottom, Motion.snappy())
    Row(
        modifier
            .glow(c.floatingShadow, 18.dp, 10.dp)
            .clip(CircleShape)
            .background(c.card.copy(alpha = if (c.isDark) 0.92f else 0.9f))
            .border(1.dp, c.hairline, CircleShape)
            .padding(6.dp)
            .drawWithCache {
                val slot = size.width / MainTab.entries.size
                val r = minOf(26.dp.toPx(), slot / 2, size.height / 2)
                val fill = Brush.verticalGradient(listOf(top, bottom), startY = size.height / 2 - r, endY = size.height / 2 + r)
                val halo = Brush.radialGradient(listOf(top.copy(alpha = 0.45f), Color.Transparent), center = Offset.Zero, radius = r * 1.5f)
                onDrawBehind {
                    translate((position + 0.5f) * slot, size.height / 2) {
                        translate(0f, 5.dp.toPx()) { drawCircle(halo, r * 1.5f, Offset.Zero) }
                    }
                    drawCircle(fill, r, Offset((position + 0.5f) * slot, size.height / 2))
                }
            }
            .testTag("pill-tab-bar"),
    ) {
        MainTab.entries.forEach { tab ->
            val active = tab == selected
            val label = stringResource(tab.title)
            val tint by animateColorAsState(if (active) tab.hue.onFill else c.textSecondary, Motion.fade())
            Box(
                Modifier
                    .weight(1f)
                    .height(52.dp)
                    .clip(CircleShape)
                    .clickableRipple(scale = 0.88f) { onSelect(tab) }
                    .semantics { contentDescription = label; role = Role.Tab; this.selected = active }
                    .testTag("tab-${tab.route}"),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    if (active) tab.activeIcon else tab.icon, contentDescription = null, tint = tint,
                    modifier = Modifier.size(24.dp).bounceOn(active, from = 0.55f, enabled = active),
                )
            }
        }
    }
}

/** 60dp grape bubble orb that opens the chat; a ring pulses outward every 3.2 s. [unread] shows as a badge. */
@Composable
fun ChatButton(onClick: () -> Unit, modifier: Modifier = Modifier, unread: Int = 0) {
    val label = stringResource(R.string.open_chat)
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
        UnreadBadge(unread, Modifier.align(Alignment.TopEnd).offset(x = 4.dp, y = (-2).dp), tag = "chat-fab-badge")
    }
}
