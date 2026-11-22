import SafariServices
import SwiftUI

/// Privacy Policy and Terms of Service, served by the web app at `<WebBaseURL>/privacy|terms?lang=xx`.
enum LegalPage: String, Identifiable, Sendable {
    case privacy, terms
    var id: String { rawValue }

    var title: LocalizedStringResource {
        switch self {
        case .privacy: "Privacy Policy"
        case .terms: "Terms of Service"
        }
    }

    func url(base: URL = AppConfig.webBaseURL, language: AppLanguage = .current) -> URL {
        var components = URLComponents(url: base.appending(path: rawValue), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "lang", value: language.rawValue)]
        return components.url!
    }

    /// Links inside localized Markdown text use this scheme, e.g. `[Terms](boolaa-legal://terms)`.
    static let linkScheme = "boolaa-legal"
    init?(link url: URL) {
        guard url.scheme == Self.linkScheme, let page = LegalPage(rawValue: url.host() ?? "") else { return nil }
        self = page
    }
}

struct SafariView: UIViewControllerRepresentable {
    var url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController {
        let vc = SFSafariViewController(url: url)
        vc.preferredControlTintColor = UIColor(Theme.brandText)
        return vc
    }
    func updateUIViewController(_ vc: SFSafariViewController, context: Context) {}
}

extension View {
    /// Presents a legal page in an in-app Safari view while `page` is set.
    func legalPageSheet(_ page: Binding<LegalPage?>) -> some View {
        sheet(item: page) { SafariView(url: $0.url()).ignoresSafeArea() }
    }
}
