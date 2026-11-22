import Foundation
import Supabase
import Testing
@testable import Boolaa

/// The app bundle's compiled `<lang>.lproj`, so a test can resolve strings in any language
/// regardless of the simulator's language.
private func lproj(_ lang: String) throws -> Bundle {
    let path = try #require(Bundle.main.path(forResource: lang, ofType: "lproj"), "\(lang).lproj missing from Boolaa.app")
    return try #require(Bundle(path: path))
}

private func resolve(_ resource: LocalizedStringResource, _ lang: String) throws -> String {
    try lproj(lang).localizedString(forKey: resource.key, value: "⟨missing⟩", table: nil)
}

@Suite("Plurals (String(localized:bundle:locale:))")
struct PluralTests {
    private func members(_ n: Int, of max: Int, _ lang: String) throws -> String {
        String(localized: "\(n) of \(max) members", bundle: try lproj(lang), locale: Locale(identifier: lang))
    }

    @Test func romanianMembersUseOneFewOther() throws {
        #expect(try members(1, of: 1, "ro") == "1 din 1 membru")
        #expect(try members(2, of: 8, "ro") == "2 din 8 membri")
        #expect(try members(2, of: 20, "ro") == "2 din 20 de membri")
    }

    @Test func romanianApprovalsSoFar() throws {
        let ro = try lproj("ro"), locale = Locale(identifier: "ro")
        #expect(String(localized: "\(1) approvals so far", bundle: ro, locale: locale) == "1 aprobare până acum")
        #expect(String(localized: "\(0) approvals so far", bundle: ro, locale: locale) == "0 aprobări până acum")
        #expect(String(localized: "\(3) approvals so far", bundle: ro, locale: locale) == "3 aprobări până acum")
        #expect(String(localized: "\(25) approvals so far", bundle: ro, locale: locale) == "25 de aprobări până acum")
    }

    @Test func frenchUsesSingularForZeroAndOne() throws {
        let fr = try lproj("fr"), locale = Locale(identifier: "fr")
        #expect(String(localized: "\(0) items", bundle: fr, locale: locale) == "0 article")
        #expect(String(localized: "\(1) items", bundle: fr, locale: locale) == "1 article")
        #expect(String(localized: "\(2) items", bundle: fr, locale: locale) == "2 articles")
        #expect(String(localized: "\(0) of \(1) approvals", bundle: fr, locale: locale) == "0 sur 1 approbation")
    }

    @Test func englishSpanishItalian() throws {
        #expect(try members(1, of: 1, "en") == "1 of 1 member")
        #expect(String(localized: "\(0) of \(2) approvals", bundle: try lproj("en"), locale: Locale(identifier: "en")) == "0 of 2 approvals")
        #expect(String(localized: "\(1) going", bundle: try lproj("es"), locale: Locale(identifier: "es")) == "1 asistente")
        #expect(String(localized: "\(4) going", bundle: try lproj("it"), locale: Locale(identifier: "it")) == "4 partecipanti")
    }
}

@Suite("Backend error mapping")
struct ErrorMappingTests {
    @Test(arguments: [
        ("invalid invite code", UserFacingError.invalidInviteCode),
        ("already a member", .alreadyMember),
        ("bubble is full", .bubbleFull),
        ("not a member of this bubble", .notMember),
        ("request not found", .requestNotFound),
        ("event not found", .eventNotFound),
        ("only the owner can remove members", .ownerOnlyRemove),
        ("use leave to remove yourself", .removeSelf),
        ("member not found", .memberNotFound),
        ("cannot report yourself", .cannotReportSelf),
        ("report target not found", .reportTargetNotFound),
        ("new row violates row-level security policy for table \"events\"", .permissionDenied),
        ("some brand new failure", .generic),
    ])
    func postgrestMessages(message: String, expected: UserFacingError) {
        #expect(UserFacingError.classify(PostgrestError(message: message)) == expected)
    }

    @Test func rlsByCode() {
        #expect(UserFacingError.classify(PostgrestError(code: "42501", message: "denied")) == .permissionDenied)
    }

