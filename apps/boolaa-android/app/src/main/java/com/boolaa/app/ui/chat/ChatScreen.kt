package com.boolaa.app.ui.chat

import android.util.Log
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.boolaa.app.AppContainer
import com.boolaa.app.R
import com.boolaa.app.core.BoolaaJson
import com.boolaa.app.core.Formats
import com.boolaa.app.model.ChatMessage
import com.boolaa.app.model.UserProfile
import com.boolaa.app.model.ReportTarget
import com.boolaa.app.model.ReportTargetType
import com.boolaa.app.ui.safety.ReportSheet
import com.boolaa.app.ui.BaseViewModel
import com.boolaa.app.ui.ErrorDialogFor
import com.boolaa.app.ui.LocalAppContainer
import io.github.jan.supabase.realtime.PostgresAction
import io.github.jan.supabase.realtime.RealtimeChannel
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.postgresChangeFlow
import io.github.jan.supabase.realtime.realtime
import io.github.jan.supabase.postgrest.query.filter.FilterOperator
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.UUID
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.boolaa.app.ui.components.Avatar
import com.boolaa.app.ui.components.BoolaaIcons
import com.boolaa.app.ui.components.EmptyState
import com.boolaa.app.ui.components.Haptics
import com.boolaa.app.ui.components.PushedHeader
import com.boolaa.app.ui.components.SkeletonList
import com.boolaa.app.ui.components.bounceOn
import com.boolaa.app.ui.components.clickableRipple
import com.boolaa.app.ui.components.displayName
import com.boolaa.app.ui.components.glow
import com.boolaa.app.ui.components.popFrom
import com.boolaa.app.ui.theme.BoolaaTheme
import com.boolaa.app.ui.theme.Hue
import com.boolaa.app.ui.theme.Motion
import com.boolaa.app.ui.theme.Type

/** Pure de-dup/merge of chat messages: realtime and our own insert may both deliver the same row. */
object ChatMerge {
    fun merge(messages: List<ChatMessage>, incoming: ChatMessage, authors: Map<String, UserProfile>): List<ChatMessage> {
        val message = if (incoming.sender == null) incoming.copy(sender = authors[incoming.senderId]) else incoming
        val idx = messages.indexOfFirst { it.id == message.id }
        if (idx >= 0) {
            if (messages[idx].sender == null && message.sender != null) return messages.toMutableList().also { it[idx] = message }
            return messages
        }
        val out = messages + message
        return if (out.size > 1 && out[out.size - 2].createdAt > message.createdAt) out.sortedBy { it.createdAt } else out
    }
}

class ChatViewModel(private val container: AppContainer, private val bubbleId: String) : BaseViewModel() {
    private val _messages = MutableStateFlow<List<ChatMessage>?>(null)
    val messages = _messages.asStateFlow()
    private val authors = mutableMapOf<String, UserProfile>()
    private var channel: RealtimeChannel? = null

    init {
        load()
        listen()
        // RLS hides blocked authors; drop their messages now and reload (unblock brings them back).
        reloadOnBlockChange(container.session) {
            val blocked = container.session.state.value.blockedIds
            _messages.update { it?.filterNot { m -> m.senderId in blocked } }
            launchCatching(trackBusy = false) {
                val fresh = container.api.chatMessages(bubbleId)
                _messages.value = fresh.fold(emptyList()) { acc, m -> ChatMerge.merge(acc, m, authors) }
            }
        }
    }

    private fun merge(message: ChatMessage) {
        message.sender?.let { authors[it.id] = it }
        _messages.update { ChatMerge.merge(it.orEmpty(), message, authors) }
    }

    private fun load() = launchCatching(trackBusy = false) {
        coroutineScope {
            val msgs = async { container.api.chatMessages(bubbleId) }
            val members = async { container.api.members(bubbleId) }
            members.await().forEach { m -> m.user?.let { authors[it.id] = it } }
            val loaded = msgs.await()
            _messages.update { current -> (current.orEmpty() + loaded).fold(emptyList()) { acc, m -> ChatMerge.merge(acc, m, authors) } }
        }
    }.also { it.invokeOnCompletion { if (_messages.value == null) _messages.value = emptyList() } }

