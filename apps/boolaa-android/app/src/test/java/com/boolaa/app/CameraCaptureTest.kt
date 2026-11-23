package com.boolaa.app

import android.net.Uri
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import com.boolaa.app.core.CameraCapture
import com.boolaa.app.core.ImageBucket
import com.boolaa.app.core.ImageCompression
import com.boolaa.app.ui.components.CameraProblem
import com.boolaa.app.ui.components.PhotoSource
import com.boolaa.app.ui.components.PhotoSourceMenu
import com.boolaa.app.ui.theme.BoolaaTheme
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.ByteArrayInputStream
import java.io.File
import java.nio.file.Files

/**
 * "Take photo" (docs/boolaa-spec.md "Images" → "Camera"): the capture Uri, the menu (camera hidden without a camera,
 * 48dp items), the problem dialogs, and that a capture goes through the same pipeline and is deleted after it.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = android.app.Application::class, qualifiers = "en")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class CameraCaptureTest {
    @get:Rule val rule = createComposeRule()

    private val fixture: ByteArray =
        requireNotNull(javaClass.classLoader!!.getResource("fixtures/exif-gps.jpg")).readBytes()

    private fun source(camera: Boolean, onGallery: () -> Unit = {}, onCamera: (PhotoSource) -> Unit = {}) =
        PhotoSource(cameraAvailable = camera, launchGallery = onGallery, launchCamera = onCamera)

    @Test fun capture_uris_are_recognised_by_authority() {
        assertEquals("ro.boolaa.app.camera", CameraCapture.AUTHORITY)
        assertTrue(CameraCapture.isCapture(Uri.parse("content://ro.boolaa.app.camera/camera/a.jpg")))
        assertFalse(CameraCapture.isCapture(Uri.parse("content://media/picker/0/com.android.providers.media.photopicker/media/1")))
        assertFalse(CameraCapture.isCapture(Uri.parse("file:///data/user/0/ro.boolaa.app/cache/camera/a.jpg")))
    }

    @Test fun new_capture_uri_points_into_cache_camera_dir() {
        val context = ApplicationProvider.getApplicationContext<android.app.Application>()
        val uri = CameraCapture.newCaptureUri(context)
        assertTrue(CameraCapture.isCapture(uri))
        assertTrue(uri.path!!.startsWith("/camera/") && uri.path!!.endsWith(".jpg"))
        assertTrue(CameraCapture.directory(context).isDirectory)
    }

    @Test fun purge_removes_only_stale_captures() {
        val dir = Files.createTempDirectory("camera").toFile()
        val now = System.currentTimeMillis()
        val old = File(dir, "old.jpg").apply { writeBytes(byteArrayOf(1)); setLastModified(now - CameraCapture.STALE_AFTER_MS - 60_000) }
        val fresh = File(dir, "fresh.jpg").apply { writeBytes(byteArrayOf(1)); setLastModified(now - 60_000) }
        assertEquals(1, CameraCapture.purgeStale(dir, now))
        assertFalse(old.exists())
        assertTrue(fresh.exists())
        assertEquals(0, CameraCapture.purgeStale(File(dir, "missing"), now))
    }

    @Test fun capture_goes_through_the_same_pipeline_and_a_retry_reuses_the_jpeg() = runTest {
        val context = ApplicationProvider.getApplicationContext<android.app.Application>()
        val resolver = context.contentResolver
        val uri = Uri.parse("content://${CameraCapture.AUTHORITY}/camera/test-${System.nanoTime()}.jpg")
        shadowOf(resolver).registerInputStream(uri, ByteArrayInputStream(fixture))
        val fromCamera = ImageCompression.jpegFromUri(resolver, uri, ImageBucket.FOOD)
        // Same output as the gallery path (bytes in, upright 1067x1600 JPEG out).
        assertArrayEquals(ImageCompression.jpeg(fixture, ImageBucket.FOOD), fromCamera)
        // The temp file is gone after the first read; a Save retried after a failed upload gets the same JPEG.
        shadowOf(resolver).registerInputStream(uri, ByteArrayInputStream(ByteArray(0)))
        assertArrayEquals(fromCamera, ImageCompression.jpegFromUri(resolver, uri, ImageBucket.FOOD))
    }

    @Test fun menu_offers_camera_and_gallery_with_48dp_items() {
        var camera = 0; var gallery = 0
        val s = source(camera = true, onGallery = { gallery++ }, onCamera = { camera++ })
        rule.setContent { BoolaaTheme(darkTheme = false) { PhotoSourceMenu(s) } }
        rule.runOnIdle { s.open() }
        rule.onNodeWithText("Take photo").assertIsDisplayed()
        rule.onNodeWithTag("photo-source-camera").assertHeightIsAtLeast(48.dp)
        rule.onNodeWithTag("photo-source-gallery").assertHeightIsAtLeast(48.dp).performClick()
        rule.runOnIdle { assertEquals(1, gallery); assertFalse(s.menuOpen) }
        rule.runOnIdle { s.open() }
        rule.onNodeWithText("Take photo").performClick()
        rule.runOnIdle { assertEquals(1, camera) }
    }

    @Test fun without_a_camera_the_menu_hides_take_photo() {
        var gallery = 0
        val s = source(camera = false, onGallery = { gallery++ })
        rule.setContent { BoolaaTheme(darkTheme = false) { PhotoSourceMenu(s, onRemove = {}) } }
        // Nothing but the gallery to offer: straight to the picker, no one-item menu.
        rule.runOnIdle { s.open(); assertEquals(1, gallery); assertFalse(s.menuOpen) }
        // With "Remove photo" there is a menu, still without "Take photo".
        rule.runOnIdle { s.open(hasRemove = true) }
        rule.onNodeWithTag("photo-source-gallery").assertIsDisplayed()
        rule.onNodeWithTag("photo-source-remove").assertIsDisplayed()
        rule.onNodeWithTag("photo-source-camera").assertDoesNotExist()
    }

    @Test fun problems_show_the_fixed_messages() {
        val s = source(camera = true)
        rule.setContent { BoolaaTheme(darkTheme = false) { PhotoSourceMenu(s) } }
        rule.runOnIdle { s.problem = CameraProblem.UNAVAILABLE }
        rule.onNodeWithText("Camera isn't available on this device.").assertIsDisplayed()
        rule.onNodeWithText("OK").performClick()
        rule.runOnIdle { s.problem = CameraProblem.DENIED }
        rule.onNodeWithText("Allow camera access in Settings to take photos.").assertIsDisplayed()
        rule.onNodeWithTag("camera-open-settings").assertIsDisplayed()
    }
}
