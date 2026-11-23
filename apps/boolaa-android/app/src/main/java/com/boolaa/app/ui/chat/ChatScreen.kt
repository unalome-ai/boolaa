package com.boolaa.app.ui.chat

import android.content.ContentResolver
import android.net.Uri
import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import com.boolaa.app.AppContainer
import com.boolaa.app.R
import com.boolaa.app.core.BoolaaApi
import com.boolaa.app.core.BoolaaJson
import com.boolaa.app.core.Formats
import com.boolaa.app.core.ImageBucket
import com.boolaa.app.core.ImageCompression
import com.boolaa.app.model.ChatMessage
import com.boolaa.app.model.ReportTarget
import com.boolaa.app.model.ReportTargetType
import com.boolaa.app.model.UserProfile
import com.boolaa.app.ui.BaseViewModel
import com.boolaa.app.ui.ErrorDialogFor
import com.boolaa.app.ui.LocalAppContainer
import com.boolaa.app.ui.components.Avatar
import com.boolaa.app.ui.components.BoolaaIcons
import com.boolaa.app.ui.components.ConfirmDialog
import com.boolaa.app.ui.components.EmptyState
import com.boolaa.app.ui.components.Haptics
import com.boolaa.app.ui.components.PushedHeader
import com.boolaa.app.ui.components.SkeletonList
import com.boolaa.app.ui.components.bounceOn
import com.boolaa.app.ui.components.clickableRipple
import com.boolaa.app.ui.components.displayName
import com.boolaa.app.ui.components.glow
import com.boolaa.app.ui.components.popFrom
import com.boolaa.app.ui.safety.ReportSheet
import com.boolaa.app.ui.theme.BoolaaTheme
import com.boolaa.app.ui.theme.Hue
import com.boolaa.app.ui.theme.Motion
import com.boolaa.app.ui.theme.Type
import io.github.jan.supabase.postgrest.query.filter.FilterOperator
import io.github.jan.supabase.realtime.PostgresAction
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.postgresChangeFlow
import io.github.jan.supabase.realtime.realtime
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.util.UUID

/** Pure merge rules for the chat list (chronological, oldest first). Same cases as web and iOS. */
object ChatMerge {
    /** Chronological order; the id breaks ties like the server's (created_at, id) keyset. */
    val order: Comparator<ChatMessage> = compareBy<ChatMessage> { it.createdAt }.thenBy { it.id }

    /**
     * Inserts [incoming] or replaces the message with its id in place (an UPDATE, e.g. a deletion). Realtime rows carry
     * no sender embed: it comes from [authors] or the row already held. A deleted message never comes back (a stale
     * page can't undo a deletion). Returns [messages] itself when nothing differs (the echo of our own write).
     */
    fun merge(messages: List<ChatMessage>, incoming: ChatMessage, authors: Map<String, UserProfile>): List<ChatMessage> {
        val idx = messages.indexOfFirst { it.id == incoming.id }
        val existing = messages.getOrNull(idx)
        val sender = incoming.sender ?: existing?.sender ?: authors[incoming.senderId]
        val message = incoming.copy(sender = sender)
        if (existing != null) {
            if (existing.isDeleted && !message.isDeleted) return messages
            if (existing == message) return messages
            return messages.toMutableList().also { it[idx] = message }
        }
        val out = messages + message
        return if (out.size > 1 && order.compare(out[out.size - 2], message) > 0) out.sortedWith(order) else out
    }

    /** Merges a page (any order, e.g. newest first from `chat_messages_page`) and sorts once. */
    fun mergePage(messages: List<ChatMessage>, page: List<ChatMessage>, authors: Map<String, UserProfile>): List<ChatMessage> {
        if (page.isEmpty()) return messages
        val byId = LinkedHashMap<String, ChatMessage>(messages.size + page.size)
        messages.forEach { byId[it.id] = it }
        page.forEach { incoming ->
            val existing = byId[incoming.id]
            if (existing != null && existing.isDeleted && !incoming.isDeleted) return@forEach
            byId[incoming.id] = incoming.copy(sender = incoming.sender ?: existing?.sender ?: authors[incoming.senderId])
        }
        return byId.values.sortedWith(order)
    }

    /** The local placeholder right after `delete_chat_message` (everyone else gets the UPDATE live). */
    fun deleted(message: ChatMessage, at: Instant): ChatMessage = message.copy(content = "", imagePath = null, deletedAt = at)

    /**
     * Where the "New messages" divider goes: above the first message from someone else newer than [lastReadAt]
     * (the marker captured when the chat opened, before marking read). Null for no divider.
     */
    fun dividerBefore(messages: List<ChatMessage>, lastReadAt: Instant?, me: String): String? {
        if (lastReadAt == null) return null
        return messages.firstOrNull { it.senderId != me && it.createdAt > lastReadAt }?.id
    }

    /** The newest message's id: what `mark_chat_read` gets while the chat is visible. */
    fun newestId(messages: List<ChatMessage>?): String? = messages?.lastOrNull()?.id

    /** Photo paths that still need a signed URL lookup (deleted messages have none). */
    fun imagePaths(messages: List<ChatMessage>?): List<String> = messages.orEmpty().mapNotNull { it.imagePath }
}

