package com.boolaa.app.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.ChatBubble
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Restaurant
import androidx.compose.material.icons.filled.Sell
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.boolaa.app.AppContainer
import com.boolaa.app.R
import com.boolaa.app.core.Formats
import com.boolaa.app.model.BubbleEvent
import com.boolaa.app.model.ChatMessage
import com.boolaa.app.model.FoodPost
import com.boolaa.app.model.MarketItem
import com.boolaa.app.model.MarketStatus
import com.boolaa.app.model.SharedLink
import com.boolaa.app.ui.BaseViewModel
import com.boolaa.app.ui.ErrorDialogFor
import com.boolaa.app.ui.LocalAppContainer
import com.boolaa.app.ui.components.EmptyState
import com.boolaa.app.ui.components.LoadingBox
import com.boolaa.app.ui.components.RemoteImage
import com.boolaa.app.ui.components.boolaaCard
import com.boolaa.app.ui.components.clickableRipple
import com.boolaa.app.ui.components.displayName
import com.boolaa.app.ui.shell.MainTab
import com.boolaa.app.ui.shell.ShellNavigator
import com.boolaa.app.ui.theme.Brand
import com.boolaa.app.ui.theme.BoolaaTheme
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.net.URI
import java.time.Instant

/** One entry of the combined Home feed. */
sealed class FeedItem {
    abstract val key: String
    /** Recency key: when the item was posted. */
    abstract val date: Instant

    data class Message(val message: ChatMessage) : FeedItem() { override val key = "m-${message.id}"; override val date = message.createdAt }
    data class Food(val post: FoodPost) : FeedItem() { override val key = "f-${post.id}"; override val date = post.createdAt }
    data class Market(val item: MarketItem) : FeedItem() { override val key = "i-${item.id}"; override val date = item.createdAt }
    data class Event(val event: BubbleEvent) : FeedItem() { override val key = "e-${event.id}"; override val date = event.createdAt }
    data class Link(val link: SharedLink) : FeedItem() { override val key = "l-${link.id}"; override val date = link.createdAt }

    companion object {
        /** Merges the sections into one feed, newest first. */
        fun combine(
            messages: List<ChatMessage>, food: List<FoodPost>, market: List<MarketItem>,
            events: List<BubbleEvent>, links: List<SharedLink>,
        ): List<FeedItem> =
            (messages.map(::Message) + food.map(::Food) + market.map(::Market) + events.map(::Event) + links.map(::Link))
                .sortedByDescending { it.date }
    }
}

class HomeViewModel(private val container: AppContainer, private val bubbleId: String) : BaseViewModel() {
    private val _items = MutableStateFlow<List<FeedItem>?>(null)
    val items = _items.asStateFlow()

    init { load() }

    fun load(refresh: Boolean = false) = launchCatching(trackBusy = refresh) {
        val api = container.api
        _items.value = coroutineScope {
            val m = async { api.chatMessages(bubbleId, 5) }
            val f = async { api.foodPosts(bubbleId, 5) }
            val i = async { api.marketItems(bubbleId, 5) }
            val e = async { api.upcomingEvents(bubbleId, 5) }
            val l = async { api.links(bubbleId, 5) }
            FeedItem.combine(m.await(), f.await(), i.await(), e.await(), l.await())
        }
    }.also { job -> job.invokeOnCompletion { if (_items.value == null) _items.value = emptyList() } }
}

