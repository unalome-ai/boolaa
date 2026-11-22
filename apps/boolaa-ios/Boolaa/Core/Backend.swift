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

    static func makeClient(config: AppConfig, authStorage: (any AuthLocalStorage)? = nil) -> SupabaseClient {
        let auth: SupabaseClientOptions.AuthOptions
        if let authStorage {
            auth = .init(storage: authStorage, emitLocalSessionAsInitialSession: true)
        } else {
            auth = .init(emitLocalSessionAsInitialSession: true)
        }
        return SupabaseClient(
            supabaseURL: config.supabaseURL,
            supabaseKey: config.supabaseAnonKey,
            options: SupabaseClientOptions(
                db: .init(encoder: BoolaaJSON.encoder, decoder: BoolaaJSON.decoder),
                auth: auth
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
