package com.boolaa.app.core

import android.content.ContentResolver
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import androidx.core.content.FileProvider
import com.boolaa.app.BuildConfig
import java.io.File
import java.util.UUID

/**
 * "Take photo" (docs/boolaa-spec.md, "Images" → "Camera"). The system camera app (ActivityResultContracts.TakePicture)
 * writes the capture to a FileProvider content Uri in `cacheDir/camera/`; the Uri then goes through the same image
 * pipeline as a gallery pick (ImageCompression.jpegFromUri), which deletes the temp file once it has read it.
 * No CAMERA permission is declared: ACTION_IMAGE_CAPTURE needs none unless the app declares it.
 */
object CameraCapture {
    const val DIR = "camera"
    /** Matches the provider in AndroidManifest.xml (`${applicationId}.camera`) and res/xml/camera_paths.xml. */
    val AUTHORITY: String = "${BuildConfig.APPLICATION_ID}.camera"
    /** Captures left behind (the editor was closed without saving) are removed at the next launch. */
    const val STALE_AFTER_MS = 24L * 60 * 60 * 1000

    /** Whether the device has any camera (PackageManager.FEATURE_CAMERA_ANY); "Take photo" is hidden otherwise. */
    fun isAvailable(pm: PackageManager): Boolean = pm.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY)

    fun directory(context: Context): File = File(context.cacheDir, DIR)

    /** A fresh, empty file for the camera app to write to, as a content Uri it may be granted write access to. */
    fun newCaptureUri(context: Context): Uri {
        val dir = directory(context).apply { mkdirs() }
        val file = File(dir, "${UUID.randomUUID()}.jpg")
        return FileProvider.getUriForFile(context, AUTHORITY, file)
    }

    /** True for a Uri [newCaptureUri] made (and so a temp file this app owns and must delete). */
    fun isCapture(uri: Uri): Boolean = uri.scheme == ContentResolver.SCHEME_CONTENT && uri.authority == AUTHORITY

    /** Deletes the temp file behind a capture Uri (FileProvider.delete removes the file); ignores any other Uri. */
    fun delete(resolver: ContentResolver, uri: Uri) {
        if (isCapture(uri)) runCatching { resolver.delete(uri, null, null) }
    }

    /** Removes captures older than [maxAgeMs] (abandoned editors, a crash mid-save). Returns how many were removed. */
    fun purgeStale(dir: File, now: Long = System.currentTimeMillis(), maxAgeMs: Long = STALE_AFTER_MS): Int =
        dir.listFiles().orEmpty().count { it.isFile && now - it.lastModified() > maxAgeMs && it.delete() }

    // The pipeline deletes a capture after reading it; if the upload then fails (offline) and the user taps Save again,
    // the same Uri comes back. The last few processed captures keep their JPEG so that retry still works.
    private const val PROCESSED_KEEP = 3
    private val processed = object : LinkedHashMap<String, ByteArray>(PROCESSED_KEEP + 1, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, ByteArray>?) = size > PROCESSED_KEEP
    }

    private fun key(uri: Uri, bucket: ImageBucket) = "$uri|$bucket"

    @Synchronized fun processedJpeg(uri: Uri, bucket: ImageBucket): ByteArray? = processed[key(uri, bucket)]

    @Synchronized fun rememberProcessed(uri: Uri, bucket: ImageBucket, jpeg: ByteArray) { processed[key(uri, bucket)] = jpeg }
}
