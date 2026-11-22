import Foundation

/// The five supported UI languages (docs/i18n-glossary.md).
enum AppLanguage: String, CaseIterable, Sendable {
    case en, ro, fr, es, it

    /// The language name written in that language, as the glossary specifies.
    var nativeName: String {
        switch self {
        case .en: "English"
        case .ro: "Română"
        case .fr: "Français"
        case .es: "Español"
        case .it: "Italiano"
        }
    }

    /// The language the app is actually displayed in (what iOS resolved from the per-app setting).
    static var current: AppLanguage { resolve(Bundle.main.preferredLocalizations) }

    nonisolated static func resolve(_ preferred: [String]) -> AppLanguage {
        for id in preferred {
            let code = Locale(identifier: id).language.languageCode?.identifier ?? id
            if let lang = AppLanguage(rawValue: code) { return lang }
        }
        return .en
    }
}
