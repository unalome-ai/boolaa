package com.boolaa.app

import com.boolaa.app.ui.theme.Hue
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
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
}
