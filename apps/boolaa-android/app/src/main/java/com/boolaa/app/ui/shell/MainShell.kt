package com.boolaa.app.ui.shell

import androidx.annotation.StringRes
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Restaurant
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Storefront
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Restaurant
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Storefront
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
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
import com.boolaa.app.ui.LocalAppContainer
import com.boolaa.app.ui.chat.ChatScreen
import com.boolaa.app.ui.components.Avatar
import com.boolaa.app.ui.components.BoolaaChip
import com.boolaa.app.ui.components.NewChip
import com.boolaa.app.ui.components.clickableRipple
import com.boolaa.app.ui.events.EventsScreen
import com.boolaa.app.ui.food.FoodScreen
import com.boolaa.app.ui.home.HomeScreen
import com.boolaa.app.ui.links.LinksScreen
import com.boolaa.app.ui.market.MarketplaceScreen
import com.boolaa.app.ui.profile.ProfileSheet
import com.boolaa.app.ui.settings.SettingsScreen
import com.boolaa.app.ui.theme.Brand
import com.boolaa.app.ui.theme.BoolaaTheme

enum class MainTab(val route: String, @param:StringRes val title: Int, val icon: ImageVector, val activeIcon: ImageVector) {
    HOME("home", R.string.tab_home, Icons.Outlined.Home, Icons.Filled.Home),
    EVENTS("events", R.string.tab_events, Icons.Outlined.CalendarMonth, Icons.Filled.CalendarMonth),
    FOOD("food", R.string.tab_food, Icons.Outlined.Restaurant, Icons.Filled.Restaurant),
    MARKETPLACE("marketplace", R.string.tab_marketplace, Icons.Outlined.Storefront, Icons.Filled.Storefront),
    SETTINGS("settings", R.string.tab_settings, Icons.Outlined.Settings, Icons.Filled.Settings);

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

/** Main shell (spec §4): header with bubble switcher, the tab content, floating pill bar and chat FAB. */
@Composable
fun MainShell(initialTab: String? = null, initialOpen: String? = null) {
    val nav = rememberNavController()
    val navigator = ShellNavigator(nav)
    val backStack by nav.currentBackStackEntryAsState()
    val route = backStack?.destination?.route
    val tab = MainTab.fromRoute(route)
    var showProfile by rememberSaveable { mutableStateOf(false) }
    var showAddBubble by rememberSaveable { mutableStateOf(false) }

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
        Column(Modifier.fillMaxSize()) {
            if (tab != null) {
                ShellHeader(title = stringResource(tab.title), onProfile = { showProfile = true }, onAddBubble = { showAddBubble = true })
            }
            NavHost(nav, startDestination = MainTab.HOME.route, modifier = Modifier.weight(1f)) {
                composable(MainTab.HOME.route) { HomeScreen(navigator) }
                composable(MainTab.EVENTS.route) { EventsScreen() }
                composable(MainTab.FOOD.route) { FoodScreen() }
                composable(MainTab.MARKETPLACE.route) { MarketplaceScreen() }
                composable(MainTab.SETTINGS.route) { SettingsScreen(navigator) }
                composable(ShellRoutes.CHAT) { ChatScreen(onBack = { navigator.back() }) }
                composable(ShellRoutes.LINKS) { LinksScreen(onBack = { navigator.back() }) }
            }
        }
        if (tab != null) {
            ChatFab(
                onClick = navigator::openChat,
                modifier = Modifier.align(Alignment.BottomEnd).navigationBarsPadding().padding(end = 20.dp, bottom = 96.dp),
            )
            PillTabBar(
                selected = tab,
                onSelect = navigator::openTab,
                modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 12.dp),
            )
        }
    }
    if (showProfile) ProfileSheet(onDismiss = { showProfile = false })
    if (showAddBubble) AddBubbleSheet(onDismiss = { showAddBubble = false })
}

