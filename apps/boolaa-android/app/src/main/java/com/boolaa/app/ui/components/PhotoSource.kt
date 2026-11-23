package com.boolaa.app.ui.components

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import com.boolaa.app.R
import com.boolaa.app.core.CameraCapture
import com.boolaa.app.ui.theme.BoolaaTheme
import com.boolaa.app.ui.theme.Hue
import com.boolaa.app.ui.theme.Radius
import com.boolaa.app.ui.theme.Type

/** Why "Take photo" couldn't start. */
enum class CameraProblem { UNAVAILABLE, DENIED }

/**
 * Where a new photo comes from: "Take photo" (system camera, core/CameraCapture.kt) or "Choose from gallery" (Android
 * Photo Picker). Both hand a Uri to the same callback, which runs it through the same image pipeline.
 * Call [open] from the photo slot / button and put [PhotoSourceMenu] inside that slot so the menu anchors to it.
 */
@Stable
class PhotoSource internal constructor(
    val cameraAvailable: Boolean,
    private val launchGallery: () -> Unit,
    private val launchCamera: (PhotoSource) -> Unit,
) {
    var menuOpen by mutableStateOf(false)
        internal set
    var problem by mutableStateOf<CameraProblem?>(null)
        internal set

    /**
     * Opens the menu; with no camera and nothing else to offer ([hasRemove] false) it goes straight to the gallery,
     * since a one-item menu is just an extra tap.
     */
    fun open(hasRemove: Boolean = false) {
        if (!cameraAvailable && !hasRemove) launchGallery() else menuOpen = true
    }

    fun takePhoto() { menuOpen = false; launchCamera(this) }
    fun chooseFromGallery() { menuOpen = false; launchGallery() }
    fun dismiss() { menuOpen = false }
    fun clearProblem() { problem = null }
}

/**
 * DEBUG-only: instrumented tests can't drive the system Photo Picker, so they queue a fixture Uri here; the next
 * "Choose from gallery" returns it instead of opening the picker (ignored in release builds).
 */
object DebugPhotoPicks {
    @Volatile var next: Uri? = null
    internal fun take(): Uri? = if (com.boolaa.app.BuildConfig.DEBUG) next.also { next = null } else null
}

/** [onPicked] gets the gallery pick or the camera capture; a cancelled camera leaves nothing behind. */
@Composable
fun rememberPhotoSource(onPicked: (Uri) -> Unit): PhotoSource {
    val context = LocalContext.current
    val cameraAvailable = remember { CameraCapture.isAvailable(context.packageManager) }
    // The camera app may outlive our process; the pending Uri survives that through the saved state.
    var pending by rememberSaveable { mutableStateOf<String?>(null) }
    val picked by androidx.compose.runtime.rememberUpdatedState(onPicked)
    val gallery = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> if (uri != null) picked(uri) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { saved ->
        val uri = pending?.let(Uri::parse)
        pending = null
        if (uri != null) {
            if (saved) onPicked(uri) else CameraCapture.delete(context.contentResolver, uri)
        }
    }
    val source = remember {
        PhotoSource(
            cameraAvailable = cameraAvailable,
            launchGallery = {
                val fixture = DebugPhotoPicks.take()
                if (fixture != null) picked(fixture) else gallery.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            },
            launchCamera = { self ->
                val uri = runCatching { CameraCapture.newCaptureUri(context) }.getOrNull()
                if (uri == null) {
                    self.problem = CameraProblem.UNAVAILABLE
                } else {
                    pending = uri.toString()
                    try {
                        camera.launch(uri)
                    } catch (e: ActivityNotFoundException) {
                        // A camera but no app that handles ACTION_IMAGE_CAPTURE (e.g. disabled by a device policy).
                        pending = null; CameraCapture.delete(context.contentResolver, uri)
                        self.problem = CameraProblem.UNAVAILABLE
                    } catch (e: SecurityException) {
                        // Only if a CAMERA permission is ever declared (a library merging it in) and not granted.
                        pending = null; CameraCapture.delete(context.contentResolver, uri)
                        self.problem = CameraProblem.DENIED
                    }
                }
            },
        )
    }
    return source
}

/**
 * The "Take photo" / "Choose from gallery" menu (plus "Remove photo" when [onRemove] is set), anchored to the slot it is
 * placed in, and the camera-unavailable / camera-denied dialogs. Items are 48dp DropdownMenuItems like ItemMenu.
 */
@Composable
fun PhotoSourceMenu(source: PhotoSource, onRemove: (() -> Unit)? = null, removeLabel: String? = null) {
    val c = BoolaaTheme.colors
    DropdownMenu(
        expanded = source.menuOpen, onDismissRequest = source::dismiss,
        shape = RoundedCornerShape(Radius.field), containerColor = c.card,
    ) {
        if (source.cameraAvailable) DropdownMenuItem(
            text = { Text(stringResource(R.string.take_photo), style = Type.body) }, onClick = source::takePhoto,
            leadingIcon = { Icon(BoolaaIcons.Camera, contentDescription = null) }, modifier = Modifier.testTag("photo-source-camera"),
        )
        DropdownMenuItem(
            text = { Text(stringResource(R.string.choose_from_gallery), style = Type.body) }, onClick = source::chooseFromGallery,
            leadingIcon = { Icon(BoolaaIcons.Photo, contentDescription = null) }, modifier = Modifier.testTag("photo-source-gallery"),
        )
        if (onRemove != null) DropdownMenuItem(
            text = { Text(removeLabel ?: stringResource(R.string.chat_remove_photo), style = Type.body, color = c.dangerText) },
            onClick = { source.dismiss(); onRemove() },
            leadingIcon = { Icon(BoolaaIcons.Delete, contentDescription = null, tint = c.dangerText) },
            modifier = Modifier.testTag("photo-source-remove"),
        )
    }
    CameraProblemDialog(source.problem, source::clearProblem)
}

@Composable
private fun CameraProblemDialog(problem: CameraProblem?, onDismiss: () -> Unit) {
    if (problem == null) return
    val context = LocalContext.current
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            if (problem == CameraProblem.DENIED) {
                TextButton(onClick = {
                    onDismiss()
                    runCatching {
                        context.startActivity(
                            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                        )
                    }
                }, modifier = Modifier.testTag("camera-open-settings")) {
                    Text(stringResource(R.string.open_settings), style = Type.headline, color = Hue.grape.text)
                }
            } else {
                TextButton(onClick = onDismiss) { Text(stringResource(R.string.ok), style = Type.headline, color = Hue.grape.text) }
            }
        },
        dismissButton = if (problem == CameraProblem.DENIED) {
            { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel), style = Type.headline, color = Hue.grape.text) } }
        } else null,
        text = {
            Text(
                stringResource(if (problem == CameraProblem.DENIED) R.string.camera_denied else R.string.camera_unavailable),
                style = Type.body, modifier = Modifier.testTag("camera-problem"),
            )
        },
        shape = RoundedCornerShape(Radius.hero), containerColor = BoolaaTheme.colors.card,
    )
}