class ChatViewModel(private val container: AppContainer, private val bubbleId: String) : BaseViewModel() {
    private val api get() = container.api
    private val _messages = MutableStateFlow<List<ChatMessage>?>(null)
    /** Chronological (oldest first); null until the first page arrives. */
    val messages = _messages.asStateFlow()
    private val _hasMore = MutableStateFlow(false)
    /** False once a page shorter than 50 arrived: the start of the chat is loaded. */
    val hasMore = _hasMore.asStateFlow()
    private val _loadingOlder = MutableStateFlow(false)
    val loadingOlder = _loadingOlder.asStateFlow()
    private val _lastReadAt = MutableStateFlow<Instant?>(null)
    /** This bubble's read marker from before the chat opened (for the "New messages" divider). */
    val lastReadAt = _lastReadAt.asStateFlow()
    val imageUrls = container.chatImages.urls
    private val authors = mutableMapOf<String, UserProfile>()
    private var markedId: String? = null
    val reactions = reactionStore(container.api, bubbleId, com.boolaa.app.model.ReactionTarget.CHAT_MESSAGE, _messages) { it.id }
    /** Messages of this bubble in the outbox ("Sending…" / "Not sent — tap to retry"), in the order written. */
    val pending = container.outbox.items.map { com.boolaa.app.core.OutboxRules.forBubble(it, bubbleId) }
        .stateIn(viewModelScope, kotlinx.coroutines.flow.SharingStarted.Eagerly, emptyList())
    private val cacheKey = com.boolaa.app.core.CacheKeys.chat(bubbleId)
    private val cacheSerializer = kotlinx.serialization.builtins.ListSerializer(ChatMessage.serializer())

    init {
        // The newest page shows at once from the offline cache; live merges are saved again (debounced).
        offlineAware(container, _messages, cacheKey, cacheSerializer) { load() }
        load()
        // (Re)subscribed on open, on every reconnect and on every return to the front.
        viewModelScope.launch { container.connectivity.refresh.collectLatest { keepLive() } }
        viewModelScope.launch {
            container.outbox.delivered.collect { m -> if (m.bubbleId == bubbleId) merge(m) }
        }
        @OptIn(kotlinx.coroutines.FlowPreview::class)
        viewModelScope.launch {
            _messages.drop(1).debounce(1_000).collect { list -> if (list != null) saveNewestPage(list) }
        }
        // Sign photo paths as they appear (one batched call per change; cached per path for the hour).
        viewModelScope.launch {
            _messages.map { ChatMerge.imagePaths(it) }.distinctUntilChanged().collect { container.chatImages.ensure(it) }
        }
        // RLS hides blocked authors; drop their messages now and reload (unblock brings them back).
        reloadOnBlockChange(container.session) {
            val blocked = container.session.state.value.blockedIds
            _messages.update { it?.filterNot { m -> m.senderId in blocked } }
            launchCatching(trackBusy = false) {
                mergeNewestPage()
                reactions.refresh(liveIds())
            }
        }
    }

    private fun merge(message: ChatMessage) {
        message.sender?.let { authors[it.id] = it }
        _messages.update { ChatMerge.merge(it.orEmpty(), message, authors) }
    }

    /** Messages that can carry reactions (deleted ones lost theirs). */
    private fun liveIds() = _messages.value.orEmpty().filterNot { it.isDeleted }.map { it.id }

    fun react(messageId: String, kind: com.boolaa.app.model.ReactionKind) =
        toggleReaction(reactions, messageId, kind, container.session.state.value.userId)

    private suspend fun mergeNewestPage() {
        val page = api.chatPage(bubbleId, null)
        page.forEach { m -> m.sender?.let { authors[it.id] = it } }
        _messages.update { current -> ChatMerge.mergePage(current.orEmpty(), page, authors) }
    }

    private fun saveNewestPage(list: List<ChatMessage>) =
        saveCache(container, cacheKey, cacheSerializer, list.takeLast(com.boolaa.app.core.CacheKeys.CHAT_LIMIT))

    private fun load() = runLoad(container, hasData = { _messages.value != null }) {
        coroutineScope {
            val page = async { api.chatPage(bubbleId, null) }
            val members = async { runCatching { api.members(bubbleId) }.getOrDefault(emptyList()) }
            // The marker from before this visit; captured before anything is marked read.
            val marker = async {
                runCatching { api.chatUnreadCounts().firstOrNull { it.bubbleId == bubbleId }?.lastReadAt }
                    .getOrElse { container.unread.lastReadAt(bubbleId) }
            }
            members.await().forEach { m -> m.user?.let { authors[it.id] = it } }
            val loaded = page.await()
            _lastReadAt.value = marker.await()
            _hasMore.value = loaded.size >= BoolaaApi.CHAT_PAGE_SIZE
            _messages.update { current -> ChatMerge.mergePage(current.orEmpty(), loaded, authors) }
            _messages.value?.let { saveNewestPage(it) }
            reactions.refresh(liveIds())
        }
    }

    /** Loads the page before the oldest message held (scrolled near the top). */
    fun loadOlder() {
        val oldest = _messages.value?.firstOrNull() ?: return
        if (!_hasMore.value || _loadingOlder.value) return
        _loadingOlder.value = true
        viewModelScope.launch {
            try {
                val page = api.chatPage(bubbleId, oldest.id)
                page.forEach { m -> m.sender?.let { authors[it.id] = it } }
                _hasMore.value = page.size >= BoolaaApi.CHAT_PAGE_SIZE
                _messages.update { current -> ChatMerge.mergePage(current.orEmpty(), page, authors) }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Throwable) {
                // Offline or a bad network: quiet; scrolling to the top again (or a reconnect) tries again.
                Log.w("Boolaa", "older chat page failed", e)
            } finally {
                _loadingOlder.value = false
            }
        }
    }

