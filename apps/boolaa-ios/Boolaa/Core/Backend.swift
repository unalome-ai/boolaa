import Foundation
import Supabase

/// Builds the shared Supabase client.
enum Backend {
    /// The app-wide client. Sessions persist in the Keychain.
    static let shared: SupabaseClient = {
        do {
            return makeClient(config: try AppConfig.load())
        } catch {
            fatalError(error.localizedDescription)
        }
    }()

    /// REST, RPC, Auth and Storage requests (docs/boolaa-spec.md, "Offline and poor network"): a request
    /// that goes 15 s without receiving anything fails (a network error: the screen shows Try again instead
    /// of spinning forever), and no request may take longer than 60 s in total (photo uploads included).
    /// Realtime gets its own default session: these timeouts would close an idle WebSocket.
    static let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 60
        config.waitsForConnectivity = false
        #if DEBUG
        config.protocolClasses = [SimulatedOfflineProtocol.self] + (config.protocolClasses ?? [])
        #endif
        return URLSession(configuration: config)
    }()

    static func makeClient(config: AppConfig, authStorage: (any AuthLocalStorage)? = nil) -> SupabaseClient {
        let auth: SupabaseClientOptions.AuthOptions
        if let authStorage {
            auth = .init(storage: authStorage, redirectToURL: AppConfig.authCallbackURL, emitLocalSessionAsInitialSession: true)
        } else {
            auth = .init(redirectToURL: AppConfig.authCallbackURL, emitLocalSessionAsInitialSession: true)
        }
        return SupabaseClient(
            supabaseURL: config.supabaseURL,
            supabaseKey: config.supabaseAnonKey,
            options: SupabaseClientOptions(
                db: .init(encoder: BoolaaJSON.encoder, decoder: BoolaaJSON.decoder),
                auth: auth,
                global: .init(session: session),
                realtime: RealtimeClientOptions(session: URLSession(configuration: .default))
            )
        )
    }
}

/// In-memory session storage (used by tests so they never touch the app's Keychain session).
final class InMemoryAuthStorage: AuthLocalStorage, @unchecked Sendable {
    private var values: [String: Data] = [:]
    private let lock = NSLock()
    init() {}
    func store(key: String, value: Data) throws { lock.withLock { values[key] = value } }
    func retrieve(key: String) throws -> Data? { lock.withLock { values[key] } }
    func remove(key: String) throws { _ = lock.withLock { values.removeValue(forKey: key) } }
}
