package com.boolaa.app

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.media.ExifInterface
import com.boolaa.app.core.ImageBucket
import com.boolaa.app.core.ImageCompression
import com.boolaa.app.core.UserFacingError
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

/** Header segments of a JPEG (APP1 Exif / XMP, APP13 IPTC, COM) and its frame size. */
private class JpegSegments(b: ByteArray) {
    var width = 0; var height = 0
    var exif = false; var xmp = false; var iptc = false; var comment = false

    init {
        require(b.size > 4 && b[0] == 0xFF.toByte() && b[1] == 0xD8.toByte()) { "not a JPEG" }
        var i = 2
        while (i + 4 <= b.size && b[i] == 0xFF.toByte()) {
            val marker = b[i + 1].toInt() and 0xFF
            if (marker == 0xD9 || marker == 0xDA) break
            val len = (b[i + 2].toInt() and 0xFF) shl 8 or (b[i + 3].toInt() and 0xFF)
            val body = b.copyOfRange(i + 4, minOf(b.size, i + 2 + len))
            val head = String(body.copyOfRange(0, minOf(body.size, 28)), Charsets.ISO_8859_1)
            if (marker == 0xE1 && head.startsWith("Exif\u0000\u0000")) exif = true
            if (marker == 0xE1 && head.startsWith("http://ns.adobe.com/xap/1.0/")) xmp = true
            if (marker == 0xED) iptc = true
            if (marker == 0xFE) comment = true
            if (marker in 0xC0..0xCF && marker != 0xC4 && marker != 0xC8 && marker != 0xCC) {
                height = (body[1].toInt() and 0xFF) shl 8 or (body[2].toInt() and 0xFF)
                width = (body[3].toInt() and 0xFF) shl 8 or (body[4].toInt() and 0xFF)
            }
            i += 2 + len
        }
    }
}

private fun ByteArray.contains(text: String): Boolean = String(this, Charsets.ISO_8859_1).contains(text)

