package com.boolaa.app

import androidx.compose.ui.graphics.toArgb
import com.boolaa.app.ui.theme.Brand
import com.boolaa.app.ui.theme.DarkColors
import com.boolaa.app.ui.theme.BrandTokens
import com.boolaa.app.ui.theme.InkOnColor
import com.boolaa.app.ui.theme.Hue
import com.boolaa.app.ui.theme.LightColors
import com.boolaa.app.ui.theme.Radius
import java.io.File
import org.junit.Assume.assumeTrue
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/** Bubble and avatar colours must match iOS and the web: the vectors of docs/design-system.md §2.3. */
class DesignTokensTest {
    @Test fun fnv1a_matches_reference_vectors() {
        assertEquals(2_166_136_261u, Hue.fnv1a(""))
        assertEquals(3_826_002_220u, Hue.fnv1a("a"))
        assertEquals(3_352_750_575u, Hue.fnv1a("boolaa"))
    }

    @Test fun seeded_bubbles_and_people_get_their_documented_hue() {
        assertSame(Hue.sky, Hue.forId("aaaaaaaa-0000-0000-0000-000000000001"))        // Flatmates
        assertSame(Hue.tangerine, Hue.forId("aaaaaaaa-0000-0000-0000-000000000002"))  // Climbing Crew
        assertSame(Hue.sunny, Hue.forId("11111111-1111-1111-1111-111111111111"))      // Alice
        assertSame(Hue.pink, Hue.forId("22222222-2222-2222-2222-222222222222"))       // Bob
        assertSame(Hue.indigo, Hue.forId("33333333-3333-3333-3333-333333333333"))     // Carol
    }

    @Test fun ids_are_hashed_lowercase_and_missing_ids_fall_back_to_grape() {
        assertSame(Hue.forId("aaaaaaaa-0000-0000-0000-000000000001"), Hue.forId("AAAAAAAA-0000-0000-0000-000000000001"))
        assertSame(Hue.grape, Hue.forId(null))
    }

    @Test fun palette_order_and_on_fill_follow_the_design_system() {
        assertEquals(listOf("grape", "coral", "mint", "sky", "sunny", "pink", "tangerine", "indigo"), Hue.bubblePalette.map { it.name })
        assertEquals(setOf("grape", "indigo"), Hue.bubblePalette.filter { it.onFill == androidx.compose.ui.graphics.Color.White }.map { it.name }.toSet())
    }

    // docs/design-system.md is the single source of truth; the three token files must carry the same values.
    private fun hex(color: androidx.compose.ui.graphics.Color) = "%06X".format(color.toArgb() and 0xFFFFFF)

    private fun sibling(path: String): File? =
        listOf(File("../.."), File("../../.."), File("..")).map { File(it, path) }.firstOrNull { it.exists() }

    @Test fun shared_tokens_match_ios_and_web() {
        val swift = sibling("boolaa-ios/Boolaa/Core/Theme.swift")
        val css = sibling("boolaa-web/src/app/globals.css")
        assumeTrue("iOS and web sources are next to the Android app", swift != null && css != null)
        val ios = swift!!.readText().uppercase()
        val web = css!!.readText().uppercase()
        val shared = mapOf(
            "grape text light" to Hue.grape.text(false), "grape text dark" to Hue.grape.text(true),
            "inkSecondary light" to LightColors.textSecondary, "inkSecondary dark" to DarkColors.textSecondary,
            "dangerText light" to LightColors.dangerText, "dangerText dark" to DarkColors.dangerText,
            "danger" to Brand.danger, "taken" to Brand.taken,
            "fieldBorder light" to LightColors.fieldBorder, "fieldBorder dark" to DarkColors.fieldBorder,
            "background light" to LightColors.background, "background dark" to DarkColors.background,
            "card dark" to DarkColors.card, "field light" to LightColors.field, "field dark" to DarkColors.field,
        )
        for ((name, color) in shared) {
            val h = hex(color)
            assertTrue("$name #$h missing from Theme.swift", ios.contains("0X$h"))
            assertTrue("$name #$h missing from globals.css", web.contains("#$h"))
        }
        for (hue in Hue.bubblePalette) for (dark in listOf(false, true)) {
            val h = hex(hue.text(dark))
            assertTrue("${hue.name} text #$h missing from Theme.swift", ios.contains("0X$h"))
            assertTrue("${hue.name} text #$h missing from globals.css", web.contains("#$h"))
        }
        assertTrue(web.contains("--RADIUS-SMALL: ${Radius.small.value.toInt()}PX") && web.contains("--RADIUS-CARD: ${Radius.card.value.toInt()}PX"))
    }

