import Foundation

/// JSON coding shared by PostgREST responses, realtime payloads and test fixtures.
/// Models declare explicit snake_case `CodingKeys`, so no key strategy is set here.
enum BoolaaJSON {
    static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let string = try container.decode(String.self)
            if let date = parseTimestamp(string) { return date }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unrecognised timestamp: \(string)")
        }
        return d
    }()

    static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .custom { date, encoder in
            var c = encoder.singleValueContainer()
            try c.encode(date.formatted(.iso8601.year().month().day().time(includingFractionalSeconds: true).timeZone(separator: .omitted)))
        }
        return e
    }()

    /// Parses Postgres `timestamptz` output in the shapes PostgREST and Realtime emit:
    /// `2026-11-22T15:26:52.414517+00:00`, `2026-11-22T15:26:52Z`, `2026-11-22 15:26:52.4145+00`.
    static func parseTimestamp(_ raw: String) -> Date? {
        var s = raw.trimmingCharacters(in: .whitespaces)
        if s.count > 10, s[s.index(s.startIndex, offsetBy: 10)] == " " {
            s.replaceSubrange(s.index(s.startIndex, offsetBy: 10)...s.index(s.startIndex, offsetBy: 10), with: "T")
        }
        // Normalise a short "+00" offset to "+00:00".
        if let match = s.range(of: #"[+-]\d{2}$"#, options: .regularExpression) {
            s.replaceSubrange(match, with: s[match] + ":00")
        }
        // Trim fractional seconds to milliseconds; ISO8601FormatStyle accepts at most 3 digits reliably.
        if let dot = s.firstIndex(of: ".") {
            var end = s.index(after: dot)
            while end < s.endIndex, s[end].isNumber { end = s.index(after: end) }
            let digits = s[s.index(after: dot)..<end]
            let ms = String(digits.prefix(3)).padding(toLength: 3, withPad: "0", startingAt: 0)
            s.replaceSubrange(dot..<end, with: "." + ms)
        }
        if let d = try? Date(s, strategy: .iso8601.year().month().day().time(includingFractionalSeconds: true).timeZone(separator: .colon)) { return d }
        if let d = try? Date(s, strategy: .iso8601.year().month().day().time(includingFractionalSeconds: false).timeZone(separator: .colon)) { return d }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)
    }
}
