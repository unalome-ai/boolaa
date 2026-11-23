package com.boolaa.app

import androidx.compose.ui.graphics.toArgb
import com.boolaa.app.ui.theme.Brand
import com.boolaa.app.ui.theme.DarkColors
import com.boolaa.app.ui.theme.Glow
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
        // Header glow strengths and radii.
        assertTrue(ios.contains("MAINLIGHT = ${Glow.MAIN_LIGHT}") && ios.contains("SIDELIGHT = ${Glow.SIDE_LIGHT}"))
        assertTrue(web.contains("--GLOW-A: ${(Glow.MAIN_LIGHT * 100).toInt()}%; --GLOW-B: ${(Glow.SIDE_LIGHT * 100).toInt()}%"))
        assertTrue(web.contains("--RADIUS-SMALL: ${Radius.small.value.toInt()}PX") && web.contains("--RADIUS-CARD: ${Radius.card.value.toInt()}PX"))
    }
}
