package com.boolaa.app

import android.view.HapticFeedbackConstants
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import com.boolaa.app.core.BandScreen
import com.boolaa.app.core.Cheer
import com.boolaa.app.core.DockLayout
import com.boolaa.app.core.Interaction
import com.boolaa.app.core.MascotExpression
import com.boolaa.app.core.MascotExpression.Situation
import com.boolaa.app.core.MascotPlace
import com.boolaa.app.core.NetStatus
import com.boolaa.app.core.StickerKind
import com.boolaa.app.model.BubbleMember
import com.boolaa.app.model.JoinRequest
import com.boolaa.app.state.SessionStore
import com.boolaa.app.ui.theme.BoolaaColors
import com.boolaa.app.ui.theme.BrandTokens
import com.boolaa.app.ui.theme.DarkColors
import com.boolaa.app.ui.theme.Hue
import com.boolaa.app.ui.theme.InkOnColor
import com.boolaa.app.ui.theme.LightColors
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/** The rules of the brand redesign (docs/design-system.md §8), same cases as iOS `BrandTests` and the web's brand.spec. */
class BrandRulesTest {
    // MARK: Contrast of the new pairs (§8.6)

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
    private fun mode(c: BoolaaColors) = if (c.isDark) "dark" else "light"

    /** The band where it is strongest (top 45 %), with and without a decoration circle over it. */
    private fun bandSurfaces(hue: Hue, c: BoolaaColors): List<Color> {
        val band = BrandTokens.bandTint(hue, c.isDark).compositeOver(c.background)
        val circle = if (c.isDark) c.background.copy(alpha = BrandTokens.BAND_CIRCLE_DARK) else Color.White.copy(alpha = BrandTokens.BAND_CIRCLE_LIGHT)
        return listOf(band, circle.compositeOver(band))
    }

    @Test fun title_and_secondary_text_on_every_feature_band() = both { c ->
        for (hue in Hue.bubblePalette) for (bg in bandSurfaces(hue, c)) {
            check("${mode(c)} ink on ${hue.name} band", c.textPrimary, bg, 4.5)
            check("${mode(c)} inkSecondary on ${hue.name} band", c.textSecondary, bg, 4.5)
        }
    }

    @Test fun home_title_gradient_stops_are_large_text_on_the_grape_band() = both { c ->
        for ((_, stop) in BrandTokens.titleGradientStops(c.isDark)) for (bg in bandSurfaces(Hue.grape, c)) {
            check("${mode(c)} title stop on Home band", stop, bg, 3.0)
        }
    }

    @Test fun own_message_sticker_and_dock_pill_on_fill_over_the_gradient() {
        for (hue in Hue.bubblePalette) {
            check("${hue.name} onFill on top", hue.onFill, hue.gradientTop, 4.5)
            check("${hue.name} onFill on bottom", hue.onFill, hue.gradientBottom, 4.5)
        }
    }

    @Test fun others_messages_ink_and_links_on_the_sender_wash() = both { c ->
        for (hue in Hue.bubblePalette) {
            val wash = hue.wash(c.isDark).compositeOver(c.card)
            check("${mode(c)} ink on ${hue.name} message", c.textPrimary, wash, 4.5)
            check("${mode(c)} ${hue.name} link on its message", hue.text(c.isDark), wash, 4.5)
        }
    }

    @Test fun sender_names_and_notes_over_the_chat_orbs() = both { c ->
        val panel = c.card.copy(alpha = BrandTokens.CHAT_PANEL).compositeOver(c.background)
        val strength = if (c.isDark) BrandTokens.CHAT_ORB_DARK else BrandTokens.CHAT_ORB_LIGHT
        for (orb in Hue.bubblePalette) {
            val bg = orb.deep.copy(alpha = strength).compositeOver(panel)
            for (sender in Hue.bubblePalette) check("${mode(c)} ${sender.name} name over ${orb.name} orb", sender.text(c.isDark), bg, 4.5)
            check("${mode(c)} inkSecondary over ${orb.name} orb", c.textSecondary, bg, 4.5)
            check("${mode(c)} dangerText over ${orb.name} orb", c.dangerText, bg, 4.5)
        }
    }

    @Test fun inactive_dock_icons_on_the_glass_over_any_content() = both { c ->
        val glass = listOf(if (c.isDark) BrandTokens.GLASS_DARK else BrandTokens.GLASS_LIGHT, BrandTokens.GLASS_NO_BLUR)
        for (strength in glass) for (under in listOf(Color.Black, Color.White)) {
            check("${mode(c)} inactive icon on glass $strength over $under", c.textSecondary, c.card.copy(alpha = strength).compositeOver(under), 3.0)
        }
    }

