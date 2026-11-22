package com.boolaa.app

import com.boolaa.app.core.BoolaaJson
import com.boolaa.app.core.InviteLink
import com.boolaa.app.core.InvitePreview
import com.boolaa.app.core.UserFacingError
import com.google.zxing.BinaryBitmap
import com.google.zxing.LuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/** Invite links (docs/boolaa-spec.md, "Invite links"). */
class InviteLinkTest {
    @Test fun parses_app_links_and_custom_schemes() {
        assertEquals("FLAT2026", InviteLink.parse("https://boolaa.ro/join/FLAT2026"))
        assertEquals("FLAT2026", InviteLink.parse("https://boolaa.ro/join/FLAT2026/"))
        assertEquals("FLAT2026", InviteLink.parse("https://boolaa.ro/join/FLAT2026?utm_source=whatsapp#x"))
        assertEquals("FLAT2026", InviteLink.parse("https://www.boolaa.ro/join/flat2026"))
        assertEquals("FLAT2026", InviteLink.parse("HTTPS://BOOLAA.RO/join/FLAT2026"))
        assertEquals("ABCD2345XY", InviteLink.parse("https://boolaa.ro/join/abcd-2345-xy"))
        assertEquals("CLIMB123", InviteLink.parse("boolaa://join/CLIMB123"))
        assertEquals("CLIMB123", InviteLink.parse("ro.boolaa.app://join/climb123"))
        assertEquals("CLIMB123", InviteLink.parse("  https://boolaa.ro/join/CLIMB123  "))
    }

    @Test fun rejects_everything_else() {
        listOf(
            null, "", "FLAT2026", "not a url",
            "http://boolaa.ro/join/FLAT2026",          // only https is an App Link
            "https://evil.ro/join/FLAT2026",
            "https://boolaa.ro.evil.com/join/FLAT2026",
            "https://boolaa.ro:8443/join/FLAT2026",
            "https://boolaa.ro/JOIN/FLAT2026",
            "https://boolaa.ro/join/",
            "https://boolaa.ro/join",
            "https://boolaa.ro/join/FLAT2026/extra",
            "https://boolaa.ro/home",
            "https://boolaa.ro/join/ABC",              // too short
            "https://boolaa.ro/join/" + "A".repeat(33), // too long
            "https://boolaa.ro/join/%F0%9F%98%80%F0%9F%98%80",
            "boolaa://auth/callback?code=abc",
            "ro.boolaa.app://auth/callback?code=FLAT2026", // the OAuth / email-link callback is not an invite
            "ro.boolaa.app://join/",
            "intent://join/FLAT2026",
            "javascript:alert(1)",
        ).forEach { assertNull("should reject $it", InviteLink.parse(it)) }
    }

    @Test fun normalises_like_the_database() {
        assertEquals("ABCD2345", InviteLink.normalize(" abcd-2345 "))
        assertEquals("ABC", InviteLink.normalize("a.b_c"))
        assertEquals("FLAT2026", InviteLink.validCode("flat 2026"))
        assertNull(InviteLink.validCode("ab-c"))
        assertNull(InviteLink.validCode("ăâîșț1"))
    }

    @Test fun builds_production_links() {
        assertEquals("https://boolaa.ro/join/FLAT2026", InviteLink.url("flat-2026"))
        assertEquals("FLAT2026", InviteLink.parse(InviteLink.url("FLAT2026")))
    }

    @Test fun share_text_has_name_and_link_in_every_language() {
        for (dir in listOf("values", "values-ro", "values-fr", "values-es", "values-it")) {
            val doc = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(File("src/main/res/$dir/strings.xml"))
            val list = doc.getElementsByTagName("string")
            val text = (0 until list.length).map { list.item(it) }.first { it.attributes.getNamedItem("name").nodeValue == "invite_link_share_text" }
                .textContent.replace("\\\"", "\"")
            val shared = String.format(text, "Flatmates", InviteLink.url("FLAT2026"))
            assertTrue("$dir: $shared", "Flatmates" in shared && "https://boolaa.ro/join/FLAT2026" in shared)
        }
    }

    @Test fun qr_code_decodes_back_to_the_link() {
        val link = InviteLink.url("ABCD2345XY")
        val m = InviteLink.qrMatrix(link)
        assertTrue(m.width == m.height && m.width >= 21)
        val scale = 4
        val w = m.width * scale
        val pixels = ByteArray(w * w) { i -> if (m[(i % w) / scale, (i / w) / scale]) 0 else 0xFF.toByte() }
        val source = object : LuminanceSource(w, w) {
            override fun getRow(y: Int, row: ByteArray?): ByteArray = pixels.copyOfRange(y * w, (y + 1) * w)
            override fun getMatrix(): ByteArray = pixels
        }
        assertEquals(link, QRCodeReader().decode(BinaryBitmap(HybridBinarizer(source))).text)
    }

    @Test fun decodes_preview_rows() {
        val rows = BoolaaJson.json.decodeFromString<List<InvitePreview>>(
            """[{"bubble_id":null,"name":"Flatmates","logo":null,"member_count":2,"max_size":8,"status":"pending"}]""",
        )
        assertEquals(InvitePreview.Status.PENDING, rows.single().kind)
        assertNull(rows.single().bubbleId)
        val member = BoolaaJson.json.decodeFromString<InvitePreview>(
            """{"bubble_id":"aaaaaaaa-0000-0000-0000-000000000001","name":"F","logo":"https://x/y.jpg","member_count":2,"max_size":8,"status":"member"}""",
        )
        assertEquals(InvitePreview.Status.MEMBER, member.kind)
        assertEquals(InvitePreview.Status.FULL, member.copy(status = "full").kind)
        assertEquals(InvitePreview.Status.OPEN, member.copy(status = "open").kind)
    }

    @Test fun maps_invite_backend_errors() {
        assertEquals(UserFacingError.TOO_MANY_INVITE_ATTEMPTS, UserFacingError.classify("too many attempts", "54000"))
        assertEquals(UserFacingError.ONLY_OWNER_CAN_ROTATE, UserFacingError.classify("only the owner can change the invite code", "P0001"))
        assertEquals(UserFacingError.INVALID_INVITE_CODE, UserFacingError.classify("invalid invite code", "P0001"))
        // Device-code function codes keep their own mapping.
        assertEquals(UserFacingError.TOO_MANY_ATTEMPTS, UserFacingError.fromFunctionCode("too_many_attempts"))
    }
}
