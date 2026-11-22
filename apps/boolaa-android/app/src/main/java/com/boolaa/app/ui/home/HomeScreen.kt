package com.boolaa.app.ui.home

import com.boolaa.app.ui.settings.NotificationsAskCard
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.boolaa.app.AppContainer
import com.boolaa.app.R
import com.boolaa.app.core.Formats
import com.boolaa.app.model.Bubble
import com.boolaa.app.model.BubbleEvent
import com.boolaa.app.model.ChatMessage
import com.boolaa.app.model.FoodPost
import com.boolaa.app.model.MarketItem
import com.boolaa.app.model.MarketStatus
import com.boolaa.app.model.SharedLink
import com.boolaa.app.ui.BaseViewModel
import com.boolaa.app.ui.ErrorDialogFor
import com.boolaa.app.ui.LocalAppContainer
import com.boolaa.app.ui.components.BoolaaIcons
import com.boolaa.app.ui.components.BoolaaRefreshBox
import com.boolaa.app.ui.components.EmptyState
import com.boolaa.app.ui.components.FeatureBadge
import com.boolaa.app.ui.components.FitText
import com.boolaa.app.ui.components.RemoteImage
import com.boolaa.app.ui.components.SectionHeader
import com.boolaa.app.ui.components.SkeletonList
import com.boolaa.app.ui.components.boolaaCard
import com.boolaa.app.ui.components.clickableRipple
import com.boolaa.app.ui.components.displayName
import com.boolaa.app.ui.components.dockClearance
import com.boolaa.app.ui.components.glow
import com.boolaa.app.ui.components.popIn
import com.boolaa.app.ui.components.scrollFade
import com.boolaa.app.ui.shell.MainTab
import com.boolaa.app.ui.shell.ShellNavigator
import com.boolaa.app.ui.theme.BoolaaTheme
import com.boolaa.app.ui.theme.Feature
import com.boolaa.app.ui.theme.Hue
import com.boolaa.app.ui.theme.Radius
import com.boolaa.app.ui.theme.Type
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
            (messages.filterNot { it.isDeleted }.map(::Message) + food.map(::Food) + market.map(::Market) + events.map(::Event) + links.map(::Link))
                .sortedByDescending { it.date }
    }
}

class HomeViewModel(private val container: AppContainer, private val bubbleId: String) : BaseViewModel() {
    private val _items = MutableStateFlow<List<FeedItem>?>(null)
    val items = _items.asStateFlow()

    init {
        load()
        reloadOnBlockChange(container.session) { load() }
    }

    fun load(refresh: Boolean = false) = launchCatching(trackBusy = refresh) {
        val api = container.api
        _items.value = coroutineScope {
            // Deleted messages are skipped (spec "Chat": Home).
            val m = async { api.latestChatMessages(bubbleId, 5) }
            val f = async { api.foodPosts(bubbleId, 5) }
            val i = async { api.marketItems(bubbleId, 5) }
            val e = async { api.upcomingEvents(bubbleId, 5) }
            val l = async { api.links(bubbleId, 5) }
            FeedItem.combine(m.await(), f.await(), i.await(), e.await(), l.await())
        }
    }.also { job -> job.invokeOnCompletion { if (_items.value == null) _items.value = emptyList() } }
}

