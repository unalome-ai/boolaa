package com.boolaa.app.ui

import androidx.lifecycle.viewModelScope
import com.boolaa.app.AppContainer
import com.boolaa.app.core.RequestRules
import com.boolaa.app.core.RequestStore
import com.boolaa.app.core.handOverItem
import com.boolaa.app.core.pickItemRequest
import com.boolaa.app.core.requestItem
import com.boolaa.app.core.unpickItem
import com.boolaa.app.core.withdrawItemRequest
import com.boolaa.app.model.ItemKind
import com.boolaa.app.model.ItemRequest
import com.boolaa.app.model.MarketAvailability
import com.boolaa.app.model.RequestStatus
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * The "I want it" actions shared by Food and Marketplace (docs/boolaa-spec.md "Requests and picking"). Changes show at
 * once (request rows and the item's availability / count); on an error they are rolled back by reloading, and after
 * `itemGone` / `itemNotAvailable` / `requestGone` the list is reloaded as the spec asks. No offline queue: like every
 * other write, an offline failure shows the translated error. A failed row (e.g. `requestGone`) disappears with the reload.
 */
abstract class RequestsViewModel(
    protected val container: AppContainer, protected val bubbleId: String, private val kind: ItemKind,
) : BaseViewModel() {
    val requests = RequestStore(container.api, bubbleId, kind)

    private val _working = MutableStateFlow<String?>(null)
    /** The item (or request) id an action is running for: its buttons show progress and ignore taps. */
    val working: StateFlow<String?> = _working.asStateFlow()

    /** Applies a local change to the item row: new availability (or null) and a request-count delta. */
    protected abstract fun applyItem(itemId: String, availability: MarketAvailability?, countDelta: Int)

    /** Reloads the list and the requests (rollback and the spec's "reload the list"). */
    protected abstract fun reloadAll()

    protected suspend fun loadRequests() = requests.load()

    private fun run(key: String, onSuccess: () -> Unit = {}, block: suspend () -> Unit) {
        if (_working.value == key) return
        viewModelScope.launch {
            _working.value = key
            try {
                block()
                onSuccess()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                report(e)
                reloadAll()
            } finally {
                if (_working.value == key) _working.value = null
            }
        }
    }

    fun request(itemId: String, ownerId: String, note: String?, onSent: () -> Unit) {
        val me = container.session.state.value.userId ?: return
        val placeholder = RequestStore.optimistic(kind, bubbleId, ownerId, itemId, me, note)
        requests.update { RequestRules.upsert(it, placeholder) }
        applyItem(itemId, null, +1)
        run(itemId, onSent) {
            val row = container.api.requestItem(kind, itemId, note)
            requests.update { RequestRules.upsert(RequestRules.remove(it, placeholder.id), row) }
        }
    }

    fun withdraw(request: ItemRequest) {
        requests.update { RequestRules.remove(it, request.id) }
        applyItem(request.itemId, MarketAvailability.AVAILABLE.takeIf { request.status == RequestStatus.PICKED }, -1)
        run(request.itemId) { container.api.withdrawItemRequest(request.id) }
    }

    fun pick(request: ItemRequest, onPicked: () -> Unit) {
        requests.update { RequestRules.applyPick(it, request) }
        applyItem(request.itemId, MarketAvailability.RESERVED, 0)
        run(request.itemId, onPicked) {
            val row = container.api.pickItemRequest(request.id)
            requests.update { RequestRules.upsert(it, row) }
        }
    }

    fun unpick(itemId: String) {
        requests.update { RequestRules.applyAvailability(it, itemId, MarketAvailability.AVAILABLE) }
        applyItem(itemId, MarketAvailability.AVAILABLE, 0)
        run(itemId) { container.api.unpickItem(kind, itemId) }
    }

    fun handOver(itemId: String, onDone: () -> Unit = {}) {
        requests.update { RequestRules.applyAvailability(it, itemId, MarketAvailability.TAKEN) }
        applyItem(itemId, MarketAvailability.TAKEN, 0)
        run(itemId, onDone) { container.api.handOverItem(kind, itemId) }
    }
}