    @Test fun cheer_toast_and_empty_state_text() = both { c ->
        check("${mode(c)} ink on cheer toast", c.textPrimary, c.card, 4.5)
        for (hue in Hue.bubblePalette) {
            // Empty states: the hue's wash at 60 % over the background.
            val bg = hue.wash(c.isDark).let { it.copy(alpha = it.alpha * 0.6f) }.compositeOver(c.background)
            check("${mode(c)} inkSecondary on ${hue.name} empty state", c.textSecondary, bg, 4.5)
        }
    }

    // MARK: Colour roles (§8.1)

    @Test fun every_screen_band_has_its_feature_colour_and_chat_takes_the_bubble() {
        val bubble = Hue.pink
        assertSame(Hue.grape, BandScreen.HOME.hue(bubble))
        assertSame(Hue.coral, BandScreen.EVENTS.hue(bubble))
        assertSame(Hue.tangerine, BandScreen.FOOD.hue(bubble))
        assertSame(Hue.mint, BandScreen.MARKETPLACE.hue(bubble))
        assertSame(Hue.sky, BandScreen.LINKS.hue(bubble))
        assertSame(Hue.indigo, BandScreen.SETTINGS.hue(bubble))
        assertSame(bubble, BandScreen.CHAT.hue(bubble))
    }

    // MARK: Dock (§8.3)

    @Test fun dock_label_shows_only_when_the_pill_fits_the_bar() {
        // 390 wide: bar 288, so the label may be up to 288 − (10 + 160 + 56) = 62 wide.
        assertEquals(288f, DockLayout.barWidth(390f), 0.001f)
        assertTrue(DockLayout.showsLabel(62f, 390f, 1f))
        assertFalse(DockLayout.showsLabel(62.5f, 390f, 1f))
        // 412 (Pixel): 66 fits.
        assertTrue(DockLayout.showsLabel(66f, 412f, 1f))
        // 320 wide: 12 margins, every tab is icon-only.
        assertEquals(12f, DockLayout.sideMargin(320f))
        assertFalse(DockLayout.showsLabel(20f, 320f, 1f))
    }

    @Test fun dock_is_icon_only_at_large_font_scale_and_never_without_a_label() {
        assertTrue(DockLayout.showsLabel(40f, 412f, 1.3f))
        assertFalse(DockLayout.showsLabel(40f, 412f, 1.5f))
        assertFalse(DockLayout.showsLabel(40f, 412f, 2f))
        assertFalse(DockLayout.showsLabel(0f, 412f, 1f))
        assertFalse(DockLayout.showsLabel(40f, 0f, 1f))
    }

    @Test fun dock_slots_share_the_bar() {
        val pill = DockLayout.labelledPillWidth(50f)
        assertEquals(106f, pill, 0.001f)
        val slots = DockLayout.slotWidths(300f, 2, pill)
        assertEquals(pill, slots[2], 0.001f)
        assertEquals(290f, slots.sum(), 0.001f)
        assertTrue(slots.all { it >= DockLayout.INACTIVE_SLOT })
        val even = DockLayout.slotWidths(300f, 0, null)
        assertEquals(List(5) { 58f }, even)
    }

    // MARK: Mascot (§8.4)

    @Test fun mascot_expression_follows_the_situation() {
        assertEquals(MascotExpression.CURIOUS, MascotExpression.forSituation(Situation.Empty))
        assertEquals(MascotExpression.CHEERING, MascotExpression.forSituation(Situation.Success))
        assertEquals(MascotExpression.WORRIED, MascotExpression.forSituation(Situation.LoadError(NetStatus.ONLINE)))
        assertEquals(MascotExpression.SLEEPY, MascotExpression.forSituation(Situation.LoadError(NetStatus.OFFLINE)))
        assertEquals(MascotExpression.SLEEPY, MascotExpression.forSituation(Situation.LoadError(NetStatus.UNREACHABLE)))
    }

    @Test fun mascot_hue_face_colour_and_companions() {
        val bubble = Hue.sky
        assertSame(bubble, MascotPlace.HOME.hue(bubble))
        assertSame(bubble, MascotPlace.CHAT.hue(bubble))
        assertSame(Hue.coral, MascotPlace.EVENTS.hue(bubble))
        assertSame(Hue.tangerine, MascotPlace.FOOD.hue(bubble))
        assertSame(Hue.mint, MascotPlace.MARKETPLACE.hue(bubble))
        assertSame(Hue.sky, MascotPlace.LINKS.hue(bubble))
        assertSame(Hue.grape, MascotPlace.SEARCH.hue(bubble))
        assertSame(Hue.grape, MascotPlace.LOAD_ERROR.hue(bubble))
        assertEquals(setOf("grape", "indigo"), Hue.bubblePalette.filter { MascotExpression.faceIsWhite(it) }.map { it.name }.toSet())
        assertEquals(Hue.sunny to Hue.grape, MascotExpression.companions(Hue.coral))
        assertEquals(Hue.coral to Hue.mint, MascotExpression.companions(Hue.grape))
        assertEquals(InkOnColor, Hue.mint.onFill)
    }