    private val _jumpTarget = MutableStateFlow<JumpTarget?>(null)
    /** A message to scroll to and highlight (a search hit), once it's in [messages]. */
    val jumpTarget = _jumpTarget.asStateFlow()

    /**
     * Opens [messageId] in context: loads `chat_messages_around` (contiguous with the newest page), merges it like a
     * page and asks the list to scroll to it. If it isn't returned, shows "We couldn't find that message".
     */
    fun jumpTo(messageId: String) = launchCatching(trackBusy = false) {
        val rows = api.chatMessagesAround(bubbleId, messageId)
        val window = com.boolaa.app.core.ChatJump.window(rows, messageId)
        if (window == null) {
            showError(R.string.search_message_unavailable)
            return@launchCatching
        }
        rows.forEach { m -> m.sender?.let { authors[it.id] = it } }
        val current = _messages.value.orEmpty()
        _hasMore.value = com.boolaa.app.core.ChatJump.hasMoreAfterMerge(current, _hasMore.value, window)
        _messages.update { held -> ChatMerge.mergePage(held.orEmpty(), rows, authors) }
        reactions.refresh(liveIds())
        _jumpTarget.value = JumpTarget(messageId)
    }

    fun jumpDone(target: JumpTarget) { if (_jumpTarget.value == target) _jumpTarget.value = null }

    /**
     * One channel `chat:<bubble id>`: INSERT and UPDATE filtered by bubble_id, merged by id (records carry
     * "2026-11-22 15:26:52.4+00" timestamps). Deletions arrive as UPDATEs. Reloads the newest page once subscribed.
     */
    private suspend fun keepLive() {
        val client = api.client
        val ch = client.channel("chat:$bubbleId:${UUID.randomUUID()}")
        val inserts = ch.postgresChangeFlow<PostgresAction.Insert>(schema = "public") {
            table = "chat_messages"
            filter("bubble_id", FilterOperator.EQ, bubbleId)
        }
        val updates = ch.postgresChangeFlow<PostgresAction.Update>(schema = "public") {
            table = "chat_messages"
            filter("bubble_id", FilterOperator.EQ, bubbleId)
        }
        // Reactions ride on the same channel: INSERT by bubble, DELETE by id (docs/boolaa-spec.md "Reactions").
        val reactionListeners = reactions.listenOn(ch)
        fun decode(record: kotlinx.serialization.json.JsonObject) =
            runCatching { BoolaaJson.json.decodeFromJsonElement(ChatMessage.serializer(), record) }
                .onFailure { Log.w("Boolaa", "bad realtime chat record", it) }.getOrNull()
        try {
            coroutineScope {
                launch(start = CoroutineStart.UNDISPATCHED) {
                    inserts.collect { action ->
                        val m = decode(action.record) ?: return@collect
                        if (m.senderId !in authors) refreshAuthors()
                        merge(m)
                    }
                }
                launch(start = CoroutineStart.UNDISPATCHED) {
                    updates.collect { action ->
                        val m = decode(action.record) ?: return@collect
                        // Only rows we hold: an UPDATE of an older, unloaded message would open a gap in the pages.
                        val held = _messages.value?.firstOrNull { it.id == m.id } ?: return@collect
                        if (held.imagePath != null && m.imagePath == null) container.chatImages.forget(held.imagePath)
                        if (m.isDeleted) reactions.dropTarget(m.id)
                        merge(m)
                    }
                }
                reactionListeners(this)
                runCatching { ch.subscribe(blockUntilSubscribed = true) }
                    .onSuccess { if (_messages.value != null) runCatching { mergeNewestPage() } }
                    .onFailure { Log.w("Boolaa", "realtime subscribe chat failed", it) }
                awaitCancellation()
            }
        } finally {
            withContext(NonCancellable) { runCatching { client.realtime.removeChannel(ch) } }
        }
    }

    /** A sender we don't know yet (joined after the chat opened): fetch the members once more. */
    private suspend fun refreshAuthors() {
        runCatching { api.members(bubbleId) }.getOrNull()?.forEach { m -> m.user?.let { authors[it.id] = it } }
    }

    /**
     * Sends [text] and/or a photo. The photo goes through the image pipeline (1600 px, JPEG, no metadata), is uploaded
     * to `chat.images/<uid>/<uuid>.jpg`, then the message is inserted with its path; if the insert fails the object is
     * removed again. [onFailure] gets the draft back.
     */
    fun send(senderId: String, text: String, photo: Uri?, resolver: ContentResolver, onFailure: (String, Uri?) -> Unit) {
        val content = text.trim().take(4000)
        if (content.isEmpty() && photo == null) return
        // The message goes to the outbox (docs/boolaa-spec.md "Offline and poor network"): shown as "Sending…", sent
        // now or when the connection is back, with a client id so a retry never doubles it. Only a photo that can't
        // be processed gives the draft back.
        launchCatching(trackBusy = true) {
            val jpeg = try {
                photo?.let { ImageCompression.jpegFromUri(resolver, it, ImageBucket.CHAT) }
            } catch (e: Throwable) {
                onFailure(text, photo)
                throw e
            }
            container.outbox.send(com.boolaa.app.core.PendingMessage.create(bubbleId, senderId, content, jpeg))
        }
    }

