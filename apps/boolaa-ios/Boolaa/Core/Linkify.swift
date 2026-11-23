import Foundation

/// Tappable links in chat text (docs/boolaa-spec.md "Chat"). Same rules as the web (`src/lib/linkify.ts`)
/// and Android (`Linkify.kt`):
/// - a link starts at `http://`, `https://` or `www.` on a word boundary and runs to whitespace;
/// - trailing punctuation (. , ! ? ; : ' " and unbalanced closing brackets) stays text;
/// - `www.` links get `https://`; only http(s) URLs with a host are linked.
/// No previews in chat: links open outside the app.
enum Linkify {
    struct Part: Equatable {
        let text: String
        let url: URL?
    }

    nonisolated(unsafe) private static let pattern = try! NSRegularExpression(pattern: #"\b(?:https?://|www\.)[^\s<>"]+"#, options: [.caseInsensitive])
    private static let trailing: Set<Character> = [".", ",", "!", "?", ";", ":", "'", "\u{2019}", "\u{201D}", "*", "_"]
    private static let pairs: [Character: Character] = [")": "(", "]": "[", "}": "{", ">": "<"]

    /// Drops trailing punctuation that is almost always sentence text, not part of the URL.
    static func trim(_ raw: Substring) -> Substring {
        var s = raw
        while let last = s.last {
            if trailing.contains(last) {
                s = s.dropLast()
            } else if let open = pairs[last], s.filter({ $0 == open }).count < s.filter({ $0 == last }).count {
                s = s.dropLast()
            } else {
                break
            }
        }
        return s
    }

    /// The URL a matched link opens, or nil when it isn't a usable http(s) URL.
    static func url(for match: Substring) -> URL? {
        let href = match.lowercased().hasPrefix("www.") ? "https://" + match : String(match)
        guard let comps = URLComponents(string: href), let scheme = comps.scheme?.lowercased(),
              scheme == "http" || scheme == "https", let host = comps.host, !host.isEmpty,
              host.contains(".") || host == "localhost",
              let url = comps.url else { return nil }
        return url
    }

    /// Plain and link parts, in order; joining every `text` gives the input back.
    static func split(_ text: String) -> [Part] {
        var parts: [Part] = []
        let ns = text as NSString
        var last = text.startIndex
        for match in pattern.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            guard let range = Range(match.range, in: text) else { continue }
            let raw = trim(text[range])
            guard !raw.isEmpty, let url = url(for: raw) else { continue }
            if range.lowerBound > last { parts.append(Part(text: String(text[last..<range.lowerBound]), url: nil)) }
            parts.append(Part(text: String(raw), url: url))
            last = raw.endIndex
        }
        if last < text.endIndex { parts.append(Part(text: String(text[last...]), url: nil)) }
        return parts
    }

    /// The message text with every link carrying `.link` (SwiftUI opens it with `openURL`, in the browser)
    /// and an underline; link colour comes from the Text's tint.
    static func attributed(_ text: String) -> AttributedString {
        var out = AttributedString()
        for part in split(text) {
            var run = AttributedString(part.text)
            if let url = part.url {
                run.link = url
                run.underlineStyle = .single
            }
            out += run
        }
        return out
    }
}
