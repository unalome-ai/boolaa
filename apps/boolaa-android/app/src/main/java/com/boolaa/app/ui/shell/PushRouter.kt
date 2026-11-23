package com.boolaa.app.ui.shell

import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.boolaa.app.core.PushRouting
import com.boolaa.app.core.PushScreen
import com.boolaa.app.push.PushManager
import com.boolaa.app.ui.LocalAppContainer
import com.boolaa.app.ui.theme.Brand
import com.boolaa.app.ui.theme.Radius
import kotlinx.coroutines.delay

/**
 * Routes a tapped notification (docs/push-notifications.md §5): switch to its bubble (only if it's still joined,
 * else Home), open the screen, and hand the target id to the screen to scroll to and highlight.
 */
@Composable
fun PushRouter(navigator: ShellNavigator) {
    val container = LocalAppContainer.current
    val pending by container.push.pendingOpen.collectAsStateWithLifecycle()
    LaunchedEffect(pending) {
        val payload = pending ?: return@LaunchedEffect
        val session = container.session
        // `approval`: the bubble was just joined; a reload brings it into the list before switching.
        val before = PushRouting.resolve(payload, session.state.value.bubbles.map { it.id })
        if (before.reloadFirst || before.bubbleId == null) session.reload()
        val dest = PushRouting.resolve(payload, session.state.value.bubbles.map { it.id })
        container.push.consumeOpen(payload)
        dest.bubbleId?.let { session.selectBubble(it) }
        container.push.setHighlight(dest.highlightId ?: PushManager.HIGHLIGHT_PENDING.takeIf { dest.screen == PushScreen.SETTINGS })
        container.push.setOpenRequests(dest.highlightId.takeIf { dest.openRequests })
        when (dest.screen) {
            PushScreen.HOME -> navigator.openTab(MainTab.HOME)
            PushScreen.CHAT -> {
                // `chat_mention`: open the chat on the message (like a search hit).
                dest.chatMessageId?.let { navigator.chatJump = it }
                navigator.openTab(MainTab.HOME); navigator.openChat()
            }
            PushScreen.SETTINGS -> navigator.openTab(MainTab.SETTINGS)
            PushScreen.EVENTS -> navigator.openTab(MainTab.EVENTS)
            PushScreen.FOOD -> navigator.openTab(MainTab.FOOD)
            PushScreen.MARKETPLACE -> navigator.openTab(MainTab.MARKETPLACE)
        }
    }
}

/** Scrolls a list to the item keyed by the pushed target id once [loaded]; the highlight fades after 4 s. */
@Composable
fun PushHighlightScroll(state: LazyListState, loaded: Boolean) = HighlightEffect(loaded,
    visible = { state.layoutInfo.visibleItemsInfo.map { it.key to it.index } },
    viewport = { state.layoutInfo.viewportSize.height },
    scrollBy = { state.scrollBy(it) }, scrollTo = { state.animateScrollToItem(it) })

@Composable
fun PushHighlightScroll(state: LazyGridState, loaded: Boolean) = HighlightEffect(loaded,
    visible = { state.layoutInfo.visibleItemsInfo.map { it.key to it.index } },
    viewport = { state.layoutInfo.viewportSize.height },
    scrollBy = { state.scrollBy(it) }, scrollTo = { state.animateScrollToItem(it) })

@Composable
private fun HighlightEffect(
    loaded: Boolean,
    visible: () -> List<Pair<Any, Int>>,
    viewport: () -> Int,
    scrollBy: suspend (Float) -> Float,
    scrollTo: suspend (Int) -> Unit,
) {
    val push = LocalAppContainer.current.push
    val target by push.highlight.collectAsStateWithLifecycle()
    LaunchedEffect(target, loaded) {
        val id = target ?: return@LaunchedEffect
        if (!loaded) return@LaunchedEffect
        delay(150) // first layout
        scanFor(id, visible, scrollBy, viewport())?.let { scrollTo(it) }
        delay(4_000)
        push.clearHighlight(id)
    }
}

/** Pages down until the keyed item is laid out (bubble lists are short; at most 30 pages). */
private suspend fun scanFor(key: Any, visible: () -> List<Pair<Any, Int>>, scrollBy: suspend (Float) -> Float, viewport: Int): Int? {
    val step = viewport.coerceAtLeast(400).toFloat() * 0.8f
    repeat(30) {
        visible().firstOrNull { it.first == key }?.let { return it.second }
        if (scrollBy(step) == 0f) return visible().firstOrNull { it.first == key }?.second
    }
    return null
}

/** A brand-coloured ring on the item a push pointed at, while it's highlighted. */
fun Modifier.pushHighlight(id: String): Modifier = composed {
    val target by LocalAppContainer.current.push.highlight.collectAsStateWithLifecycle()
    if (target == id) border(3.dp, Brand.hue.fill, RoundedCornerShape(Radius.card)) else this
}