    /** "Not sent — tap to retry". */
    fun retry(clientId: String) = container.outbox.retry(clientId)

    /** "Don't send": drops it, and its photo if an attempt uploaded one. */
    fun discard(clientId: String, me: String) {
        val removed = container.outbox.discard(clientId) ?: return
        removed.photoPath?.let { path -> container.appScope.launch { api.removeChatImage(path, me) } }
    }

    /** Soft-deletes our own message, shows the placeholder, then removes its photo from storage (best effort). */
    fun delete(message: ChatMessage, me: String) = launchCatching(trackBusy = false) {
        val path = api.deleteChatMessage(message.id)
        _messages.update { list -> list?.map { if (it.id == message.id && !it.isDeleted) ChatMerge.deleted(it, Instant.now()) else it } }
        reactions.dropTarget(message.id)
        message.imagePath?.let { container.chatImages.forget(it) }
        api.removeChatImage(path, me)
    }

    /** Moves the read marker to the newest message shown (only called while the chat is visible), then the badges. */
    fun markRead(messageId: String) {
        if (messageId == markedId) return
        markedId = messageId
        viewModelScope.launch {
            runCatching { api.markChatRead(bubbleId, messageId) }
                .onSuccess { container.unread.refresh() }
                .onFailure { if (markedId == messageId) markedId = null; Log.w("Boolaa", "mark_chat_read failed", it) }
        }
    }
}

/** One jump request; identity equality so jumping to the same message twice runs twice. */
class JumpTarget(val id: String)

/** What the chat list shows, newest first (the list is laid out bottom-up). */
private sealed class ChatRow(val key: String) {
    class Message(val message: ChatMessage, val showAuthor: Boolean) : ChatRow(message.id)
    class Pending(val message: com.boolaa.app.core.PendingMessage) : ChatRow("pending-" + message.clientId)
    data object Divider : ChatRow("new-messages")
    data object LoadingOlder : ChatRow("loading-older")
    data object Start : ChatRow("chat-start")
}

/**
 * Bubble chat (spec "Chat"): pages of 50 loaded as the list nears the top, live inserts and updates, own-message
 * deletion, photos from the private bucket, read marker and the "New messages" divider.
 */
