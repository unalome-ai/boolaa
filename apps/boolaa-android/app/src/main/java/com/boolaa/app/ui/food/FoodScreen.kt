package com.boolaa.app.ui.food

import android.content.ContentResolver
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Restaurant
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.boolaa.app.AppContainer
import com.boolaa.app.R
import com.boolaa.app.core.Formats
import com.boolaa.app.core.FoodInput
import com.boolaa.app.core.ImageBucket
import com.boolaa.app.model.FoodPost
import com.boolaa.app.ui.BaseViewModel
import com.boolaa.app.ui.ErrorDialogFor
import com.boolaa.app.ui.LocalAppContainer
import com.boolaa.app.ui.components.AddRow
import com.boolaa.app.ui.components.Avatar
import com.boolaa.app.ui.components.BoolaaTextField
import com.boolaa.app.ui.components.ConfirmDialog
import com.boolaa.app.ui.components.EmptyState
import com.boolaa.app.ui.components.LoadingBox
import com.boolaa.app.ui.components.OwnerMenu
import com.boolaa.app.ui.components.PhotoField
import com.boolaa.app.ui.components.PrimaryButton
import com.boolaa.app.ui.components.RemoteImage
import com.boolaa.app.ui.components.SectionHeader
import com.boolaa.app.ui.components.boolaaCard
import com.boolaa.app.ui.components.displayName
import com.boolaa.app.ui.components.uploadPicked
import com.boolaa.app.ui.theme.Brand
import com.boolaa.app.ui.theme.BoolaaTheme
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

class FoodViewModel(private val container: AppContainer, private val bubbleId: String) : BaseViewModel() {
    private val _posts = MutableStateFlow<List<FoodPost>?>(null)
    val posts = _posts.asStateFlow()

    init { load() }

    fun load(refresh: Boolean = false) = launchCatching(trackBusy = refresh) {
        _posts.value = container.api.foodPosts(bubbleId)
    }.also { it.invokeOnCompletion { if (_posts.value == null) _posts.value = emptyList() } }

    fun save(existing: FoodPost?, picked: Uri?, description: String, resolver: ContentResolver, onDone: () -> Unit) =
        launchCatching(onSuccess = onDone) {
            val image = picked?.let { uploadPicked(container, resolver, it, ImageBucket.FOOD) } ?: existing?.image ?: return@launchCatching
            val input = FoodInput(image, description.trim().ifEmpty { null })
            val userId = container.session.state.value.userId ?: return@launchCatching
            if (existing == null) container.api.createFoodPost(bubbleId, userId, input) else container.api.updateFoodPost(existing.id, input)
            if (existing != null && existing.image != image) container.api.deleteImage(existing.image, ImageBucket.FOOD, userId)
            load()
        }

    fun delete(post: FoodPost) = launchCatching {
        container.api.deleteFoodPost(post.id)
        container.session.state.value.userId?.let { container.api.deleteImage(post.image, ImageBucket.FOOD, it) }
        _posts.update { it?.filterNot { p -> p.id == post.id } }
    }
}

/** "My posts" and "From the bubble" with photo upload (spec §8). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FoodScreen() {
    val container = LocalAppContainer.current
    val state by container.session.state.collectAsStateWithLifecycle()
    val bubble = state.currentBubble ?: return
    val me = state.userId ?: return
    val vm: FoodViewModel = viewModel(key = "food-${bubble.id}") { FoodViewModel(container, bubble.id) }
    val posts by vm.posts.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    var editing by remember { mutableStateOf<FoodPost?>(null) }
    var creating by rememberSaveable { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<FoodPost?>(null) }

    PullToRefreshBox(isRefreshing = busy && posts != null && !creating && editing == null, onRefresh = { vm.load(refresh = true) },
        modifier = Modifier.fillMaxSize().testTag("food-screen")) {
        LazyColumn(
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = Brand.tabBarClearance),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            item { AddRow(stringResource(R.string.new_food_post), onClick = { creating = true }) }
            val list = posts
            if (list == null) { item { LoadingBox() }; return@LazyColumn }
            if (list.isEmpty()) {
                item { EmptyState(Icons.Default.Restaurant, stringResource(R.string.food_empty_title), stringResource(R.string.food_empty_message)) }
                return@LazyColumn
            }
            val mine = list.filter { it.userId == me }
            val others = list.filter { it.userId != me }
            item { SectionHeader(stringResource(R.string.my_posts), mine.size) }
            if (mine.isEmpty()) item { Text(stringResource(R.string.my_posts_empty), color = BoolaaTheme.colors.textSecondary, modifier = Modifier.boolaaCard()) }
            items(mine, key = { it.id }) { p -> FoodCard(p, onEdit = { editing = p }, onDelete = { deleting = p }) }
            item { SectionHeader(stringResource(R.string.from_the_bubble), others.size) }
            if (others.isEmpty()) item { Text(stringResource(R.string.from_the_bubble_empty), color = BoolaaTheme.colors.textSecondary, modifier = Modifier.boolaaCard()) }
            items(others, key = { it.id }) { p -> FoodCard(p, onEdit = null, onDelete = null) }
        }
    }
    if (creating || editing != null) {
        val resolver = LocalContext.current.contentResolver
        FoodEditor(editing, busy, onDismiss = { creating = false; editing = null }) { picked, description ->
            vm.save(editing, picked, description, resolver) { creating = false; editing = null }
        }
    }
    deleting?.let { p ->
        ConfirmDialog(stringResource(R.string.delete_post_title), p.description.orEmpty(), stringResource(R.string.delete),
            onConfirm = { vm.delete(p) }, onDismiss = { deleting = null })
    }
    ErrorDialogFor(vm)
}

@Composable
fun FoodCard(post: FoodPost, onEdit: (() -> Unit)?, onDelete: (() -> Unit)?) {
    val locale = LocalConfiguration.current.locales[0]
    Column(Modifier.boolaaCard(0.dp).testTag("food-${post.id}")) {
        RemoteImage(post.image, Modifier.fillMaxWidth().height(200.dp), post.description)
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            post.description?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodyLarge) }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Avatar(post.user, 24.dp)
                Text(
                    "${displayName(post.user)} · ${Formats.relative(post.createdAt, locale)}",
                    style = MaterialTheme.typography.bodySmall, color = BoolaaTheme.colors.textSecondary,
                    modifier = Modifier.padding(start = 6.dp).weight(1f),
                )
                if (onDelete != null) OwnerMenu(onEdit, onDelete)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FoodEditor(existing: FoodPost?, busy: Boolean, onDismiss: () -> Unit, onSave: (Uri?, String) -> Unit) {
    var picked by remember { mutableStateOf<Uri?>(null) }
    var description by rememberSaveable { mutableStateOf(existing?.description.orEmpty()) }
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = BoolaaTheme.colors.background) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).imePadding().padding(horizontal = 20.dp).padding(bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(stringResource(if (existing == null) R.string.new_food_post else R.string.edit_food_post), style = MaterialTheme.typography.titleLarge)
            PhotoField(existing?.image, picked, onPick = { picked = it }, modifier = Modifier.clip(RoundedCornerShape(Brand.cardRadius)))
            BoolaaTextField(description, { description = it }, stringResource(R.string.description), singleLine = false, minLines = 2)
            PrimaryButton(stringResource(R.string.save), onClick = { onSave(picked, description) },
                enabled = picked != null || existing != null, loading = busy)
        }
    }
}