/** Combined recency-sorted feed for the current bubble (spec §5); cards deep-link to their section. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(navigator: ShellNavigator) {
    val container = LocalAppContainer.current
    val state by container.session.state.collectAsStateWithLifecycle()
    val bubble = state.currentBubble ?: return
    val vm: HomeViewModel = viewModel(key = "home-${bubble.id}") { HomeViewModel(container, bubble.id) }
    val items by vm.items.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()

    PullToRefreshBox(isRefreshing = busy, onRefresh = { vm.load(refresh = true) }, modifier = Modifier.fillMaxSize().testTag("home-screen")) {
        LazyColumn(
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = Brand.tabBarClearance),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            item(key = "bubble") {
                Row(Modifier.boolaaCard(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(bubble.name, style = MaterialTheme.typography.titleMedium)
                        bubble.description?.takeIf { it.isNotBlank() }?.let {
                            Text(it, style = MaterialTheme.typography.bodyMedium, color = BoolaaTheme.colors.textSecondary)
                        }
                    }
                    AssistChip(
                        onClick = navigator::openLinks,
                        label = { Text(stringResource(R.string.links), fontWeight = FontWeight.SemiBold) },
                        leadingIcon = { Icon(Icons.Default.Link, contentDescription = null, tint = Brand.purple) },
                        colors = AssistChipDefaults.assistChipColors(labelColor = Brand.purple),
                        modifier = Modifier.testTag("home-links"),
                    )
                }
            }
            val list = items
            when {
                list == null -> item { LoadingBox() }
                list.isEmpty() -> item { EmptyState(Icons.Default.AutoAwesome, stringResource(R.string.home_empty_title), stringResource(R.string.home_empty_message)) }
                else -> items(list, key = { it.key }) { item ->
                    FeedCard(item, Modifier.clip(RoundedCornerShape(Brand.cardRadius)).clickableRipple {
                        when (item) {
                            is FeedItem.Message -> navigator.openChat()
                            is FeedItem.Food -> navigator.openTab(MainTab.FOOD)
                            is FeedItem.Market -> navigator.openTab(MainTab.MARKETPLACE)
                            is FeedItem.Event -> navigator.openTab(MainTab.EVENTS)
                            is FeedItem.Link -> navigator.openLinks()
                        }
                    })
                }
            }
        }
    }
    ErrorDialogFor(vm)
}

@Composable
fun FeedCard(item: FeedItem, modifier: Modifier = Modifier) {
    val locale = LocalConfiguration.current.locales[0]
    val (icon, kind) = when (item) {
        is FeedItem.Message -> Icons.Default.ChatBubble to R.string.feed_kind_chat
        is FeedItem.Food -> Icons.Default.Restaurant to R.string.tab_food
        is FeedItem.Market -> Icons.Default.Sell to R.string.tab_marketplace
        is FeedItem.Event -> Icons.Default.CalendarMonth to R.string.feed_kind_event
        is FeedItem.Link -> Icons.Default.Link to R.string.feed_kind_link
    }
    val title = when (item) {
        is FeedItem.Message -> item.message.content
        is FeedItem.Food -> item.post.description?.takeIf { it.isNotBlank() } ?: stringResource(R.string.feed_new_food_post)
        is FeedItem.Market -> item.item.title
        is FeedItem.Event -> item.event.title
        is FeedItem.Link -> item.link.title?.takeIf { it.isNotBlank() } ?: item.link.url
    }
    val subtitle: String? = when (item) {
        is FeedItem.Message -> displayName(item.message.sender)
        is FeedItem.Food -> stringResource(R.string.by_author, displayName(item.post.user))
        is FeedItem.Market -> stringResource(
            R.string.market_subtitle,
            stringResource(if (item.item.status == MarketStatus.FREE) R.string.status_free else R.string.status_trade),
            displayName(item.item.owner),
        )
        is FeedItem.Event -> listOfNotNull(Formats.dateTime(item.event.datetime, locale), item.event.location?.takeIf { it.isNotBlank() }).joinToString(" · ")
        is FeedItem.Link -> if (item.link.tags.isEmpty()) runCatching { URI(item.link.url).host }.getOrNull() else item.link.tags.joinToString(" ") { "#$it" }
    }
    val image = when (item) {
        is FeedItem.Food -> item.post.image
        is FeedItem.Market -> item.item.image
        else -> null
    }
    Row(modifier.boolaaCard().testTag("feed-${item.key}"), verticalAlignment = Alignment.Top) {
        Box(Modifier.size(42.dp).clip(RoundedCornerShape(12.dp)).background(Brand.purple.copy(alpha = 0.14f)), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = Brand.purple, modifier = Modifier.size(20.dp))
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    stringResource(kind).uppercase(locale), style = MaterialTheme.typography.labelSmall, color = Brand.purple,
                    fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                Text(Formats.relative(item.date, locale), style = MaterialTheme.typography.labelSmall, color = BoolaaTheme.colors.textSecondary)
            }
            Text(title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
            subtitle?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = BoolaaTheme.colors.textSecondary, maxLines = 2, overflow = TextOverflow.Ellipsis) }
        }
        if (image != null) {
            Spacer(Modifier.width(12.dp))
            RemoteImage(image, Modifier.size(56.dp).clip(RoundedCornerShape(10.dp)))
        }
    }
}