@Composable
fun ChatScreen(
    onBack: () -> Unit, pendingDraft: String? = null, onDraftTaken: () -> Unit = {},
    pendingJump: String? = null, onJumpTaken: () -> Unit = {},
) {
    val container = LocalAppContainer.current
    val state by container.session.state.collectAsStateWithLifecycle()
    val bubble = state.currentBubble ?: return
    val me = state.userId ?: return
    val vm: ChatViewModel = viewModel(key = "chat-${bubble.id}") { ChatViewModel(container, bubble.id) }
    val messages by vm.messages.collectAsStateWithLifecycle()
    val hasMore by vm.hasMore.collectAsStateWithLifecycle()
    val lastReadAt by vm.lastReadAt.collectAsStateWithLifecycle()
    val imageUrls by vm.imageUrls.collectAsStateWithLifecycle()
    val sending by vm.busy.collectAsStateWithLifecycle()
    val reactionRows by vm.reactions.rows.collectAsStateWithLifecycle()
    val reactionsByMessage = remember(reactionRows, me) { com.boolaa.app.core.ReactionMerge.summaries(reactionRows, me) }
    val issue by vm.loadIssue.collectAsStateWithLifecycle()
    val pendingAll by vm.pending.collectAsStateWithLifecycle()
    var draft by rememberSaveable { mutableStateOf("") }
    // A prefilled text ("Ask in chat"): put in the composer, never sent automatically; kept after what was typed.
    LaunchedEffect(pendingDraft) {
        if (pendingDraft != null) {
            draft = if (draft.isBlank()) pendingDraft else "${draft.trimEnd()}\n$pendingDraft"
            onDraftTaken()
        }
    }
    var photo by rememberSaveable { mutableStateOf<Uri?>(null) }
    val listState = rememberLazyListState()
    val list = messages
    var reporting by remember { mutableStateOf<ReportTarget?>(null) }
    var deleting by remember { mutableStateOf<ChatMessage?>(null) }
    val someone = stringResource(R.string.someone)
    val c = BoolaaTheme.colors
    val view = LocalView.current
    val resolver = LocalContext.current.contentResolver
    // Pop-in is for messages that arrive while the screen is open: the first page and older pages never animate.
    val openedAt = remember(list != null) { if (list == null) null else list.lastOrNull()?.createdAt ?: Instant.MIN }
    val popped = remember { HashSet<String>() }
    var sends by remember { mutableIntStateOf(0) }
    val newestId = ChatMerge.newestId(list)

    // Mark read with the newest message, only while the chat is actually visible (resumed).
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val lifecycleState by lifecycle.currentStateFlow.collectAsStateWithLifecycle()
    val visible = lifecycleState.isAtLeast(Lifecycle.State.RESUMED)
    LaunchedEffect(visible, newestId) { if (visible && newestId != null) vm.markRead(newestId) }
    // Push: no banner for this chat while it's on screen, and its delivered notification goes away.
    DisposableEffect(visible, bubble.id) {
        if (visible) container.push.setVisibleChat(bubble.id)
        onDispose { if (container.push.visibleChatBubble == bubble.id) container.push.setVisibleChat(null) }
    }

    // A message from someone else arriving while the chat is open is announced politely ("New message from Bob").
    val newest = list?.lastOrNull()
    val newestSender = newest?.sender?.name?.takeIf { it.isNotBlank() } ?: someone
    val announcement = stringResource(R.string.a11y_new_message_from, newestSender)
    LaunchedEffect(newestId) {
        if (newest != null && openedAt != null && newest.senderId != me && newest.createdAt > openedAt && !newest.isDeleted) {
            com.boolaa.app.ui.components.announcePolitely(view, announcement)
        }
    }
    // A new newest message scrolls into view when the list was at (or next to) the bottom, or when it is ours.
    LaunchedEffect(newestId) {
        if (newestId != null && (listState.firstVisibleItemIndex <= 2 || list?.lastOrNull()?.senderId == me)) listState.animateScrollToItem(0)
    }

    // Near the top (the end of the reversed list): load the previous page. Position stays on the item shown.
    LaunchedEffect(listState, vm) {
        snapshotFlow {
            val info = listState.layoutInfo
            val last = info.visibleItemsInfo.lastOrNull()?.index ?: -1
            (info.totalItemsCount > 0 && last >= info.totalItemsCount - 6) to info.totalItemsCount
        }.distinctUntilChanged().collect { (near, _) -> if (near) vm.loadOlder() }
    }

    // A search hit: load the chat around it (works whether the chat just opened or was already open).
    LaunchedEffect(pendingJump, vm) {
        if (pendingJump != null) {
            onJumpTaken()
            vm.jumpTo(pendingJump)
        }
    }
    val jump by vm.jumpTarget.collectAsStateWithLifecycle()
    var highlightedId by remember { mutableStateOf<String?>(null) }

    val dividerId = remember(list, lastReadAt) { list?.let { ChatMerge.dividerBefore(it, lastReadAt, me) } }
    // Outbox messages the server list doesn't hold yet, newest at the bottom (the list is reversed).
    val pending = remember(pendingAll, list) { com.boolaa.app.core.OutboxRules.visible(pendingAll, list.orEmpty().mapTo(HashSet()) { it.id }) }
    LaunchedEffect(pending.size) { if (pending.isNotEmpty()) listState.animateScrollToItem(0) }
    val rows = remember(list, dividerId, hasMore, pending) {
        val l = list.orEmpty()
        buildList {
            pending.asReversed().forEach { add(ChatRow.Pending(it)) }
            for (i in l.indices.reversed()) {
                val m = l[i]
                val previous = l.getOrNull(i - 1)
                add(ChatRow.Message(m, showAuthor = previous?.senderId != m.senderId || m.id == dividerId))
                if (m.id == dividerId) add(ChatRow.Divider)
            }
            if (l.isNotEmpty()) add(if (hasMore) ChatRow.LoadingOlder else ChatRow.Start)
        }
    }
    // The jumped-to message: once it's in the list, scroll it to about the middle and ring it for 4 s.
    val currentRows by rememberUpdatedState(rows)
    LaunchedEffect(jump) {
        val target = jump ?: return@LaunchedEffect
        snapshotFlow { currentRows.indexOfFirst { it.key == target.id } }.first { it >= 0 }
        delay(150) // first layout of the merged list
        val index = currentRows.indexOfFirst { it.key == target.id }
        if (index >= 0) {
            listState.scrollToItem(index)
            val size = listState.layoutInfo.visibleItemsInfo.firstOrNull { it.key == target.id }?.size ?: 0
            val viewport = listState.layoutInfo.viewportSize.height
            // Negative offset moves the item away from the bottom edge (reverse layout) towards the centre.
            listState.scrollToItem(index, -((viewport - size) / 2).coerceAtLeast(0))
        }
        highlightedId = target.id
        delay(4_000)
        highlightedId = null
        vm.jumpDone(target)
    }

    Column(Modifier.fillMaxSize().statusBarsPadding().imePadding().testTag("chat-screen")) {
        PushedHeader(stringResource(R.string.chat), bubble.name, Hue.forId(bubble.id), onBack, backTag = "chat-back",
            bubbleId = bubble.id, bubbleLogo = bubble.logo)
        Box(Modifier.weight(1f)) {
            when {
                list == null && pending.isEmpty() -> com.boolaa.app.ui.components.LoadingOrFailed(issue, vm::retryNow, Modifier.padding(16.dp))
                list.orEmpty().isEmpty() && pending.isEmpty() -> EmptyState(BoolaaIcons.Chat, stringResource(R.string.chat_empty_title), stringResource(R.string.chat_empty_message),
                    Modifier.padding(16.dp))
                else -> LazyColumn(
                    state = listState,
                    reverseLayout = true,
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.Bottom),
                    modifier = Modifier.fillMaxSize().testTag("chat-list"),
                ) {
                    items(rows, key = { it.key }, contentType = { it::class }) { row ->
                        when (row) {
                            is ChatRow.Message -> {
                                val message = row.message
                                val mine = message.senderId == me
                                val pop = remember(message.id) { openedAt != null && message.createdAt > openedAt && popped.add(message.id) }
                                MessageRow(
                                    message, isMine = mine, showAuthor = row.showAuthor, popIn = pop,
                                    highlighted = message.id == highlightedId,
                                    imageUrl = message.imagePath?.let { imageUrls[it] },
                                    onReport = if (!mine && !message.isDeleted) ({
                                        reporting = ReportTarget(ReportTargetType.CHAT_MESSAGE, message.id, message.senderId,
                                            message.sender?.name?.takeIf { it.isNotBlank() } ?: someone)
                                    }) else null,
                                    onDelete = if (mine && !message.isDeleted) ({ deleting = message }) else null,
                                    reactions = reactionsByMessage[message.id].orEmpty(),
                                    onReact = if (!message.isDeleted) ({ kind -> vm.react(message.id, kind) }) else null,
                                )
                            }
                            is ChatRow.Pending -> PendingMessageRow(row.message, onRetry = { vm.retry(row.message.clientId) },
                                onDiscard = { vm.discard(row.message.clientId, me) })
                            ChatRow.Divider -> NewMessagesDivider()
                            ChatRow.LoadingOlder -> ListNote(stringResource(R.string.chat_loading_older), "chat-loading-older")
                            ChatRow.Start -> ListNote(stringResource(R.string.chat_start), "chat-start")
                        }
                    }
                }
            }
        }
        // Picked photo preview with a remove button, above the composer.
        photo?.let { picked ->
            val removeLabel = stringResource(R.string.chat_remove_photo)
            Box(Modifier.padding(start = 16.dp, top = 6.dp).size(84.dp).testTag("chat-photo-preview")) {
                AsyncImage(
                    model = picked, contentDescription = stringResource(R.string.chat_photo), contentScale = ContentScale.Crop,
                    modifier = Modifier.matchParentSize().clip(RoundedCornerShape(14.dp)).background(c.field),
                )
                // 48dp touch target in the corner; the visible dot stays 28dp.
                Box(
                    Modifier.align(Alignment.TopEnd).size(48.dp).clip(CircleShape)
                        .clickableRipple(role = Role.Button) { photo = null }
                        .semantics { contentDescription = removeLabel }
                        .testTag("chat-photo-remove"),
                    contentAlignment = Alignment.Center,
                ) {
                    Box(Modifier.size(28.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.55f)), contentAlignment = Alignment.Center) {
                        Icon(BoolaaIcons.Close, contentDescription = null, tint = Color.White, modifier = Modifier.size(18.dp))
                    }
                }
            }
        }
        // Composer: photo button, a pill field on the card colour and a round send button, on a translucent bar.
        Row(
            Modifier.fillMaxWidth().background(c.background.copy(alpha = 0.86f)).navigationBarsPadding().padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> if (uri != null) photo = uri }
            val addPhotoLabel = stringResource(R.string.chat_add_photo)
            Box(
                Modifier.padding(end = 8.dp, bottom = 4.dp).size(48.dp).clip(CircleShape).background(c.field)
                    .clickableRipple(scale = 0.88f, enabled = !sending) {
                        picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                    }
                    .semantics { contentDescription = addPhotoLabel; role = Role.Button }
                    .testTag("chat-add-photo"),
                contentAlignment = Alignment.Center,
            ) { Icon(BoolaaIcons.Camera, contentDescription = null, tint = Hue.grape.text, modifier = Modifier.size(24.dp)) }
            val source = remember { MutableInteractionSource() }
            val focused by source.collectIsFocusedAsState()
            val ring by animateColorAsState(if (focused) c.focusRing else c.fieldBorder, Motion.fade())
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
            val canSend = !sending && (draft.isNotBlank() || photo != null)
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
                            val picked = photo
                            draft = ""
                            photo = null
                            sends++
                            Haptics.light(view)
                            vm.send(me, text, picked, resolver) { failedText, failedPhoto -> draft = failedText; photo = failedPhoto }
                        }
                    }
                    .semantics { contentDescription = sendLabel; role = Role.Button }
                    .testTag("chat-send"),
                contentAlignment = Alignment.Center,
            ) { Icon(BoolaaIcons.Send, contentDescription = null, tint = arrow, modifier = Modifier.size(24.dp).bounceOn(sends)) }
        }
    }
    reporting?.let { ReportSheet(it, onDismiss = { reporting = null }) }
    deleting?.let { message ->
        ConfirmDialog(
            title = stringResource(R.string.chat_delete_confirm_title),
            message = stringResource(R.string.chat_delete_confirm_body),
            confirm = stringResource(R.string.chat_delete_confirm),
            onConfirm = { vm.delete(message, me) },
            onDismiss = { deleting = null },
        )
    }
    ErrorDialogFor(vm)
}

