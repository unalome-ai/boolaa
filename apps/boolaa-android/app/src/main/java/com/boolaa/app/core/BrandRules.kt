package com.boolaa.app.core

import android.view.HapticFeedbackConstants
import com.boolaa.app.ui.theme.Hue

// The rules of the brand redesign (docs/design-system.md §8) as plain functions, so they are unit-tested: which hue
// owns a screen's band, when the dock shows its label, which face the mascot makes and which haptic each interaction
// plays. Same rules as iOS `BrandRules.swift` and the web's `src/lib/brand.ts`. Views read these; they don't re-derive them.

/** The screens that carry a feature band (§8.1). */
enum class BandScreen {
    HOME, EVENTS, FOOD, MARKETPLACE, LINKS, SETTINGS, CHAT;

    /** Feature colour = where you are; Chat is the bubble's own room, so its band takes the bubble's hue. */
    fun hue(bubble: Hue): Hue = when (this) {
        HOME -> Hue.grape
        EVENTS -> Hue.coral
        FOOD -> Hue.tangerine
        MARKETPLACE -> Hue.mint
        LINKS -> Hue.sky
        SETTINGS -> Hue.indigo
        CHAT -> bubble
    }
}

/** Dock geometry and the "does the label fit" rule (§8.3), in dp. */
object DockLayout {
    const val BAR_PADDING = 5f
    const val TAB_HEIGHT = 46f
    const val INACTIVE_SLOT = 40f
    const val CHAT_ORB = 60f
    const val GAP = 10f
    const val ICON = 20f
    const val ICON_GAP = 6f
    const val PILL_LEADING = 14f
    const val PILL_TRAILING = 16f
    const val TAB_COUNT = 5
    /** Android: icon-only at this font scale and above, whatever the width. */
    const val LARGE_FONT_SCALE = 1.5f

    /** Side margin of the dock row: 16, or 12 below 360 wide. */
    fun sideMargin(rowWidth: Float): Float = if (rowWidth < 360f) 12f else 16f

    /** The bar fills the row left of the chat orb. */
    fun barWidth(rowWidth: Float): Float = rowWidth - 2 * sideMargin(rowWidth) - CHAT_ORB - GAP

    /** Width of the active pill with its label. */
    fun labelledPillWidth(labelWidth: Float): Float = PILL_LEADING + ICON + ICON_GAP + labelWidth + PILL_TRAILING

    /**
     * The label shows when `2 × 5 + 4 × 40 + pill ≤ barWidth`, and never at font scale ≥ 1.5. Never truncated or shrunk:
     * otherwise the active tab is the icon-only circle and the name lives on as the content description.
     */
    fun showsLabel(labelWidth: Float, rowWidth: Float, fontScale: Float): Boolean {
        if (fontScale >= LARGE_FONT_SCALE || labelWidth <= 0f || rowWidth <= 0f) return false
        val needed = 2 * BAR_PADDING + (TAB_COUNT - 1) * INACTIVE_SLOT + labelledPillWidth(labelWidth)
        return needed <= barWidth(rowWidth)
    }

    /**
     * Slot widths left to right: the labelled active slot is as wide as its pill and the others share the rest;
     * icon-only, all slots share the inner width equally.
     */
    fun slotWidths(barWidth: Float, activeIndex: Int, activePillWidth: Float?): List<Float> {
        val inner = maxOf(0f, barWidth - 2 * BAR_PADDING)
        if (activePillWidth == null) return List(TAB_COUNT) { inner / TAB_COUNT }
        val others = maxOf(INACTIVE_SLOT, (inner - activePillWidth) / (TAB_COUNT - 1))
        return List(TAB_COUNT) { if (it == activeIndex) activePillWidth else others }
    }
}

/** The mascot's four faces (§8.4). */
enum class MascotExpression {
    CURIOUS, SLEEPY, CHEERING, WORRIED;

    /** Where it appears. */
    sealed interface Situation {
        data object Empty : Situation
        data object Success : Situation
        data class LoadError(val status: NetStatus) : Situation
    }

