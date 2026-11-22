package com.boolaa.app.ui.market

import com.boolaa.app.model.MarketAvailability
import com.boolaa.app.model.MarketItem
import com.boolaa.app.model.MarketStatus

enum class MarketFilter { ALL, FREE, TRADE;
    fun matches(item: MarketItem) = when (this) {
        ALL -> true
        FREE -> item.status == MarketStatus.FREE
        TRADE -> item.status == MarketStatus.TRADE
    }
}

/** Pure marketplace rules (unit-tested; same as web and iOS, docs/boolaa-spec.md "Marketplace"). */
object MarketRules {
    /** Taken items sink to the bottom; otherwise newest first (ties by id, so the order is stable). */
    val order: Comparator<MarketItem> =
        compareBy<MarketItem> { it.availability == MarketAvailability.TAKEN }
            .thenByDescending { it.createdAt }
            .thenBy { it.id }

    /** What the grid shows: the Free/Trade filter, optionally without taken items, and never blocked owners (RLS). */
    fun visible(items: List<MarketItem>, filter: MarketFilter, hideTaken: Boolean): List<MarketItem> =
        items.filter { filter.matches(it) && !(hideTaken && it.availability == MarketAvailability.TAKEN) }

    /** "Ask in chat": only on someone else's item that can still be had. */
    fun canAskOwner(item: MarketItem, me: String?): Boolean =
        me != null && item.ownerId != me && item.availability != MarketAvailability.TAKEN
}