/**
 * A message in the outbox: our own bubble, dimmed, with "Sending…" or "Not sent — tap to retry" under it. Tapping a
 * failed one retries; long press (and an accessibility action) offers "Don't send".
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun PendingMessageRow(message: com.boolaa.app.core.PendingMessage, onRetry: () -> Unit, onDiscard: () -> Unit) {
    val c = BoolaaTheme.colors
    val failed = message.state == com.boolaa.app.core.OutboxState.FAILED
    val status = stringResource(if (failed) R.string.offline_not_sent_tap_to_retry else R.string.offline_sending)
    val retryLabel = stringResource(R.string.offline_retry)
    val discardLabel = stringResource(R.string.offline_discard)
    // TalkBack reads the message itself, then its state ("Sending…" / "Not sent — tap to retry"), announced politely on change.
    val spoken = listOfNotNull(
        if (message.hasPhoto) stringResource(R.string.chat_photo) else null,
        message.content.takeIf { it.isNotEmpty() },
    ).joinToString(", ")
    var menu by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().testTag("pending-${message.clientId}"), horizontalArrangement = Arrangement.End) {
        Column(Modifier.padding(horizontal = 8.dp).widthIn(max = 290.dp), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Column(
                Modifier.graphicsLayer { alpha = 0.6f }.clip(MineShape).background(Hue.grape.gradient)
                    .combinedClickable(onClick = { if (failed) onRetry() }, onLongClick = { menu = true })
                    .semantics {
                        contentDescription = spoken.ifEmpty { status }
                        stateDescription = status
                        liveRegion = LiveRegionMode.Polite
                        if (failed) role = Role.Button
                        customActions = listOfNotNull(
                            if (failed) CustomAccessibilityAction(retryLabel) { onRetry(); true } else null,
                            CustomAccessibilityAction(discardLabel) { onDiscard(); true },
                        )
                    },
            ) {
                if (message.hasPhoto) Text(stringResource(R.string.chat_photo), style = Type.body.copy(fontStyle = FontStyle.Italic),
                    color = Hue.grape.onFill, modifier = Modifier.padding(start = 14.dp, end = 14.dp, top = 10.dp))
                if (message.content.isNotEmpty()) Text(message.content, style = Type.body, color = Hue.grape.onFill,
                    modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp))
                else if (message.hasPhoto) Spacer(Modifier.height(10.dp))
                androidx.compose.material3.DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    if (failed) androidx.compose.material3.DropdownMenuItem(text = { Text(retryLabel, style = Type.body) },
                        onClick = { menu = false; onRetry() })
                    androidx.compose.material3.DropdownMenuItem(text = { Text(discardLabel, style = Type.body, color = c.dangerText) },
                        onClick = { menu = false; onDiscard() }, modifier = Modifier.testTag("pending-discard"))
                }
            }
            Text(status, style = Type.caption2, color = if (failed) c.dangerText else c.textSecondary,
                modifier = Modifier.then(if (failed) Modifier.minimumInteractiveComponentSize().clickableRipple(role = Role.Button, onClick = onRetry) else Modifier)
                    .padding(horizontal = 6.dp, vertical = 2.dp).testTag(if (failed) "pending-failed" else "pending-sending"))
        }
    }
}

/** "New messages": a hairline with a label in the middle, above the first unread message. */
@Composable
private fun NewMessagesDivider() {
    val color = Hue.coral.text
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp).testTag("chat-new-messages"), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f).height(1.dp).background(color.copy(alpha = 0.5f)))
        Text(stringResource(R.string.chat_new_messages), style = Type.caption, color = color, modifier = Modifier.padding(horizontal = 10.dp))
        Box(Modifier.weight(1f).height(1.dp).background(color.copy(alpha = 0.5f)))
    }
}