    /** A number assigned in Theme.swift (`name = 0.28` or `name: CGFloat = 0.28`). */
    private fun swiftNumber(swift: String, name: String): Double =
        Regex("""\b$name(?:: \w+)? = ([0-9.]+)""").find(swift)?.groupValues?.get(1)?.toDouble()
            ?: throw AssertionError("$name missing from Theme.swift")

    /** Every value of a CSS custom property in globals.css, in file order (light first, then the dark overrides). */
    private fun cssValues(css: String, name: String): List<String> =
        Regex("""--$name:\s*([^;]+);""").findAll(css).map { it.groupValues[1].trim() }.toList()

    private fun close(a: Number, b: Number) = kotlin.math.abs(a.toDouble() - b.toDouble()) < 1e-6

    // docs/design-system.md §8: the redesign's strengths must be the same numbers on all three platforms.
    @Test fun brand_redesign_tokens_match_ios_and_web() {
        val swiftFile = sibling("boolaa-ios/Boolaa/Core/Theme.swift")
        val cssFile = sibling("boolaa-web/src/app/globals.css")
        assumeTrue("iOS and web sources are next to the Android app", swiftFile != null && cssFile != null)
        val swift = swiftFile!!.readText()
        val css = cssFile!!.readText()

        // §8.1 band strengths, fade and circles.
        assertTrue(close(swiftNumber(swift, "bandLight"), BrandTokens.BAND_LIGHT.toDouble().round2()))
        assertTrue(close(swiftNumber(swift, "bandDark"), BrandTokens.BAND_DARK.toDouble().round2()))
        assertTrue(close(swiftNumber(swift, "bandFadeStart"), BrandTokens.BAND_FADE_START.toDouble().round2()))
        assertTrue(close(swiftNumber(swift, "bandCircleLight"), BrandTokens.BAND_CIRCLE_LIGHT.toDouble().round2()))
        assertTrue(close(swiftNumber(swift, "bandCircleDark"), BrandTokens.BAND_CIRCLE_DARK.toDouble().round2()))
        assertTrue(close(swiftNumber(swift, "bandFade") * 1000, BrandTokens.BAND_FADE_MS))
        val band = cssValues(css, "band-a")
        assertEquals("${pct(BrandTokens.BAND_LIGHT)}%", band.first())
        assertTrue(band.drop(1).all { it == "${pct(BrandTokens.BAND_DARK)}%" })
        val circles = cssValues(css, "band-circle")
        assertEquals("rgb(255 255 255 / ${BrandTokens.BAND_CIRCLE_LIGHT.toDouble().round2().trimmed()})", circles.first())
        assertTrue(circles.drop(1).all { it.contains("${pct(BrandTokens.BAND_CIRCLE_DARK)}%") })
        assertTrue(css.contains("transition: --band ${BrandTokens.BAND_FADE_MS}ms"))

        // §8.2 chat orbs and thread panel.
        assertTrue(close(swiftNumber(swift, "chatOrbLight"), BrandTokens.CHAT_ORB_LIGHT.toDouble().round2()))
        assertTrue(close(swiftNumber(swift, "chatOrbDark"), BrandTokens.CHAT_ORB_DARK.toDouble().round2()))
        assertTrue(close(swiftNumber(swift, "chatPanel"), BrandTokens.CHAT_PANEL.toDouble().round2()))
        val orbs = cssValues(css, "chat-orb-a").map { it.toDouble() }
        assertTrue(close(orbs.first(), BrandTokens.CHAT_ORB_LIGHT.toDouble().round2()))
        assertTrue(orbs.drop(1).all { close(it, BrandTokens.CHAT_ORB_DARK.toDouble().round2()) })

        // §8.3 glass.
        assertTrue(close(swiftNumber(swift, "glassLight"), BrandTokens.GLASS_LIGHT.toDouble().round2()))
        assertTrue(close(swiftNumber(swift, "glassDark"), BrandTokens.GLASS_DARK.toDouble().round2()))
        assertTrue(close(swiftNumber(swift, "glassEdgeLight"), BrandTokens.GLASS_EDGE_LIGHT.toDouble().round2()))
        assertTrue(close(swiftNumber(swift, "glassEdgeDark"), BrandTokens.GLASS_EDGE_DARK.toDouble().round2()))
        val glass = cssValues(css, "glass-a")
        assertEquals("${pct(BrandTokens.GLASS_LIGHT)}%", glass.first())
        assertTrue(glass.drop(1).all { it == "${pct(BrandTokens.GLASS_DARK)}%" })
        val edge = cssValues(css, "glass-edge")
        assertEquals("rgb(255 255 255 / ${BrandTokens.GLASS_EDGE_LIGHT.toDouble().round2().trimmed()})", edge.first())
        assertTrue(edge.drop(1).all { it == "rgb(255 255 255 / ${BrandTokens.GLASS_EDGE_DARK.toDouble().round2().trimmed()})" })

        // §8.4 mascot colours, cheer duration; §8.5 sticker edge.
        assertTrue(swift.uppercase().contains("MASCOTCHEEK = COLOR(HEX: 0X${hex(BrandTokens.mascotCheek)})"))
        assertTrue(swift.uppercase().contains("MASCOTTONGUE = COLOR(HEX: 0X${hex(BrandTokens.mascotTongue)})"))
        assertEquals("#${hex(BrandTokens.mascotCheek)}", cssValues(css, "mascot-cheek").single().uppercase())
        assertTrue(close(swiftNumber(swift, "cheerSeconds") * 1000, BrandTokens.CHEER_MS))
        assertEquals("rgb(255 255 255 / 0.95)", cssValues(css, "sticker-edge").single())

        // Hue fill / glow / deep / text / onFill on all three platforms.
        val cssUpper = css.uppercase()
        assertEquals("#${hex(InkOnColor)}", cssValues(css, "onfill-ink").first().uppercase())
        for (hue in Hue.bubblePalette) {
            val white = hue.onFill == androidx.compose.ui.graphics.Color.White
            val swiftHue = Regex("""static let ${hue.name} = Hue\((.*)\)""").find(swift)?.groupValues?.get(1)?.uppercase()
                ?: throw AssertionError("${hue.name} missing from Theme.swift")
            assertTrue(swiftHue, swiftHue.contains("FILL: 0X${hex(hue.fill)}") && swiftHue.contains("GLOW: 0X${hex(hue.glow)}") &&
                swiftHue.contains("DEEP: 0X${hex(hue.deep)}") && swiftHue.contains("WHITEONFILL: $white".uppercase()) &&
                swiftHue.contains("TEXTLIGHT: 0X${hex(hue.text(false))}") && swiftHue.contains("TEXTDARK: 0X${hex(hue.text(true))}"))
            val n = hue.name.uppercase()
            assertTrue("${hue.name} fill in globals.css", cssUpper.contains("--$n: #${hex(hue.fill)}"))
            assertTrue("${hue.name} glow in globals.css", cssUpper.contains("--$n-GLOW: #${hex(hue.glow)}"))
            assertTrue("${hue.name} deep in globals.css", cssUpper.contains("--$n-DEEP: #${hex(hue.deep)}"))
            val inks = cssValues(css, "${hue.name}-ink").map { it.uppercase() }
            assertEquals("${hue.name} text light in globals.css", "#${hex(hue.text(false))}", inks.first())
            assertTrue("${hue.name} text dark in globals.css", "#${hex(hue.text(true))}" in inks.drop(1))
            val rule = Regex("""\.hue-${hue.name} \{([^}]*)\}""").find(css)?.groupValues?.get(1)
                ?: throw AssertionError(".hue-${hue.name} missing from globals.css")
            assertTrue("${hue.name} onFill in globals.css", rule.contains(if (white) "--h-on: #fff" else "--h-on: var(--onfill-ink)"))
        }
    }

    private fun Double.round2() = Math.round(this * 100) / 100.0
    private fun Double.trimmed() = toBigDecimal().stripTrailingZeros().toPlainString()
    private fun pct(f: Float) = Math.round(f * 100)
}