    /** Realtime INSERT feed filtered by bubble_id (records carry "2026-11-22 15:26:52.4+00" timestamps). */
    private fun listen() {
        val ch = container.api.client.channel("chat:$bubbleId:${UUID.randomUUID()}")
        channel = ch
        val inserts = ch.postgresChangeFlow<PostgresAction.Insert>(schema = "public") {
            table = "chat_messages"
            filter("bubble_id", FilterOperator.EQ, bubbleId)
        }
        viewModelScope.launch {
            inserts.collect { action ->
                runCatching { BoolaaJson.json.decodeFromJsonElement(ChatMessage.serializer(), action.record) }
                    .onSuccess(::merge)
                    .onFailure { Log.w("Boolaa", "bad realtime record", it) }
            }
        }
        viewModelScope.launch {
            runCatching { ch.subscribe() }.onFailure { Log.w("Boolaa", "realtime subscribe failed", it) }
        }
    }

    fun send(senderId: String, text: String, onFailure: (String) -> Unit) {
        val content = text.trim().take(4000)
        if (content.isEmpty()) return
        launchCatching(trackBusy = true) {
            try {
                merge(container.api.sendMessage(bubbleId, senderId, content))
            } catch (e: Throwable) {
                onFailure(text)
                throw e
            }
        }
    }

    override fun onCleared() {
        val ch = channel ?: return
        container.appScope.launch { runCatching { container.api.client.realtime.removeChannel(ch) } }
    }
}

/** Bubble chat with realtime inserts and auto-scroll (spec §6). */
@Composable
fun ChatScreen(onBack: () -> Unit) {
    val container = LocalAppContainer.current
    val state by container.session.state.collectAsStateWithLifecycle()
    val bubble = state.currentBubble ?: return
    val me = state.userId ?: return
    val vm: ChatViewModel = viewModel(key = "chat-${bubble.id}") { ChatViewModel(container, bubble.id) }
    val messages by vm.messages.collectAsStateWithLifecycle()
    val sending by vm.busy.collectAsStateWithLifecycle()
    var draft by rememberSaveable { mutableStateOf("") }
    val listState = rememberLazyListState()
    val list = messages
    var reporting by remember { mutableStateOf<ReportTarget?>(null) }
    val someone = stringResource(R.string.someone)
    val c = BoolaaTheme.colors
    val view = LocalView.current
    // Pop-in is for messages that arrive while the screen is open: ids of the first loaded page never animate.
    val firstPage = remember(list != null) { list?.mapTo(HashSet()) { it.id } }
    val popped = remember { HashSet<String>() }
    var sends by remember { mutableIntStateOf(0) }

    LaunchedEffect(list?.lastOrNull()?.id) {
        if (!list.isNullOrEmpty()) listState.animateScrollToItem(list.size - 1)
    }

    Column(Modifier.fillMaxSize().statusBarsPadding().imePadding().testTag("chat-screen")) {
        PushedHeader(stringResource(R.string.chat), bubble.name, Hue.forId(bubble.id), onBack, backTag = "chat-back")
        Box(Modifier.weight(1f)) {
            when {
                list == null -> SkeletonList(Modifier.padding(16.dp))
                list.isEmpty() -> EmptyState(BoolaaIcons.Chat, stringResource(R.string.chat_empty_title), stringResource(R.string.chat_empty_message),
                    Modifier.padding(16.dp))
                else -> LazyColumn(
                    state = listState,
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxSize().testTag("chat-list"),
                ) {
                    itemsIndexed(list, key = { _, m -> m.id }) { index, message ->
                        val previous = list.getOrNull(index - 1)
                        val pop = remember(message.id) { firstPage != null && message.id !in firstPage && popped.add(message.id) }
                        MessageRow(message, isMine = message.senderId == me, showAuthor = previous?.senderId != message.senderId, popIn = pop, onReport = {
                            reporting = ReportTarget(ReportTargetType.CHAT_MESSAGE, message.id, message.senderId, message.sender?.name?.takeIf { it.isNotBlank() } ?: someone)
                        })
                    }
                }
            }
        }
        // Composer: a pill field on the card colour and a round send button, on a translucent bar.
        Row(
            Modifier.fillMaxWidth().background(c.background.copy(alpha = 0.86f)).navigationBarsPadding().padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            val source = remember { MutableInteractionSource() }
            val focused by source.collectIsFocusedAsState()
            val ring by animateColorAsState(if (focused) Hue.grape.fill else c.hairline, Motion.fade())
            val fieldShape = RoundedCornerShape(24.dp)
            TextField(
                value = draft,
                onValueChange = { draft = it },
                placeholder = { Text(stringResource(R.string.message_placeholder), style = Type.body, color = c.textSecondary) },
                maxLines = 5,
                textStyle = Type.body,
                interactionSource = source,
                shape = fieldShape,
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = c.card, unfocusedContainerColor = c.card,
                    focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent, cursorColor = Hue.grape.fill,
                    focusedTextColor = c.textPrimary, unfocusedTextColor = c.textPrimary,
                ),
                modifier = Modifier.weight(1f).border(if (focused) 2.dp else 1.dp, ring, fieldShape).testTag("chat-input"),
            )
            val canSend = !sending && draft.isNotBlank()
            val sendLabel = stringResource(R.string.send)
            val arrow by animateColorAsState(if (canSend) Hue.grape.onFill else c.textSecondary, Motion.fade())
            Box(
                Modifier.padding(start = 10.dp, bottom = 4.dp).size(48.dp)
                    .bounceOn(canSend, from = 0.88f, enabled = canSend)
                    .then(if (canSend) Modifier.glow(Hue.grape.fill.copy(alpha = 0.4f), 10.dp, 5.dp) else Modifier)
                    .clip(CircleShape)
                    .then(if (canSend) Modifier.background(Hue.grape.gradient) else Modifier.background(c.field))
                    .clickableRipple(scale = 0.88f) {
                        if (canSend) {
                            val text = draft
                            draft = ""
                            sends++
                            Haptics.light(view)
                            vm.send(me, text) { failed -> draft = failed }
                        }
                    }
                    .semantics { contentDescription = sendLabel; role = Role.Button }
                    .testTag("chat-send"),
                contentAlignment = Alignment.Center,
            ) { Icon(BoolaaIcons.Send, contentDescription = null, tint = arrow, modifier = Modifier.size(24.dp).bounceOn(sends)) }
        }
    }
    reporting?.let { ReportSheet(it, onDismiss = { reporting = null }) }
    ErrorDialogFor(vm)
}