/** Combined recency-sorted feed for the current bubble (spec §5); cards deep-link to their section. */
@Composable
fun HomeScreen(navigator: ShellNavigator) {
    val container = LocalAppContainer.current
    val state by container.session.state.collectAsStateWithLifecycle()
    val bubble = state.currentBubble ?: return
    val vm: HomeViewModel = viewModel(key = "home-${bubble.id}") { HomeViewModel(container, bubble.id) }
    val items by vm.items.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val listState = rememberLazyListState()
    val firstName = state.profile?.name?.trim()?.split(Regex("\\s+"))?.firstOrNull()?.takeIf { it.isNotEmpty() }

    BoolaaRefreshBox(isRefreshing = busy, onRefresh = { vm.load(refresh = true) }, modifier = Modifier.fillMaxSize().testTag("home-screen")) {
        LazyColumn(
            state = listState,
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = dockClearance()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            item(key = "hero-${bubble.id}") {
                BubbleHero(bubble, firstName, onLinks = navigator::openLinks, modifier = Modifier.scrollFade(listState, "hero-${bubble.id}").popIn(0))
            }
            // Push: the permission is asked from this card's button, never at launch.
            item(key = "notifications-ask") { NotificationsAskCard() }
            val list = items
            when {
                list == null -> item(key = "loading") { SkeletonList(Modifier.padding(top = 8.dp)) }
                list.isEmpty() -> item(key = "empty") {
                    EmptyState(BoolaaIcons.Sparkles, stringResource(R.string.home_empty_title), stringResource(R.string.home_empty_message))
                }
                else -> {
                    item(key = "whats-new") { SectionHeader(stringResource(R.string.whats_new), modifier = Modifier.popIn(1)) }
                    itemsIndexed(list, key = { _, it -> it.key }) { index, item ->
                        FeedCard(item, Modifier.scrollFade(listState, item.key).popIn(index + 1), onClick = {
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
    }
    ErrorDialogFor(vm)
}

/** The current bubble as a big, glossy card in its own colour. */
@Composable
fun BubbleHero(bubble: Bubble, firstName: String?, onLinks: () -> Unit, modifier: Modifier = Modifier) {
    val hue = Hue.forId(bubble.id)
    val on = hue.onFill
    val shape = RoundedCornerShape(Radius.hero)
    Column(
        modifier.fillMaxWidth()
            .glow(hue.fill.copy(alpha = 0.4f), 16.dp, 10.dp, Radius.hero)
            .clip(shape)
            .background(hue.heroGradient)
            .drawBehind {
                // Decoration: plain white circles and one outlined ring, clipped to the card.
                drawCircle(Color.White.copy(alpha = 0.16f), 110.dp.toPx(), Offset(size.width - 30.dp.toPx(), 10.dp.toPx()))
                drawCircle(Color.White.copy(alpha = 0.14f), 34.dp.toPx(), Offset(size.width * 0.68f, size.height - 46.dp.toPx()))
                drawCircle(Color.White.copy(alpha = 0.5f), 15.dp.toPx(), Offset(size.width - 58.dp.toPx(), 42.dp.toPx()), style = Stroke(1.5.dp.toPx()))
            }
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (firstName != null) Text(stringResource(R.string.home_greeting, firstName), style = Type.chip, color = on)
        FitText(bubble.name, Type.title, color = on, maxLines = 2, minScale = 0.75f, modifier = Modifier.semantics { heading() })
        bubble.description?.takeIf { it.isNotBlank() }?.let {
            Text(it, style = Type.body, color = on, maxLines = 3, overflow = TextOverflow.Ellipsis)
        }
        Row(
            Modifier.padding(top = 8.dp).heightIn(min = 44.dp).padding(vertical = 4.dp).clip(CircleShape)
                .background(on.copy(alpha = 0.16f)).border(1.dp, on.copy(alpha = 0.25f), CircleShape)
                .clickableRipple(role = Role.Button, onClick = onLinks).testTag("home-links")
                .padding(horizontal = 14.dp, vertical = 7.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(BoolaaIcons.Link, contentDescription = null, tint = on, modifier = Modifier.size(18.dp))
            Text(stringResource(R.string.links), color = on, style = Type.chip)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun FeedCard(item: FeedItem, modifier: Modifier = Modifier, onClick: () -> Unit = {}) {
    val locale = LocalConfiguration.current.locales[0]
    val c = BoolaaTheme.colors
    val feature = when (item) {
        is FeedItem.Message -> Feature.CHAT
        is FeedItem.Food -> Feature.FOOD
        is FeedItem.Market -> Feature.MARKET
        is FeedItem.Event -> Feature.EVENTS
        is FeedItem.Link -> Feature.LINKS
    }
    val (icon, kind) = when (item) {
        is FeedItem.Message -> BoolaaIcons.Chat to R.string.feed_kind_chat
        is FeedItem.Food -> BoolaaIcons.Food to R.string.tab_food
        is FeedItem.Market -> BoolaaIcons.Market to R.string.tab_marketplace
        is FeedItem.Event -> BoolaaIcons.Events to R.string.feed_kind_event
        is FeedItem.Link -> BoolaaIcons.Link to R.string.feed_kind_link
    }
    val title = when (item) {
        is FeedItem.Message -> if (item.message.isPhotoOnly) stringResource(R.string.chat_photo) else item.message.content
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
    Row(
        modifier.boolaaCard(0.dp).clickableRipple(onClick = onClick).padding(16.dp).testTag("feed-${item.key}"),
        verticalAlignment = Alignment.Top,
    ) {
        FeatureBadge(icon, feature.hue)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            // The kind and the time share a line when they fit and wrap at large font sizes or long translations.
            FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(stringResource(kind).uppercase(locale), style = Type.caption, color = feature.hue.text, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(end = 8.dp))
                Text(Formats.relative(item.date, locale), style = Type.caption2, color = c.textSecondary, maxLines = 1)
            }
            Text(title, style = Type.bodyStrong, color = c.textPrimary, maxLines = 2, overflow = TextOverflow.Ellipsis)
            subtitle?.let { Text(it, style = Type.subheadline, color = c.textSecondary, maxLines = 2, overflow = TextOverflow.Ellipsis) }
        }
        if (image != null) {
            Spacer(Modifier.width(12.dp))
            RemoteImage(image, Modifier.size(60.dp).clip(RoundedCornerShape(14.dp)))
        }
    }
}
