import Foundation

/// Backend configuration read from Info.plist, which is filled from `Config/*.xcconfig`.
struct AppConfig: Sendable {
    let supabaseURL: URL
    let supabaseAnonKey: String

    enum ConfigError: Error, LocalizedError {
        case missing(String)
        var errorDescription: String? {
            switch self {
            case .missing(let key): "Missing \(key) in Info.plist. Copy Config/Local.xcconfig.example to Config/Local.xcconfig."
            }
        }
    }

    static func load(from bundle: Bundle = .main) throws -> AppConfig {
        let info = bundle.infoDictionary ?? [:]
        guard let raw = info["SupabaseURL"] as? String, !raw.isEmpty, let url = URL(string: raw), url.scheme != nil else {
            throw ConfigError.missing("SupabaseURL")
        }
        guard let key = info["SupabaseAnonKey"] as? String, !key.isEmpty else {
            throw ConfigError.missing("SupabaseAnonKey")
        }
        return AppConfig(supabaseURL: url, supabaseAnonKey: key)
    }
}