/** A quiet centred note at the top of the list ("Loading older messages…", "That's the start of the chat"). */
@Composable
private fun ListNote(text: String, tag: String) {
    Text(
        text, style = Type.caption2, color = BoolaaTheme.colors.textSecondary, textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp).testTag(tag),
    )
}

private val MineShape = RoundedCornerShape(21.dp, 21.dp, 6.dp, 21.dp)
private val TheirsShape = RoundedCornerShape(21.dp, 21.dp, 21.dp, 6.dp)

/**
 * One message. Own bubbles are grape gradient; others sit on the card colour with the sender's name in their own hue.
 * A photo ([imageUrl], a signed URL) sits above its optional caption. Long press on someone else's message opens the
 * report sheet, on your own the delete confirmation (both also accessibility actions). A deleted message is a quiet
 * placeholder with no actions. With [popIn] the bubble pops out of its tail corner.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MessageRow(
    message: ChatMessage, isMine: Boolean, showAuthor: Boolean, popIn: Boolean = false, highlighted: Boolean = false, imageUrl: String? = null,
    onReport: (() -> Unit)? = null, onDelete: (() -> Unit)? = null,
    reactions: List<com.boolaa.app.core.ReactionSummary> = emptyList(), onReact: ((com.boolaa.app.model.ReactionKind) -> Unit)? = null,
) {
    val reportLabel = stringResource(R.string.report)
    val reactLabel = stringResource(R.string.reaction_react)
    val picker = com.boolaa.app.ui.components.rememberReactionPicker()
    val menu = com.boolaa.app.ui.components.rememberReactionPicker()
    val deleteLabel = stringResource(R.string.chat_delete_message)
    val locale = LocalConfiguration.current.locales[0]
    val c = BoolaaTheme.colors
    val action = onDelete ?: onReport
    val actionLabel = if (onDelete != null) deleteLabel else reportLabel
    // TalkBack reads the whole message as one stop: sender, photo, text (or "deleted"), time and the reactions; react,
    // delete/report and every link in the text are its actions.
    val sender = if (isMine) stringResource(R.string.you) else displayName(message.sender)
    val photoLabel = stringResource(R.string.a11y_photo_from, sender)
    val deletedLabel = stringResource(R.string.chat_deleted)
    val time = Formats.time(message.createdAt, locale)
    val youReacted = stringResource(R.string.reaction_by_you)
    val reactionLabels = reactions.map { r ->
        pluralStringResource(R.plurals.reaction_chip, r.count, com.boolaa.app.ui.components.reactionName(r.kind), r.count) +
            if (r.mine) ", $youReacted" else ""
    }
    val description = buildList {
        add(sender)
        if (message.isDeleted) add(deletedLabel)
        else {
            if (message.imagePath != null) add(photoLabel)
            if (message.content.isNotEmpty()) add(message.content)
        }
        add(time)
        if (!message.isDeleted) addAll(reactionLabels)
    }.joinToString(", ")
    val uriHandler = androidx.compose.ui.platform.LocalUriHandler.current
    val links = remember(message.content) { com.boolaa.app.core.Linkify.split(message.content).mapNotNull { it.url } }
    Row(
        Modifier.fillMaxWidth().popFrom(popIn, originX = if (isMine) 1f else 0f, originY = 1f).testTag("message-${message.id}")
            .clearAndSetSemantics {
                contentDescription = description
                if (!message.isDeleted) customActions = listOfNotNull(
                    onReact?.let { CustomAccessibilityAction(reactLabel) { menu.value = true; true } },
                    action?.let { CustomAccessibilityAction(actionLabel) { it(); true } },
                ) + links.map { url -> CustomAccessibilityAction(url) { runCatching { uriHandler.openUri(url) }.isSuccess } }
            },
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
            // A search hit opened in context: the same brand ring as push highlights, for 4 s.
            val ring = if (highlighted) Modifier.border(3.dp, com.boolaa.app.ui.theme.Brand.hue.fill, shape).testTag("message-highlighted") else Modifier
            if (message.isDeleted) {
                Text(
                    stringResource(R.string.chat_deleted),
                    style = Type.body.copy(fontStyle = FontStyle.Italic),
                    color = c.textSecondary,
                    modifier = Modifier.clip(shape).border(1.dp, c.hairline, shape).then(ring).padding(horizontal = 14.dp, vertical = 10.dp)
                        .testTag("message-deleted-${message.id}"),
                )
            } else {
                Column(
                    Modifier
                        .then(if (isMine) Modifier.glow(Hue.grape.fill.copy(alpha = 0.25f), 8.dp, 4.dp, 21.dp) else Modifier.glow(c.cardShadow, 8.dp, 3.dp, 21.dp))
                        .clip(shape)
                        .then(if (isMine) Modifier.background(Hue.grape.gradient) else Modifier.background(c.otherBubble).border(1.dp, c.hairline, shape))
                        .then(ring)
                        .then(
                            // Long press: the reactions row plus Delete (own) or Report (others) below it.
                            if (action != null || onReact != null) Modifier
                                .combinedClickable(onClick = {}, onLongClick = { if (onReact != null) menu.value = true else action?.invoke() })
                            else Modifier,
                        ),
                ) {
                    if (onReact != null) {
                        com.boolaa.app.ui.components.ReactionPickerMenu(menu.value, onDismiss = { menu.value = false },
                            onPick = { menu.value = false; onReact(it) }, tag = "reactions-${message.id}") {
                            if (action != null) androidx.compose.material3.DropdownMenuItem(
                                text = { Text(actionLabel, style = Type.body, color = if (onDelete != null) c.dangerText else c.textPrimary) },
                                onClick = { menu.value = false; action() },
                                modifier = Modifier.testTag(if (onDelete != null) "menu-delete-message" else "menu-report"),
                            )
                        }
                    }
                    if (message.imagePath != null) {
                        val context = LocalContext.current
                        // Signed URLs change every hour; cache the pixels by object path instead.
                        val request = remember(imageUrl, message.imagePath) {
                            imageUrl?.let {
                                ImageRequest.Builder(context).data(it).memoryCacheKey(message.imagePath).diskCacheKey(message.imagePath).build()
                            }
                        }
                        AsyncImage(
                            model = request, contentDescription = photoLabel, contentScale = ContentScale.Crop,
                            modifier = Modifier.size(240.dp).background(c.field).testTag("message-photo-${message.id}"),
                        )
                    }
                    if (message.content.isNotEmpty()) {
                        // Links are tappable and open in the browser (no previews in chat).
                        val linkColor = if (isMine) Hue.grape.onFill else Hue.grape.text
                        val text = remember(message.content, linkColor) { linkified(message.content, linkColor) }
                        Text(
                            text,
                            style = Type.body,
                            color = if (isMine) Hue.grape.onFill else c.textPrimary,
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                        )
                    }
                }
            }
            if (onReact != null && reactions.isNotEmpty()) {
                com.boolaa.app.ui.components.ReactionBar(reactions, onReact, hue = Hue.grape, picker = picker, tag = "reactions-${message.id}")
            }
            Text(time, style = Type.caption2, color = c.textSecondary, modifier = Modifier.padding(horizontal = 6.dp))
        }
    }
}

/** Message text with every http(s) / www. link as a [LinkAnnotation.Url] (opened by the system browser), underlined. */
internal fun linkified(content: String, linkColor: Color): androidx.compose.ui.text.AnnotatedString =
    androidx.compose.ui.text.buildAnnotatedString {
        val style = androidx.compose.ui.text.TextLinkStyles(
            androidx.compose.ui.text.SpanStyle(color = linkColor, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold,
                textDecoration = androidx.compose.ui.text.style.TextDecoration.Underline),
        )
        for (part in com.boolaa.app.core.Linkify.split(content)) {
            val url = part.url
            if (url == null) append(part.text)
            else withLink(androidx.compose.ui.text.LinkAnnotation.Url(url, style)) { append(part.text) }
        }
    }