    companion object {
        /**
         * Every empty state is curious, a success is cheering, and the inline load error is sleepy while there is no
         * connection (offline or unreachable) and worried while online (the server answered with an error).
         */
        fun forSituation(situation: Situation): MascotExpression = when (situation) {
            Situation.Empty -> CURIOUS
            Situation.Success -> CHEERING
            is Situation.LoadError -> if (situation.status == NetStatus.ONLINE) WORRIED else SLEEPY
        }

        /** Face colour: the hue's onFill (white on grape and indigo, ink on the bright hues). */
        fun faceIsWhite(hue: Hue): Boolean = hue.onFill == androidx.compose.ui.graphics.Color.White

        /** The two companion orbs of a hue (§4.5), same pairs as iOS and the web. */
        fun companions(hue: Hue): Pair<Hue, Hue> = when (hue) {
            Hue.coral -> Hue.sunny to Hue.grape
            Hue.tangerine -> Hue.coral to Hue.mint
            Hue.mint -> Hue.sky to Hue.sunny
            Hue.sky -> Hue.mint to Hue.pink
            else -> Hue.coral to Hue.mint
        }

        /** Blink: closed (10 %) at 96 % of a 4.2 s loop, closing 94 → 96 %, opening 96 → 98 %. */
        fun eyeOpenness(seconds: Float): Float {
            val p = (seconds / 4.2f).let { it - kotlin.math.floor(it) }
            return when {
                p >= 0.94f && p < 0.96f -> 1f - 0.9f * (p - 0.94f) / 0.02f
                p >= 0.96f && p < 0.98f -> 0.1f + 0.9f * (p - 0.96f) / 0.02f
                else -> 1f
            }
        }
    }
}

/** Which hue the mascot wears (§8.4): the feature colour, the bubble colour on Home and in Chat, grape on Search and errors. */
enum class MascotPlace {
    HOME, CHAT, EVENTS, FOOD, MARKETPLACE, LINKS, SEARCH, LOAD_ERROR;

    fun hue(bubble: Hue): Hue = when (this) {
        HOME, CHAT -> bubble
        EVENTS -> Hue.coral
        FOOD -> Hue.tangerine
        MARKETPLACE -> Hue.mint
        LINKS -> Hue.sky
        SEARCH, LOAD_ERROR -> Hue.grape
    }
}

/**
 * One haptic vocabulary for every interaction (§8.3 table), played with `View.performHapticFeedback`. Haptics follow
 * the system "Touch feedback" setting and play under reduced motion too.
 */
enum class Interaction {
    TAB_SWITCH, BUBBLE_SWITCH, ADD, SUCCESS, SMALL_SUCCESS, DESTRUCTIVE_CONFIRM, ERROR, REFRESH_FINISHED,
    REACTION_ADDED, REACTION_REMOVED, SEND, RSVP_TAP, TOGGLE_ON, TOGGLE_OFF;

    /** The `HapticFeedbackConstants` value on [sdk], with the table's fallbacks for older releases. */
    fun hapticConstant(sdk: Int): Int = when (this) {
        TAB_SWITCH -> if (sdk >= 34) HapticFeedbackConstants.SEGMENT_TICK else HapticFeedbackConstants.CLOCK_TICK
        BUBBLE_SWITCH -> HapticFeedbackConstants.CONTEXT_CLICK
        ADD, SEND, RSVP_TAP, REACTION_ADDED -> HapticFeedbackConstants.VIRTUAL_KEY
        SUCCESS, SMALL_SUCCESS, REFRESH_FINISHED -> if (sdk >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY
        DESTRUCTIVE_CONFIRM -> HapticFeedbackConstants.LONG_PRESS
        ERROR -> if (sdk >= 30) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS
        REACTION_REMOVED -> HapticFeedbackConstants.CLOCK_TICK
        TOGGLE_ON -> if (sdk >= 34) HapticFeedbackConstants.TOGGLE_ON else HapticFeedbackConstants.CLOCK_TICK
        TOGGLE_OFF -> if (sdk >= 34) HapticFeedbackConstants.TOGGLE_OFF else HapticFeedbackConstants.CLOCK_TICK
    }

    companion object {
        fun toggle(on: Boolean) = if (on) TOGGLE_ON else TOGGLE_OFF
    }
}

/** Sticker "kind" labels on the Home feed (§8.5): fixed tilt per kind, upright at font scale ≥ 1.5. */
enum class StickerKind(val tilt: Float) {
    CHAT(-3f), EVENT(2f), FOOD(-2f), MARKET(3f), LINK(-2f);

    fun tilt(fontScale: Float): Float = if (fontScale >= DockLayout.LARGE_FONT_SCALE) 0f else tilt

    val hue: Hue
        get() = when (this) {
            CHAT -> Hue.grape
            EVENT -> Hue.coral
            FOOD -> Hue.tangerine
            MARKET -> Hue.mint
            LINK -> Hue.sky
        }
}

/** Success moments with the cheering mascot (§8.4). "First" = you had none in this bubble before the save. */
enum class Cheer(val hue: Hue?) {
    GOING(Hue.mint), FIRST_EVENT(Hue.coral), FIRST_POST(Hue.tangerine), FIRST_ITEM(Hue.mint),
    /** "You're in", in the bubble's own colour. */
    JOINED(null);

    companion object {
        fun fromDebug(name: String?): Cheer? = when (name) {
            "going" -> GOING
            "firstEvent" -> FIRST_EVENT
            "firstPost" -> FIRST_POST
            "firstItem" -> FIRST_ITEM
            "joined" -> JOINED
            else -> null
        }
    }
}