    @Test fun blink_closes_at_96_percent_of_the_loop() {
        assertEquals(1f, MascotExpression.eyeOpenness(0f), 0.001f)
        assertEquals(0.1f, MascotExpression.eyeOpenness(4.2f * 0.96f), 0.01f)
        assertEquals(1f, MascotExpression.eyeOpenness(4.2f * 0.99f), 0.001f)
        assertTrue(MascotExpression.eyeOpenness(4.2f * 0.95f) in 0.1f..1f)
    }

    @Test fun admitted_bubble_is_a_pending_request_that_became_a_membership() {
        val req = JoinRequest("r1", "me", "b2")
        val old = listOf(BubbleMember("me", "b1", approved = true))
        val now = old + BubbleMember("me", "b2", approved = true)
        assertEquals("b2", SessionStore.admittedBubble(listOf(req), old, now))
        assertNull("first load never cheers", SessionStore.admittedBubble(listOf(req), null, now))
        assertNull("a bubble you created is not an admission", SessionStore.admittedBubble(emptyList(), old, now))
        assertNull("still pending", SessionStore.admittedBubble(listOf(req), old, old))
    }

    @Test fun cheers_have_their_colours_and_debug_names() {
        assertSame(Hue.mint, Cheer.GOING.hue)
        assertSame(Hue.coral, Cheer.FIRST_EVENT.hue)
        assertSame(Hue.tangerine, Cheer.FIRST_POST.hue)
        assertSame(Hue.mint, Cheer.FIRST_ITEM.hue)
        assertNull("joined wears the bubble's colour", Cheer.JOINED.hue)
        assertEquals(Cheer.JOINED, Cheer.fromDebug("joined"))
        assertNull(Cheer.fromDebug("nope"))
    }

    // MARK: Haptics (§8.3 table)

    @Test fun haptics_follow_the_table_with_fallbacks() {
        val h = HapticFeedbackConstants::class.java
        fun c(name: String) = h.getField(name).getInt(null)
        assertEquals(c("SEGMENT_TICK"), Interaction.TAB_SWITCH.hapticConstant(34))
        assertEquals(c("CLOCK_TICK"), Interaction.TAB_SWITCH.hapticConstant(33))
        assertEquals(c("CONTEXT_CLICK"), Interaction.BUBBLE_SWITCH.hapticConstant(34))
        for (i in listOf(Interaction.ADD, Interaction.SEND, Interaction.RSVP_TAP, Interaction.REACTION_ADDED)) {
            assertEquals(i.name, c("VIRTUAL_KEY"), i.hapticConstant(34))
        }
        for (i in listOf(Interaction.SUCCESS, Interaction.SMALL_SUCCESS, Interaction.REFRESH_FINISHED)) {
            assertEquals(i.name, c("CONFIRM"), i.hapticConstant(30))
            assertEquals(i.name, c("VIRTUAL_KEY"), i.hapticConstant(29))
        }
        assertEquals(c("LONG_PRESS"), Interaction.DESTRUCTIVE_CONFIRM.hapticConstant(36))
        assertEquals(c("REJECT"), Interaction.ERROR.hapticConstant(30))
        assertEquals(c("LONG_PRESS"), Interaction.ERROR.hapticConstant(29))
        assertEquals(c("CLOCK_TICK"), Interaction.REACTION_REMOVED.hapticConstant(36))
        assertEquals(c("TOGGLE_ON"), Interaction.toggle(true).hapticConstant(34))
        assertEquals(c("TOGGLE_OFF"), Interaction.toggle(false).hapticConstant(34))
        assertEquals(c("CLOCK_TICK"), Interaction.toggle(true).hapticConstant(33))
    }

    // MARK: Stickers (§8.5)

    @Test fun stickers_tilt_per_kind_and_stand_straight_at_large_text() {
        assertEquals(listOf(-3f, 2f, -2f, 3f, -2f), StickerKind.entries.map { it.tilt(1f) })
        assertTrue(StickerKind.entries.all { it.tilt(1.5f) == 0f && it.tilt(2f) == 0f })
        assertSame(Hue.coral, StickerKind.EVENT.hue)
        assertSame(Hue.sky, StickerKind.LINK.hue)
    }
}
