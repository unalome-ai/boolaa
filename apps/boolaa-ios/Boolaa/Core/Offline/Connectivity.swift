import Foundation
import Network
import Observation

/// Offline and poor network (docs/boolaa-spec.md, "Offline and poor network"): same rules on web and Android.
enum NetworkStatus: String, Sendable, Equatable {
    /// The OS has a path and Supabase answers.
    case online
    /// The OS says there is no network (NWPathMonitor `.unsatisfied`).
    case offline
    /// The OS says online, but a request to Supabase failed with a network error or timed out.
    case unreachable
}

/// Pure connectivity state machine (unit-tested). Each input returns true when it means "back online":
/// screens then refetch, resubscribe and the chat outbox flushes.
struct ConnectivityState: Sendable, Equatable {
    private(set) var status: NetworkStatus = .online

    mutating func pathChanged(available: Bool) -> Bool {
        if !available { status = .offline; return false }
        guard status == .offline else { return false }
        status = .online // optimistic: the next request tells whether Supabase answers
        return true
    }

    mutating func requestSucceeded() -> Bool {
        guard status == .unreachable else { return false } // offline: the path decides
        status = .online
        return true
    }

    /// Non-network failures (RLS, HTTP errors with a body) say nothing about reachability.
    mutating func requestFailed(isNetworkError: Bool) {
        if isNetworkError, status == .online { status = .unreachable }
    }
}

/// Exponential backoff with jitter: 1, 2, 4, 8, 16, 30, 30 … seconds, each times a factor in [0.8, 1.2].
enum Backoff {
    static let base: Double = 1
    static let cap: Double = 30

    /// `jitter` is the factor (1.0 gives the exact sequence); `randomJitter()` in the app.
    static func delay(attempt: Int, jitter: Double = 1.0) -> Double {
        let exponent = min(max(attempt, 0), 10)
        let raw = min(cap, base * pow(2, Double(exponent)))
        return raw * min(1.2, max(0.8, jitter))
    }

    static func randomJitter() -> Double { Double.random(in: 0.8...1.2) }
}

/// The app's view of the network: OS path (NWPathMonitor) plus what requests to Supabase report.
/// `refreshGeneration` changes when the app is back online or back in the foreground: every visible
/// screen keys its load-and-subscribe task on it, so it refetches and resubscribes once.
@MainActor
@Observable
final class Connectivity {
    static let shared = Connectivity()

    private(set) var state = ConnectivityState()
    var status: NetworkStatus { state.status }
    /// "Back online" pill, shown for 2.5 s after offline/unreachable → online.
    private(set) var showBackOnline = false
    private(set) var refreshGeneration = 0

    private var monitor: NWPathMonitor?
    private var probeTask: Task<Void, Never>?
    private var backOnlineTask: Task<Void, Never>?
    private var wentToBackground = false
    /// DEBUG/UI tests: pretend there is no network (`-UITestSimulateOffline YES`).
    private(set) var simulatedOffline = false
    private var lastRealPathAvailable = true

    init() {}

    func start() {
        guard monitor == nil else { return }
        #if DEBUG
        if DebugHooks.simulateOffline { setSimulatedOffline(true) }
        #endif
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { path in
            let available = path.status == .satisfied
            Task { @MainActor in Connectivity.shared.pathChanged(available: available) }
        }
        monitor.start(queue: DispatchQueue(label: "boolaa.connectivity"))
        self.monitor = monitor
    }

    func pathChanged(available: Bool) {
        lastRealPathAvailable = available
        apply { $0.pathChanged(available: available && !simulatedOffline) }
    }

    /// A request to Supabase answered (any status with a body).
    func reportSuccess() {
        apply { $0.requestSucceeded() }
    }

    /// A request failed: only network errors and timeouts mark Supabase unreachable.
    func report(_ error: any Error) {
        let network = Self.isNetworkError(error)
        let before = state.status
        state.requestFailed(isNetworkError: network)
        if before != state.status { statusChanged(reconnected: false) }
    }

    func appDidEnterBackground() { wentToBackground = true }

    /// Back in the foreground: realtime may have missed changes, so visible screens refetch once.
    func appBecameActive() {
        guard wentToBackground else { return }
        wentToBackground = false
        refreshGeneration += 1
    }

    /// DEBUG only: the UI tests' network switch.
    func setSimulatedOffline(_ on: Bool) {
        simulatedOffline = on
        SimulatedOffline.isOn = on
        apply { $0.pathChanged(available: lastRealPathAvailable && !on) }
    }

    nonisolated static func isNetworkError(_ error: any Error) -> Bool {
        if let url = error as? URLError { return url.code != .cancelled }
        let ns = error as NSError
        if ns.domain == NSURLErrorDomain { return ns.code != NSURLErrorCancelled }
        if let underlying = ns.userInfo[NSUnderlyingErrorKey] as? NSError, underlying.domain == NSURLErrorDomain {
            return underlying.code != NSURLErrorCancelled
        }
        return false
    }

    private func apply(_ change: (inout ConnectivityState) -> Bool) {
        let before = state.status
        let reconnected = change(&state)
        if before != state.status || reconnected { statusChanged(reconnected: reconnected) }
    }

    private func statusChanged(reconnected: Bool) {
        if reconnected {
            refreshGeneration += 1
            showBackOnline = true
            backOnlineTask?.cancel()
            backOnlineTask = Task {
                try? await Task.sleep(for: .seconds(2.5))
                guard !Task.isCancelled else { return }
                showBackOnline = false
            }
        } else if status != .online {
            showBackOnline = false
        }
        if status == .unreachable { startProbing() } else { probeTask?.cancel(); probeTask = nil }
    }

    /// While unreachable: ask `/auth/v1/health` with backoff; any HTTP answer means Supabase is back.
    private func startProbing() {
        guard probeTask == nil else { return }
        probeTask = Task {
            var attempt = 0
            while !Task.isCancelled, status == .unreachable {
                try? await Task.sleep(for: .seconds(Backoff.delay(attempt: attempt, jitter: Backoff.randomJitter())))
                guard !Task.isCancelled, status == .unreachable else { break }
                if await Self.probe() {
                    probeTask = nil
                    reportSuccess()
                    return
                }
                attempt += 1
            }
            probeTask = nil
        }
    }

    private nonisolated static func probe() async -> Bool {
        guard !SimulatedOffline.isOn, let config = try? AppConfig.load() else { return false }
        var request = URLRequest(url: config.supabaseURL.appending(path: "auth/v1/health"), timeoutInterval: 10)
        request.setValue(config.supabaseAnonKey, forHTTPHeaderField: "apikey")
        do {
            let (_, response) = try await Backend.session.data(for: request)
            return response is HTTPURLResponse
        } catch {
            return false
        }
    }
}

/// DEBUG/UI-test switch read off the main actor by `SimulatedOfflineProtocol`.
enum SimulatedOffline {
    nonisolated(unsafe) private static var value = false
    private static let lock = NSLock()
    static var isOn: Bool {
        get { lock.withLock { value } }
        set { lock.withLock { value = newValue } }
    }
}

/// DEBUG only: fails every Supabase HTTP request fast while the simulated network is off, like a phone
/// in flight mode (registered in `Backend.session` when `-UITestSimulateOffline` is set).
final class SimulatedOfflineProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { SimulatedOffline.isOn }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
    }
    override func stopLoading() {}
}
