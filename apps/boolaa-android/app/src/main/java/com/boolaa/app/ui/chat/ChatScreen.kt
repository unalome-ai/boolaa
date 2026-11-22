package com.boolaa.app.ui.chat

import android.util.Log
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.background
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.boolaa.app.AppContainer
import com.boolaa.app.R
import com.boolaa.app.core.BoolaaJson
import com.boolaa.app.core.Formats
import com.boolaa.app.model.ChatMessage
import com.boolaa.app.model.UserProfile
import com.boolaa.app.ui.BaseViewModel
import com.boolaa.app.ui.ErrorDialogFor
import com.boolaa.app.ui.LocalAppContainer
import com.boolaa.app.ui.components.Avatar
import com.boolaa.app.ui.components.CircleIconButton
import com.boolaa.app.ui.components.EmptyState
import com.boolaa.app.ui.components.LoadingBox
import com.boolaa.app.ui.components.displayName
import com.boolaa.app.ui.theme.Brand
import com.boolaa.app.ui.theme.BoolaaTheme
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

    LaunchedEffect(list?.lastOrNull()?.id) {
        if (!list.isNullOrEmpty()) listState.animateScrollToItem(list.size - 1)
    }

    Column(Modifier.fillMaxSize().background(BoolaaTheme.colors.background).statusBarsPadding().imePadding().testTag("chat-screen")) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            CircleIconButton(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back), onBack, Modifier.testTag("chat-back"))
            Column(Modifier.padding(start = 12.dp)) {
                Text(stringResource(R.string.chat), style = MaterialTheme.typography.headlineSmall, modifier = Modifier.testTag("screen-title"))
                Text(bubble.name, style = MaterialTheme.typography.bodyMedium, color = Brand.purple)
            }
        }
        Box(Modifier.weight(1f)) {
            when {
                list == null -> LoadingBox()
                list.isEmpty() -> EmptyState(Icons.Default.Forum, stringResource(R.string.chat_empty_title), stringResource(R.string.chat_empty_message))
                else -> LazyColumn(
                    state = listState,
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                    modifier = Modifier.fillMaxSize().testTag("chat-list"),
                ) {
                    itemsIndexed(list, key = { _, m -> m.id }) { index, message ->
                        val previous = list.getOrNull(index - 1)
                        MessageRow(message, isMine = message.senderId == me, showAuthor = previous?.senderId != message.senderId)
                    }
                }
            }
        }
        Row(
            Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            TextField(
                value = draft,
                onValueChange = { draft = it },
                placeholder = { Text(stringResource(R.string.message_placeholder)) },
                maxLines = 5,
                shape = RoundedCornerShape(22.dp),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = BoolaaTheme.colors.card, unfocusedContainerColor = BoolaaTheme.colors.card,
                    focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent, cursorColor = Brand.purple,
                ),
                modifier = Modifier.weight(1f).testTag("chat-input"),
            )
            val canSend = !sending && draft.isNotBlank()
            CircleIconButton(
                Icons.Default.ArrowUpward, stringResource(R.string.send),
                onClick = {
                    if (canSend) {
                        val text = draft
                        draft = ""
                        vm.send(me, text) { failed -> draft = failed }
                    }
                },
                filled = true,
                tint = if (canSend) Brand.purple else Brand.purple.copy(alpha = 0.4f),
                size = 48.dp,
                modifier = Modifier.padding(start = 10.dp).testTag("chat-send"),
            )
        }
    }
    ErrorDialogFor(vm)
}

@Composable
fun MessageRow(message: ChatMessage, isMine: Boolean, showAuthor: Boolean) {
    val locale = LocalConfiguration.current.locales[0]
    Row(
        Modifier.fillMaxWidth().testTag("message-${message.id}"),
        horizontalArrangement = if (isMine) Arrangement.End else Arrangement.Start,
        verticalAlignment = Alignment.Bottom,
    ) {
        if (!isMine) AvatarSlot(message, showAuthor)
        Column(
            Modifier.padding(horizontal = 8.dp).widthIn(max = 280.dp),
            horizontalAlignment = if (isMine) Alignment.End else Alignment.Start,
            verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            if (showAuthor) {
                Text(
                    if (isMine) stringResource(R.string.you) else displayName(message.sender),
                    style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = BoolaaTheme.colors.textSecondary,
                )
            }
            Text(
                message.content,
                color = if (isMine) Color.White else BoolaaTheme.colors.textPrimary,
                modifier = Modifier
                    .clip(RoundedCornerShape(18.dp))
                    .background(if (isMine) Brand.purple else BoolaaTheme.colors.otherBubble)
                    .padding(horizontal = 14.dp, vertical = 10.dp),
            )
            Text(Formats.time(message.createdAt, locale), style = MaterialTheme.typography.labelSmall, color = BoolaaTheme.colors.textSecondary)
        }
        if (isMine) AvatarSlot(message, showAuthor)
    }
}

@Composable
private fun AvatarSlot(message: ChatMessage, show: Boolean) {
    if (show) Avatar(message.sender, 32.dp) else Spacer(Modifier.size(32.dp))
}

