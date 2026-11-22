package com.boolaa.app.ui.chat

import android.content.ContentResolver
import android.net.Uri
import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import com.boolaa.app.core.BoolaaApi
import com.boolaa.app.core.ImageBucket
import com.boolaa.app.core.ImageCompression
import com.boolaa.app.ui.components.ConfirmDialog
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import java.time.Instant
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
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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

    init {
        load()
        viewModelScope.launch { keepLive() }
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

    private fun load() = launchCatching(trackBusy = false) {
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
            reactions.refresh(liveIds())
        }
    }.also { it.invokeOnCompletion { if (_messages.value == null) _messages.value = emptyList() } }

    /** Loads the page before the oldest message held (scrolled near the top). */
    fun loadOlder() {
        val oldest = _messages.value?.firstOrNull() ?: return
        if (!_hasMore.value || _loadingOlder.value) return
        _loadingOlder.value = true
        launchCatching(trackBusy = false) {
            try {
                val page = api.chatPage(bubbleId, oldest.id)
                page.forEach { m -> m.sender?.let { authors[it.id] = it } }
                _hasMore.value = page.size >= BoolaaApi.CHAT_PAGE_SIZE
                _messages.update { current -> ChatMerge.mergePage(current.orEmpty(), page, authors) }
            } finally {
                _loadingOlder.value = false
            }
        }
    }

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
        launchCatching(trackBusy = true) {
            try {
                val path = photo?.let { api.uploadChatImage(ImageCompression.jpegFromUri(resolver, it, ImageBucket.CHAT), senderId) }
                val sent = try {
                    api.sendMessage(bubbleId, senderId, content, path)
                } catch (e: Throwable) {
                    withContext(NonCancellable) { api.removeChatImage(path, senderId) }
                    throw e
                }
                merge(sent)
            } catch (e: Throwable) {
                onFailure(text, photo)
                throw e
            }
        }
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

/** What the chat list shows, newest first (the list is laid out bottom-up). */
private sealed class ChatRow(val key: String) {
    class Message(val message: ChatMessage, val showAuthor: Boolean) : ChatRow(message.id)
    data object Divider : ChatRow("new-messages")
    data object LoadingOlder : ChatRow("loading-older")
    data object Start : ChatRow("chat-start")
}

/**
 * Bubble chat (spec "Chat"): pages of 50 loaded as the list nears the top, live inserts and updates, own-message
 * deletion, photos from the private bucket, read marker and the "New messages" divider.
 */
@Composable
fun ChatScreen(onBack: () -> Unit, pendingDraft: String? = null, onDraftTaken: () -> Unit = {}) {
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

    val dividerId = remember(list, lastReadAt) { list?.let { ChatMerge.dividerBefore(it, lastReadAt, me) } }
    val rows = remember(list, dividerId, hasMore) {
        val l = list.orEmpty()
        buildList {
            for (i in l.indices.reversed()) {
                val m = l[i]
                val previous = l.getOrNull(i - 1)
                add(ChatRow.Message(m, showAuthor = previous?.senderId != m.senderId || m.id == dividerId))
                if (m.id == dividerId) add(ChatRow.Divider)
            }
            if (l.isNotEmpty()) add(if (hasMore) ChatRow.LoadingOlder else ChatRow.Start)
        }
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
                Box(
                    Modifier.align(Alignment.TopEnd).padding(4.dp).size(28.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.55f))
                        .clickableRipple(role = Role.Button) { photo = null }
                        .semantics { contentDescription = removeLabel }
                        .testTag("chat-photo-remove"),
                    contentAlignment = Alignment.Center,
                ) { Icon(BoolaaIcons.Close, contentDescription = null, tint = Color.White, modifier = Modifier.size(18.dp)) }
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
    message: ChatMessage, isMine: Boolean, showAuthor: Boolean, popIn: Boolean = false, imageUrl: String? = null,
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
            val action = onDelete ?: onReport
            val actionLabel = if (onDelete != null) deleteLabel else reportLabel
            if (message.isDeleted) {
                Text(
                    stringResource(R.string.chat_deleted),
                    style = Type.body.copy(fontStyle = FontStyle.Italic),
                    color = c.textSecondary,
                    modifier = Modifier.clip(shape).border(1.dp, c.hairline, shape).padding(horizontal = 14.dp, vertical = 10.dp)
                        .testTag("message-deleted-${message.id}"),
                )
            } else {
                Column(
                    Modifier
                        .then(if (isMine) Modifier.glow(Hue.grape.fill.copy(alpha = 0.25f), 8.dp, 4.dp, 21.dp) else Modifier.glow(c.cardShadow, 8.dp, 3.dp, 21.dp))
                        .clip(shape)
                        .then(if (isMine) Modifier.background(Hue.grape.gradient) else Modifier.background(c.otherBubble).border(1.dp, c.hairline, shape))
                        .then(
                            // Long press: the reactions row plus Delete (own) or Report (others) below it.
                            if (action != null || onReact != null) Modifier
                                .combinedClickable(onClick = {}, onLongClick = { if (onReact != null) menu.value = true else action?.invoke() })
                                .semantics {
                                    customActions = listOfNotNull(
                                        onReact?.let { CustomAccessibilityAction(reactLabel) { menu.value = true; true } },
                                        action?.let { CustomAccessibilityAction(actionLabel) { it(); true } },
                                    )
                                }
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
                            model = request, contentDescription = stringResource(R.string.chat_photo), contentScale = ContentScale.Crop,
                            modifier = Modifier.size(240.dp).background(c.field).testTag("message-photo-${message.id}"),
                        )
                    }
                    if (message.content.isNotEmpty()) {
                        Text(
                            message.content,
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
            Text(Formats.time(message.createdAt, locale), style = Type.caption2, color = c.textSecondary, modifier = Modifier.padding(horizontal = 6.dp))
        }
    }
}
