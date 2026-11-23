package com.boolaa.app.core

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlin.math.pow
import kotlin.random.Random

/** What the app knows about its connection (docs/boolaa-spec.md "Offline and poor network"). */
enum class NetStatus {
    ONLINE,
    /** The OS reports no network. */
    OFFLINE,
    /** The OS reports a network, but requests to Supabase fail with network errors or time out. */
    UNREACHABLE,
}

/** Inputs of the connectivity state machine. */
sealed interface NetEvent {
    data class PathChanged(val available: Boolean) : NetEvent
    data object RequestSucceeded : NetEvent
    /** [network]: a network error or timeout (not an RLS / HTTP error with a body). */
    data class RequestFailed(val network: Boolean) : NetEvent
}

/** Pure state machine, shared rules with web and iOS. [reconnected]: refetch and resubscribe now. */
object ConnectivityRules {
    data class Transition(val status: NetStatus, val reconnected: Boolean)

    fun next(status: NetStatus, event: NetEvent): Transition = when (event) {
        is NetEvent.PathChanged ->
            if (!event.available) Transition(NetStatus.OFFLINE, false)
            else if (status == NetStatus.OFFLINE) Transition(NetStatus.ONLINE, true)
            else Transition(status, false)
        NetEvent.RequestSucceeded ->
            if (status == NetStatus.UNREACHABLE) Transition(NetStatus.ONLINE, true) else Transition(status, false)
        is NetEvent.RequestFailed ->
            if (event.network && status == NetStatus.ONLINE) Transition(NetStatus.UNREACHABLE, false) else Transition(status, false)
    }

    /** "Back online" is shown when the status goes from offline / unreachable to online. */
    fun showsBackOnline(from: NetStatus, to: NetStatus) = from != NetStatus.ONLINE && to == NetStatus.ONLINE
}

/** Retry delays: 1, 2, 4, 8, 16, 30, 30 … seconds, times a jitter factor in [0.8, 1.2]. */
object Backoff {
    const val MAX_SECONDS = 30.0
    /** Automatic retries of a failed screen load while online (the Retry button and reconnects always retry). */
    const val MAX_AUTO_ATTEMPTS = 5

    fun delayMs(attempt: Int, jitter: Double = 1.0): Long {
        val base = minOf(MAX_SECONDS, 2.0.pow(attempt.coerceIn(0, 10)))
        return (base * jitter.coerceIn(0.8, 1.2) * 1000).toLong()
    }

    fun randomJitter(random: Random = Random.Default): Double = 0.8 + random.nextDouble() * 0.4
}

/**
 * Connectivity for the whole app: the OS default network ([start]), what requests report through the OkHttp
 * interceptor ([report]), a health probe with backoff while [NetStatus.UNREACHABLE], and [refresh], a generation
 * counter screens collect to refetch and resubscribe (bumped on reconnect and when the app comes back to the front).
 */
class ConnectivityMonitor(
    private val scope: CoroutineScope,
    /** True when Supabase answers at all (any HTTP response). */
    private val probe: suspend () -> Boolean,
) {
    private val _status = MutableStateFlow(NetStatus.ONLINE)
    val status: StateFlow<NetStatus> = _status.asStateFlow()
    private val _backOnline = MutableStateFlow(false)
    /** True for 2.5 s after the connection came back. */
    val backOnline: StateFlow<Boolean> = _backOnline.asStateFlow()
    private val _refresh = MutableStateFlow(0)
    val refresh: StateFlow<Int> = _refresh.asStateFlow()

    @Volatile private var pathAvailable = true
    @Volatile var simulatedOffline = false
        private set
    private var probeJob: Job? = null
    private var backOnlineJob: Job? = null
    private val lock = Any()

    val isOnline: Boolean get() = _status.value == NetStatus.ONLINE

    fun start(context: Context) {
        val cm = context.getSystemService(ConnectivityManager::class.java) ?: return
        val caps = cm.activeNetwork?.let { cm.getNetworkCapabilities(it) }
        pathAvailable = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
        handle(NetEvent.PathChanged(pathAvailable && !simulatedOffline))
        runCatching {
            cm.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
                override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
                    setPath(capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET))
                }
                override fun onLost(network: Network) = setPath(false)
                override fun onUnavailable() = setPath(false)
            })
        }.onFailure { Log.w("Boolaa", "network callback failed", it) }
    }

    private fun setPath(available: Boolean) {
        if (available == pathAvailable) return
        pathAvailable = available
        handle(NetEvent.PathChanged(available && !simulatedOffline))
    }

    /** DEBUG / tests: pretend there is no network (requests fail fast in the OkHttp interceptor). */
    fun setSimulatedOffline(on: Boolean) {
        simulatedOffline = on
        handle(NetEvent.PathChanged(pathAvailable && !on))
    }

    /** From the OkHttp interceptor: [ok] = any HTTP response, false = a network error or timeout. */
    fun report(ok: Boolean) = handle(if (ok) NetEvent.RequestSucceeded else NetEvent.RequestFailed(network = true))

    /** The app came back to the front: visible screens refetch and live screens resubscribe. */
    fun foreground() { _refresh.update { it + 1 } }

    fun handle(event: NetEvent) {
        val (from, transition) = synchronized(lock) {
            val from = _status.value
            val t = ConnectivityRules.next(from, event)
            _status.value = t.status
            from to t
        }
        if (transition.status == from && !transition.reconnected) return
        if (ConnectivityRules.showsBackOnline(from, transition.status)) flashBackOnline()
        if (transition.status != NetStatus.ONLINE) _backOnline.value = false
        if (transition.reconnected) _refresh.update { it + 1 }
        if (transition.status == NetStatus.UNREACHABLE) startProbe() else stopProbe()
    }

    private fun flashBackOnline() {
        backOnlineJob?.cancel()
        _backOnline.value = true
        backOnlineJob = scope.launch { delay(2_500); _backOnline.value = false }
    }

    private fun startProbe() {
        if (probeJob?.isActive == true) return
        probeJob = scope.launch {
            var attempt = 0
            while (isActive && _status.value == NetStatus.UNREACHABLE) {
                delay(Backoff.delayMs(attempt++, Backoff.randomJitter()))
                if (_status.value != NetStatus.UNREACHABLE) break
                // The interceptor reports the probe's outcome; a response also moves the status here.
                if (runCatching { probe() }.getOrDefault(false)) handle(NetEvent.RequestSucceeded)
            }
        }
    }

    private fun stopProbe() {
        probeJob?.cancel()
        probeJob = null
    }
}
