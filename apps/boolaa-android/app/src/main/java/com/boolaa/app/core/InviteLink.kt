package com.boolaa.app.core

import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.common.BitMatrix
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.net.URI

/**
 * Invite links (docs/boolaa-spec.md, "Invite links"): `https://boolaa.ro/join/CODE`, where CODE is the bubble's invite
 * code. Opening one only shows a preview; joining still goes through request_to_join and the members' vote.
 */
object InviteLink {
    const val HOST = "boolaa.ro"
    private val HOSTS = setOf(HOST, "www.$HOST")
    /** Custom schemes, used when the App Link isn't verified: the legacy `boolaa://` and the auth scheme. */
    private val SCHEMES = setOf("boolaa", Backend.AUTH_SCHEME)

    /** Uppercase, without spaces, dashes or anything else that isn't a letter or digit (as normalize_invite_code). */
    fun normalize(code: String): String = code.filter { it.isLetterOrDigit() && it.code < 128 }.uppercase()

    /** A normalised code of 4-32 ASCII letters and digits, or null. */
    fun validCode(raw: String): String? = normalize(raw).takeIf { it.length in 4..32 }

    /** Always the production host, so shared links work for everyone. */
    fun url(code: String): String = "https://$HOST/join/${normalize(code)}"

    /**
     * The invite code in an opened link, or null if it isn't an invite:
     * `https://(www.)boolaa.ro/join/CODE[/][?…]`, `boolaa://join/CODE`, `ro.boolaa.app://join/CODE`.
     */
    fun parse(link: String?): String? {
        if (link.isNullOrBlank()) return null
        val uri = runCatching { URI(link.trim()) }.getOrNull() ?: return null
        val scheme = uri.scheme?.lowercase() ?: return null
        val host = uri.host?.lowercase()
        // Decoded path: percent-escapes must not turn into code characters ("%F0…" is not "F0…").
        val segments = (uri.path ?: "").split('/').filter { it.isNotEmpty() }
        val code = when {
            scheme == "https" && host in HOSTS && segments.size == 2 && segments[0] == "join" -> segments[1]
            scheme in SCHEMES && host == "join" && segments.size == 1 -> segments[0]
            else -> return null
        }
        if (uri.port != -1 && scheme == "https") return null
        return validCode(code)
    }

    /** QR modules for [url] (medium error correction, 2-module quiet zone). Rendered by the settings dialog. */
    fun qrMatrix(url: String): BitMatrix =
        QRCodeWriter().encode(url, BarcodeFormat.QR_CODE, 0, 0, mapOf(
            EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M,
            EncodeHintType.MARGIN to 2,
            EncodeHintType.CHARACTER_SET to "UTF-8",
        ))
}

/** One row of `get_invite_preview(p_code)`; no row means the code matches no bubble. */
@Serializable
data class InvitePreview(
    /** Set only when the caller is already a member (to switch to it). */
    @SerialName("bubble_id") val bubbleId: String? = null,
    val name: String,
    val logo: String? = null,
    @SerialName("member_count") val memberCount: Int,
    @SerialName("max_size") val maxSize: Int,
    val status: String,
) {
    enum class Status { MEMBER, PENDING, FULL, OPEN }

    val kind: Status
        get() = when (status) {
            "member" -> Status.MEMBER
            "pending" -> Status.PENDING
            "full" -> Status.FULL
            else -> Status.OPEN
        }
}