    @Test func networkAndAuth() throws {
        #expect(UserFacingError.classify(URLError(.notConnectedToInternet)) == .network)
        #expect(UserFacingError.classify(URLError(.timedOut)) == .network)
        let response = try #require(HTTPURLResponse(url: URL(string: "http://localhost")!, statusCode: 400, httpVersion: nil, headerFields: nil))
        let invalid = AuthError.api(message: "Invalid login credentials", errorCode: .invalidCredentials, underlyingData: Data(), underlyingResponse: response)
        #expect(UserFacingError.classify(invalid) == .invalidCredentials)
        let taken = AuthError.api(message: "User already registered", errorCode: .userAlreadyExists, underlyingData: Data(), underlyingResponse: response)
        #expect(UserFacingError.classify(taken) == .emailTaken)
        #expect(UserFacingError.classify(CocoaError(.fileNoSuchFile)) == .generic)
    }

    @Test func messagesAreTranslatedNeverRawEnglish() throws {
        #expect(try resolve(UserFacingError.bubbleFull.message, "ro") == "Bula este plină.")
        #expect(try resolve(UserFacingError.invalidInviteCode.message, "fr") == "Ce code d'invitation n'existe pas. Vérifie-le et réessaie.")
        #expect(try resolve(UserFacingError.alreadyMember.message, "es") == "Ya eres miembro de esta burbuja.")
        #expect(try resolve(UserFacingError.network.message, "it") == "Impossibile raggiungere Boolaa. Controlla la connessione e riprova.")
        for error in UserFacingError.allCases {
            // Plural messages compile to a stringsdict; AuthSecurityTests.triesLeftPlurals resolves them per language.
            if case .codeWrong = error { continue }
            let english = try resolve(error.message, "en")
            for lang in ["ro", "fr", "es", "it"] {
                let text = try resolve(error.message, lang)
                #expect(text != "⟨missing⟩" && text != english, "\(error) untranslated in \(lang)")
            }
        }
    }
}

@Suite("Compiled catalog")
struct CatalogTests {
    /// Reads the source catalog next to this file (tests run on the simulator, which can see the host filesystem).
    private func catalog() throws -> [String: Any] {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "Boolaa/Resources/Localizable.xcstrings")
        let json = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
        return try #require(json?["strings"] as? [String: Any])
    }

    @Test(arguments: ["ro", "fr", "es", "it"])
    func everyKeyCompiledAndTranslated(lang: String) throws {
        let bundle = try lproj(lang)
        var checked = 0
        for (key, entry) in try catalog() {
            let locs = (entry as? [String: Any])?["localizations"] as? [String: Any]
            let loc = try #require(locs?[lang] as? [String: Any], "\(key) has no \(lang)")
            guard loc["variations"] == nil, loc["substitutions"] == nil,
                  let unit = loc["stringUnit"] as? [String: Any] else { continue } // plurals are covered above
            #expect(unit["state"] as? String == "translated", "\(key) [\(lang)]")
            #expect(bundle.localizedString(forKey: key, value: "⟨missing⟩", table: nil) == unit["value"] as? String,
                    "\(key) [\(lang)] not compiled into the app")
            if lang == "ro", let v = unit["value"] as? String {
                #expect(v.range(of: "[ŞşŢţ]", options: .regularExpression) == nil, "cedilla in \(key)")
            }
            checked += 1
        }
        #expect(checked > 100)
    }

    @Test func advertisedLocalizations() {
        let declared = Bundle.main.object(forInfoDictionaryKey: "CFBundleLocalizations") as? [String]
        #expect(Set(declared ?? []) == ["en", "ro", "fr", "es", "it"])
        #expect(Set(Bundle.main.localizations).isSuperset(of: ["en", "ro", "fr", "es", "it"]))
    }

    @Test func languageNamesInTheirOwnLanguage() {
        #expect(AppLanguage.allCases.map(\.nativeName) == ["English", "Română", "Français", "Español", "Italiano"])
        #expect(AppLanguage.resolve(["ro-RO"]) == .ro)
        #expect(AppLanguage.resolve(["de", "fr-CA"]) == .fr)
        #expect(AppLanguage.resolve(["de"]) == .en)
    }
}
