package com.boolaa.app.core

import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.media.ExifInterface
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Client-side image pipeline (docs/boolaa-spec.md, "Images"), shared with web (src/lib/image.ts) and iOS.
 * Decodes the picked photo, applies its EXIF orientation, downsizes it so the long edge is at most 1600 px
 * (avatars 512 px) and re-encodes it as JPEG 82. Only pixels reach the encoder, so no metadata survives
 * (EXIF, GPS location, XMP, IPTC). Byte limits mirror supabase/migrations/20261123100000_image_limits.sql.
 */
object ImageCompression {
    /** A picked file the pipeline refuses; mapped to UserFacingError.IMAGE_TOO_LARGE / IMAGE_UNSUPPORTED. */
    class ImageException(val tooLarge: Boolean) : Exception(if (tooLarge) "image too large" else "image unsupported")

    const val QUALITY = 82
    /** Picked files above this are refused before decoding; a phone photo is well below it. */
    const val MAX_INPUT_BYTES = 50 * 1024 * 1024

    fun maxSide(bucket: ImageBucket) = if (bucket == ImageBucket.AVATARS) 512 else 1600
    fun maxBytes(bucket: ImageBucket) = (if (bucket == ImageBucket.AVATARS) 2 else 5) * 1024 * 1024

    /** Size of an upright [width] x [height] image with its long edge capped at [maxSide] (never upscaled). */
    fun targetSize(width: Int, height: Int, maxSide: Int): Pair<Int, Int> {
        val scale = min(1.0, maxSide.toDouble() / max(width, height))
        return max(1, (width * scale).roundToInt()) to max(1, (height * scale).roundToInt())
    }

    /** Reads the picked photo (at most [MAX_INPUT_BYTES]) and returns the JPEG to upload to [bucket]. */
    suspend fun jpegFromUri(resolver: ContentResolver, uri: Uri, bucket: ImageBucket): ByteArray =
        withContext(Dispatchers.IO) {
            val bytes = resolver.openInputStream(uri)?.use { input ->
                val out = ByteArrayOutputStream()
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val n = input.read(buffer)
                    if (n < 0) break
                    out.write(buffer, 0, n)
                    if (out.size() > MAX_INPUT_BYTES) throw ImageException(tooLarge = true)
                }
                out.toByteArray()
            } ?: throw ImageException(tooLarge = false)
            jpeg(bytes, bucket)
        }

    /** The JPEG to upload to [bucket]: upright, long edge <= maxSide, no metadata, within the bucket limit. */
    fun jpeg(bytes: ByteArray, bucket: ImageBucket): ByteArray {
        val out = jpeg(bytes, maxSide(bucket))
        if (out.size > maxBytes(bucket)) throw ImageException(tooLarge = true)
        return out
    }

    fun jpeg(bytes: ByteArray, maxSide: Int, quality: Int = QUALITY): ByteArray {
        if (bytes.size > MAX_INPUT_BYTES) throw ImageException(tooLarge = true)
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw ImageException(tooLarge = false)

        val orientation = runCatching {
            ExifInterface(ByteArrayInputStream(bytes)).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)
        val swaps = orientation in 5..8 // 90-degree rotations swap width and height
        val (targetW, targetH) = targetSize(
            if (swaps) bounds.outHeight else bounds.outWidth,
            if (swaps) bounds.outWidth else bounds.outHeight,
            maxSide,
        )

        // Decode at a power-of-two subsample that stays at least the target size, then scale exactly.
        val targetLong = max(targetW, targetH)
        var sample = 1
        while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= targetLong) sample *= 2
        val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply {
            inSampleSize = sample
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }) ?: throw ImageException(tooLarge = false)

        val matrix = orientationMatrix(orientation)
        val mapped = RectF(0f, 0f, decoded.width.toFloat(), decoded.height.toFloat()).also { matrix.mapRect(it) }
        matrix.postTranslate(-mapped.left, -mapped.top)
        matrix.postScale(targetW / mapped.width(), targetH / mapped.height())

        val output = Bitmap.createBitmap(targetW, targetH, Bitmap.Config.ARGB_8888)
        Canvas(output).apply {
            drawColor(Color.WHITE) // transparent PNG/WebP areas become white, not black
            drawBitmap(decoded, matrix, Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG))
        }
        decoded.recycle()
        val encoded = ByteArrayOutputStream().use { out ->
            if (!output.compress(Bitmap.CompressFormat.JPEG, quality, out)) throw ImageException(tooLarge = false)
            out.toByteArray()
        }
        output.recycle()
        return stripSegments(encoded)
    }

    /** EXIF orientation as a matrix on the decoded (stored) pixels, as Glide's TransformationUtils does it. */
    private fun orientationMatrix(orientation: Int) = Matrix().apply {
        when (orientation) {
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> setScale(-1f, 1f)
            ExifInterface.ORIENTATION_ROTATE_180 -> setRotate(180f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> { setRotate(180f); postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_TRANSPOSE -> { setRotate(90f); postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_ROTATE_90 -> setRotate(90f)
            ExifInterface.ORIENTATION_TRANSVERSE -> { setRotate(-90f); postScale(-1f, 1f) }
            ExifInterface.ORIENTATION_ROTATE_270 -> setRotate(-90f)
        }
    }

    /**
     * Drops APP1..APP15 and COM header segments from a JPEG, keeping APP0 (JFIF) and the image data.
     * Bitmap.compress writes none today; this keeps the guarantee if an encoder ever adds its own block.
     */
    fun stripSegments(jpeg: ByteArray): ByteArray {
        if (jpeg.size < 4 || jpeg[0] != 0xFF.toByte() || jpeg[1] != 0xD8.toByte()) return jpeg
        val out = ByteArrayOutputStream(jpeg.size)
        out.write(jpeg, 0, 2)
        var i = 2
        while (i + 4 <= jpeg.size && jpeg[i] == 0xFF.toByte()) {
            val marker = jpeg[i + 1].toInt() and 0xFF
            if (marker == 0xDA) break // start of scan: the rest is image data
            val end = i + 2 + ((jpeg[i + 2].toInt() and 0xFF) shl 8 or (jpeg[i + 3].toInt() and 0xFF))
            if (end > jpeg.size) return jpeg
            if (marker !in 0xE1..0xEF && marker != 0xFE) out.write(jpeg, i, end - i)
            i = end
        }
        out.write(jpeg, i, jpeg.size - i)
        return out.toByteArray()
    }
}