/**
 * Image pipeline (docs/boolaa-spec.md "Images"). Fixture exif-gps.jpg is shared with web and iOS: stored
 * 2400x1600 (left half red, right half blue) with EXIF Orientation 6 (displayed 1600x2400, red on top), GPS
 * coordinates and camera make "BoolaaTestCam". Native graphics so decoding, drawing and JPEG encoding are real.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = android.app.Application::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ImageCompressionTest {
    private val fixture: ByteArray =
        requireNotNull(javaClass.classLoader!!.getResource("fixtures/exif-gps.jpg")).readBytes()

    private fun expectClean(out: ByteArray, width: Int, height: Int, upright: Boolean = true) {
        val seg = JpegSegments(out)
        assertEquals("width", width, seg.width)
        assertEquals("height", height, seg.height)
        assertFalse("EXIF segment", seg.exif)
        assertFalse("XMP segment", seg.xmp)
        assertFalse("IPTC segment", seg.iptc)
        assertFalse("comment", seg.comment)
        assertFalse(out.contains("BoolaaTestCam"))
        val exif = ExifInterface(ByteArrayInputStream(out))
        assertFalse(exif.getLatLong(FloatArray(2)))
        assertNull(exif.getAttribute(ExifInterface.TAG_GPS_LATITUDE))
        assertNull(exif.getAttribute(ExifInterface.TAG_MAKE))
        assertEquals(ExifInterface.ORIENTATION_UNDEFINED, exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, 0))
        if (upright) {
            val bmp = BitmapFactory.decodeByteArray(out, 0, out.size)
            val top = bmp.getPixel(width / 2, 4)
            val bottom = bmp.getPixel(width / 2, height - 5)
            assertTrue("top should be red: ${Integer.toHexString(top)}", Color.red(top) > 200 && Color.blue(top) < 60)
            assertTrue("bottom should be blue: ${Integer.toHexString(bottom)}", Color.blue(bottom) > 200 && Color.red(bottom) < 60)
        }
    }

    @Test fun target_size_matches_web_and_ios() {
        assertEquals(1600 to 1200, ImageCompression.targetSize(4032, 3024, 1600))
        assertEquals(1067 to 1600, ImageCompression.targetSize(1600, 2400, 1600))
        assertEquals(512 to 512, ImageCompression.targetSize(3000, 3000, 512))
        assertEquals(800 to 600, ImageCompression.targetSize(800, 600, 1600))
        assertEquals(1600 to 2, ImageCompression.targetSize(10000, 10, 1600))
        assertEquals(512, ImageCompression.maxSide(ImageBucket.AVATARS))
        assertEquals(1600, ImageCompression.maxSide(ImageBucket.FOOD))
        assertEquals(2 * 1024 * 1024, ImageCompression.maxBytes(ImageBucket.AVATARS))
        assertEquals(5 * 1024 * 1024, ImageCompression.maxBytes(ImageBucket.MARKET))
    }

    @Test fun fixture_really_carries_gps_and_orientation() {
        val exif = ExifInterface(ByteArrayInputStream(fixture))
        assertEquals(ExifInterface.ORIENTATION_ROTATE_90, exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, 0))
        assertTrue(exif.getLatLong(FloatArray(2)))
        assertTrue(JpegSegments(fixture).exif)
    }

    @Test fun photos_are_upright_downsized_and_stripped() {
        expectClean(ImageCompression.jpeg(fixture, ImageBucket.FOOD), 1067, 1600)
        expectClean(ImageCompression.jpeg(fixture, ImageBucket.MARKET), 1067, 1600)
        expectClean(ImageCompression.jpeg(fixture, ImageBucket.AVATARS), 341, 512)
    }

    @Test fun small_png_is_not_upscaled_and_becomes_jpeg_on_white() {
        val png = ByteArrayOutputStream().use {
            Bitmap.createBitmap(300, 200, Bitmap.Config.ARGB_8888).compress(Bitmap.CompressFormat.PNG, 100, it)
            it.toByteArray()
        }
        val out = ImageCompression.jpeg(png, ImageBucket.MARKET)
        expectClean(out, 300, 200, upright = false)
        val p = BitmapFactory.decodeByteArray(out, 0, out.size).getPixel(150, 100)
        assertTrue("transparent becomes white", Color.red(p) > 240 && Color.green(p) > 240 && Color.blue(p) > 240)
    }

    @Test fun undecodable_and_huge_inputs_are_refused() {
        val bad = assertThrows(ImageCompression.ImageException::class.java) {
            ImageCompression.jpeg("not an image".toByteArray(), ImageBucket.FOOD)
        }
        assertFalse(bad.tooLarge)
        val huge = assertThrows(ImageCompression.ImageException::class.java) {
            ImageCompression.jpeg(ByteArray(ImageCompression.MAX_INPUT_BYTES + 1), ImageBucket.FOOD)
        }
        assertTrue(huge.tooLarge)
    }

    @Test fun strip_segments_keeps_jfif_and_image_data() {
        // SOI, APP0 JFIF, APP1 Exif, COM, SOS + data, EOI.
        val app0 = byteArrayOf(0xFF.toByte(), 0xE0.toByte(), 0, 6, 'J'.code.toByte(), 'F'.code.toByte(), 'I'.code.toByte(), 'F'.code.toByte())
        val app1 = byteArrayOf(0xFF.toByte(), 0xE1.toByte(), 0, 8) + "Exif\u0000\u0000".toByteArray(Charsets.ISO_8859_1)
        val com = byteArrayOf(0xFF.toByte(), 0xFE.toByte(), 0, 4, 'h'.code.toByte(), 'i'.code.toByte())
        val scan = byteArrayOf(0xFF.toByte(), 0xDA.toByte(), 0, 2, 1, 2, 3, 0xFF.toByte(), 0xD9.toByte())
        val soi = byteArrayOf(0xFF.toByte(), 0xD8.toByte())
        assertArrayEquals(soi + app0 + scan, ImageCompression.stripSegments(soi + app0 + app1 + com + scan))
        val notJpeg = byteArrayOf(1, 2, 3)
        assertArrayEquals(notJpeg, ImageCompression.stripSegments(notJpeg))
    }

    @Test fun image_and_storage_errors_map_to_translated_messages() {
        assertEquals(UserFacingError.IMAGE_TOO_LARGE, UserFacingError.classify(ImageCompression.ImageException(tooLarge = true)))
        assertEquals(UserFacingError.IMAGE_UNSUPPORTED, UserFacingError.classify(ImageCompression.ImageException(tooLarge = false)))
        // Shapes of the local Storage answers (HTTP 400 with statusCode 413/415 in the body) and the hosted ones.
        assertEquals(UserFacingError.IMAGE_TOO_LARGE,
            UserFacingError.fromStorage(413, "EntityTooLarge", "Payload too large", "The object exceeded the maximum allowed size"))
        assertEquals(UserFacingError.IMAGE_TOO_LARGE, UserFacingError.fromStorage(400, null, null, "The object exceeded the maximum allowed size"))
        assertEquals(UserFacingError.IMAGE_UNSUPPORTED,
            UserFacingError.fromStorage(415, "InvalidMimeType", "invalid_mime_type", "mime type image/png is not supported"))
        assertEquals(UserFacingError.IMAGE_UNSUPPORTED, UserFacingError.fromStorage(400, null, "invalid_mime_type", null))
        assertEquals(UserFacingError.PERMISSION_DENIED,
            UserFacingError.fromStorage(403, "AccessDenied", "Unauthorized", "new row violates row-level security policy"))
        assertEquals(UserFacingError.GENERIC, UserFacingError.fromStorage(500, null, "internal", "boom"))
        assertEquals(R.string.error_image_too_large, UserFacingError.IMAGE_TOO_LARGE.message)
        assertEquals(R.string.error_image_unsupported, UserFacingError.IMAGE_UNSUPPORTED.message)
    }
}
