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

    /// OAuth and email-link callback (PKCE). Allow-listed in Supabase Auth's redirect URLs.
    static let authCallbackURL = URL(string: "ro.boolaa.app://auth/callback")!

    /// Base URL of the web app (legal pages). Falls back to production when the key is missing.
    static var webBaseURL: URL { webBaseURL(from: .main) }
    static func webBaseURL(from bundle: Bundle) -> URL {
        if let raw = bundle.infoDictionary?["WebBaseURL"] as? String, let url = URL(string: raw), url.scheme != nil, url.host() != nil {
            return url
        }
        return URL(string: "https://boolaa.app")!
    }
}