private val MineShape = RoundedCornerShape(21.dp, 21.dp, 6.dp, 21.dp)
private val TheirsShape = RoundedCornerShape(21.dp, 21.dp, 21.dp, 6.dp)

/**
 * One message. Own bubbles are grape gradient; others sit on the card colour with the sender's name in their own hue.
 * Long press on someone else's message opens the report sheet (also exposed as an accessibility action).
 * With [popIn] the bubble pops out of its tail corner.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MessageRow(message: ChatMessage, isMine: Boolean, showAuthor: Boolean, popIn: Boolean = false, onReport: () -> Unit = {}) {
    val reportLabel = stringResource(R.string.report)
    val locale = LocalConfiguration.current.locales[0]
    val c = BoolaaTheme.colors
    Row(
        Modifier.fillMaxWidth().popFrom(popIn, originX = if (isMine) 1f else 0f, originY = 1f).testTag("message-${message.id}"),
        horizontalArrangement = if (isMine) Arrangement.End else Arrangement.Start,
        verticalAlignment = Alignment.Bottom,
    ) {
        if (!isMine) {
            if (showAuthor) Avatar(message.sender, 30.dp, Modifier.padding(bottom = 16.dp)) else Spacer(Modifier.size(30.dp))
        }
        Column(
            Modifier.padding(horizontal = 8.dp).widthIn(max = 290.dp),
            horizontalAlignment = if (isMine) Alignment.End else Alignment.Start,
            verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            if (showAuthor) {
                Text(
                    if (isMine) stringResource(R.string.you) else displayName(message.sender),
                    style = Type.caption, color = if (isMine) c.textSecondary else Hue.forId(message.senderId).text,
                    modifier = Modifier.padding(horizontal = 6.dp),
                )
            }
            val shape = if (isMine) MineShape else TheirsShape
            Text(
                message.content,
                style = Type.body,
                color = if (isMine) Hue.grape.onFill else c.textPrimary,
                modifier = Modifier
                    .then(if (isMine) Modifier.glow(Hue.grape.fill.copy(alpha = 0.25f), 8.dp, 4.dp, 21.dp) else Modifier.glow(c.cardShadow, 8.dp, 3.dp, 21.dp))
                    .clip(shape)
                    .then(
                        if (isMine) Modifier.background(Hue.grape.gradient) else Modifier
                            .background(c.otherBubble)
                            .border(1.dp, c.hairline, shape)
                            .combinedClickable(onClick = {}, onLongClick = onReport)
                            .semantics { customActions = listOf(CustomAccessibilityAction(reportLabel) { onReport(); true }) },
                    )
                    .padding(horizontal = 14.dp, vertical = 10.dp),
            )
            Text(Formats.time(message.createdAt, locale), style = Type.caption2, color = c.textSecondary, modifier = Modifier.padding(horizontal = 6.dp))
        }
    }
}