/** Large title, avatar button and horizontal bubble chips with "+ New". */
@Composable
fun ShellHeader(title: String, onProfile: () -> Unit, onAddBubble: () -> Unit) {
    val session = LocalAppContainer.current.session
    val state by session.state.collectAsStateWithLifecycle()
    val current = state.currentBubble
    val listState = rememberLazyListState()
    LaunchedEffect(current?.id) {
        val index = state.bubbles.indexOfFirst { it.id == current?.id }
        if (index >= 0) listState.animateScrollToItem(index)
    }
    Column(Modifier.fillMaxWidth().background(BoolaaTheme.colors.background).statusBarsPadding().padding(top = 8.dp, bottom = 12.dp)) {
        Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                title,
                style = MaterialTheme.typography.displaySmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f).testTag("screen-title"),
            )
            val profileLabel = stringResource(R.string.profile)
            Box(
                Modifier.clip(CircleShape).clickableRipple(onProfile)
                    .semantics { contentDescription = profileLabel; role = Role.Button }
                    .testTag("profile-button"),
            ) { Avatar(state.profile, 42.dp) }
        }
        Spacer(Modifier.size(12.dp))
        LazyRow(
            state = listState,
            contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(state.bubbles, key = { it.id }) { bubble ->
                val active = bubble.id == current?.id
                BoolaaChip(
                    title = bubble.name,
                    active = active,
                    modifier = Modifier
                        .clip(CircleShape)
                        .clickableRipple { session.selectBubble(bubble.id) }
                        .semantics { selected = active }
                        .testTag("bubble-chip-${bubble.name}"),
                )
            }
            item(key = "new") {
                NewChip(stringResource(R.string.new_bubble_chip), Modifier.clip(CircleShape).clickableRipple(onAddBubble).testTag("bubble-chip-new"))
            }
        }
    }
}

/** Floating rounded pill with circular icon buttons; the active one is filled purple with a white icon. */
@Composable
fun PillTabBar(selected: MainTab, onSelect: (MainTab) -> Unit, modifier: Modifier = Modifier) {
    val c = BoolaaTheme.colors
    Row(
        modifier
            .shadow(16.dp, CircleShape, ambientColor = Color.Black.copy(alpha = 0.2f), spotColor = Color.Black.copy(alpha = 0.2f))
            .clip(CircleShape)
            .background(c.card)
            .border(1.dp, Brand.purple.copy(alpha = 0.25f), CircleShape)
            .padding(horizontal = 10.dp, vertical = 8.dp)
            .testTag("pill-tab-bar"),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        MainTab.entries.forEach { tab ->
            val active = tab == selected
            val bg by animateColorAsState(if (active) Brand.purple else Color.Transparent, label = "tab-bg")
            val label = stringResource(tab.title)
            Box(
                Modifier
                    .size(50.dp)
                    .clip(CircleShape)
                    .background(bg)
                    .clickableRipple { onSelect(tab) }
                    .semantics { contentDescription = label; role = Role.Tab; this.selected = active }
                    .testTag("tab-${tab.route}"),
                contentAlignment = Alignment.Center,
            ) {
                Icon(if (active) tab.activeIcon else tab.icon, contentDescription = null, tint = if (active) Color.White else Brand.purple)
            }
        }
    }
}

/** Purple 56dp chat button, bottom right above the tab bar. */
@Composable
fun ChatFab(onClick: () -> Unit, modifier: Modifier = Modifier) {
    val label = stringResource(R.string.open_chat)
    Box(
        modifier
            .shadow(8.dp, CircleShape)
            .size(56.dp)
            .clip(CircleShape)
            .background(Brand.purple)
            .clickableRipple(onClick)
            .semantics { contentDescription = label; role = Role.Button }
            .testTag("chat-fab"),
        contentAlignment = Alignment.Center,
    ) { Icon(Icons.Filled.Forum, contentDescription = null, tint = Color.White) }
}
