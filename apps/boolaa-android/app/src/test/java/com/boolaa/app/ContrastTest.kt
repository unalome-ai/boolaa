package com.boolaa.app

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import com.boolaa.app.ui.theme.BoolaaColors
import com.boolaa.app.ui.theme.Brand
import com.boolaa.app.ui.theme.DarkColors
import com.boolaa.app.ui.theme.Hue
import com.boolaa.app.ui.theme.LightColors
import org.junit.Assert.assertTrue
import org.junit.Test

/** WCAG 2.2 AA for the token pairs the screens use (docs/design-system.md §2.5): text 4.5:1, UI parts 3:1. */
class ContrastTest {
    private fun ratio(fg: Color, bg: Color): Double {
        val a = fg.compositeOver(bg).luminance() + 0.05
        val b = bg.luminance() + 0.05
        return maxOf(a, b) / minOf(a, b)
    }

    private fun check(name: String, fg: Color, bg: Color, min: Double) {
        val r = ratio(fg, bg)
        assertTrue("$name: %.2f < $min".format(r), r >= min)
    }

    private fun both(block: (BoolaaColors) -> Unit) { block(LightColors); block(DarkColors) }

    @Test fun body_and_secondary_text_on_every_surface() = both { c ->
        val mode = if (c.isDark) "dark" else "light"
        for ((s, bg) in listOf("background" to c.background, "card" to c.card, "field" to c.field)) {
            check("$mode textPrimary on $s", c.textPrimary, bg, 4.5)
            check("$mode textSecondary on $s", c.textSecondary, bg, 4.5)
            check("$mode dangerText on $s", c.dangerText, bg, 4.5)
        }
    }

    @Test fun hue_text_on_surfaces_and_on_its_own_wash() = both { c ->
        for (hue in Hue.bubblePalette) {
            val text = hue.text(c.isDark)
            check("${hue.name} text on card", text, c.card, 4.5)
            check("${hue.name} text on background", text, c.background, 4.5)
            check("${hue.name} text on its wash", text, hue.wash(c.isDark).compositeOver(c.card), 4.5)
        }
    }

    @Test fun on_fill_content_over_the_whole_gradient() {
        for (hue in Hue.bubblePalette) {
            check("${hue.name} onFill on gradient top", hue.onFill, hue.gradientTop, 4.5)
            check("${hue.name} onFill on gradient bottom", hue.onFill, hue.gradientBottom, 4.5)
        }
        check("white on danger fill", Color.White, Brand.danger, 4.5)
    }

    @Test fun danger_text_on_its_soft_destructive_wash() = both { c ->
        val wash = c.dangerText.copy(alpha = if (c.isDark) 0.16f else 0.10f).compositeOver(c.background)
        check("danger on soft destructive (${if (c.isDark) "dark" else "light"})", c.dangerText, wash, 4.5)
        check("danger on blocked badge", c.dangerText, c.dangerText.copy(alpha = 0.14f).compositeOver(c.card), 4.5)
    }

    @Test fun focus_ring_and_selection_fills_are_visible_ui_parts() = both { c ->
        check("grape focus ring on field", Hue.grape.fill, c.field, 3.0)
        check("grape focus ring on card", Hue.grape.fill, c.card, 3.0)
    }
}
