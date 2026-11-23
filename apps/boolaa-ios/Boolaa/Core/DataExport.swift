import Foundation
import Supabase
import SwiftUI
import UniformTypeIdentifiers

// "Download my data" (GDPR export): a verified `export_data` sensitive-action code, then the `data-export`
// Edge Function in the same session, which answers one JSON file.

/// A `data-export` failure: HTTP status, its `error` code and, for `export_rate_limited`, `retry_after` seconds.
struct DataExportError: Error, Equatable, Sendable {
    var status: Int
    var code: String
    var retryAfter: Int?

    static func from(status: Int, body: Data) -> DataExportError {
        struct Payload: Decodable { var error: String?; var retry_after: Int? }
        let payload = try? JSONDecoder().decode(Payload.self, from: body)
        let code = payload?.error ?? (status == 401 ? "unauthorized" : "server_error")
        return DataExportError(status: status, code: code, retryAfter: payload?.retry_after)
    }
}

/// The export: the raw response bytes and the name to save them under.
struct DataExportFile: Equatable, Sendable {
    var data: Data
    var filename: String
}

enum DataExport {
    static let function = "data-export"

    /// `boolaa-data-<yyyy-MM-dd in UTC>.json`, used when the response has no usable Content-Disposition.
    static func fallbackFilename(now: Date = .now) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let c = calendar.dateComponents([.year, .month, .day], from: now)
        return String(format: "boolaa-data-%04d-%02d-%02d.json", c.year ?? 1970, c.month ?? 1, c.day ?? 1)
    }

    /// The file name from `Content-Disposition` (`filename*=UTF-8''…` or `filename="…"`), else `fallbackFilename`.
    static func filename(contentDisposition: String?, now: Date = .now) -> String {
        let header = contentDisposition ?? ""
        func firstMatch(_ pattern: String) -> [String]? {
            guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
                  let match = regex.firstMatch(in: header, range: NSRange(header.startIndex..., in: header)) else { return nil }
            return (0..<match.numberOfRanges).map { i in
                Range(match.range(at: i), in: header).map { String(header[$0]) } ?? ""
            }
        }
        let quotes = CharacterSet(charactersIn: "\"")
        let extended = firstMatch(#"filename\*\s*=\s*([^;]+)"#).map { groups -> String in
            let value = groups[1].trimmingCharacters(in: .whitespaces)
            let encoded = value.range(of: "''").map { String(value[$0.upperBound...]) } ?? value
            return encoded.trimmingCharacters(in: quotes)
        }.flatMap { $0.removingPercentEncoding }
        let plain = firstMatch(#"(?:^|;)\s*filename\s*=\s*("([^"]*)"|[^;]*)"#).map { groups in
            (groups[2].isEmpty ? groups[1] : groups[2]).trimmingCharacters(in: .whitespaces).trimmingCharacters(in: quotes)
        }
        // Never a path: keep the last segment only.
        let name = (extended ?? plain).flatMap { $0.split(whereSeparator: { $0 == "/" || $0 == "\\" }).last.map(String.init) }?
            .trimmingCharacters(in: .whitespaces)
        guard let name, !name.isEmpty, name != ".", name != ".." else { return fallbackFilename(now: now) }
        return name
    }
}

/// The export as a document for `.fileExporter` ("Save to Files"). Bytes are written as received.
struct DataExportDocument: FileDocument {
    static let readableContentTypes: [UTType] = [.json]
    var data: Data

    init(data: Data) { self.data = data }

    init(configuration: ReadConfiguration) throws {
        data = configuration.file.regularFileContents ?? Data()
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}

extension DataExport {
    /// The "try again after" time carried by a rate-limit error (the `device-code` send step or `data-export`), else nil.
    static func limitedUntil(_ error: Error, now: Date = .now) -> Date? {
        if let e = error as? DataExportError, e.code == "export_rate_limited", let s = e.retryAfter, s > 0 {
            return now.addingTimeInterval(TimeInterval(s))
        }
        if let e = error as? DeviceCodeError, e.code == "export_rate_limited", let s = e.retryAfter, s > 0 {
            return now.addingTimeInterval(TimeInterval(s))
        }
        return nil
    }

    /// "You can download your data once an hour. Try again after 14:05." (time in the user's locale).
    static func limitMessage(until: Date) -> String {
        let time = until.formatted(date: .omitted, time: .shortened)
        return String(localized: "You can download your data once an hour. Try again after \(time).",
                      comment: "Data export rate limit; the argument is a time of day")
    }
}

extension BoolaaAPI {
    /// When the next data export is allowed (one an hour), or nil when it is allowed now. Asked BEFORE the
    /// `export_data` code is emailed (`data_export_available_at`, 20261123220000_past_events_export_check.sql).
    func dataExportAvailableAt(now: Date = .now) async throws -> Date? {
        let raw: String? = try await client.rpc("data_export_available_at").execute().value
        guard let raw, let date = BoolaaJSON.parseTimestamp(raw), date > now else { return nil }
        return date
    }

    /// Calls `data-export` with the user's JWT and returns the raw bytes. A 401 refreshes the session and retries once;
    /// a second 401 is thrown (shown as "session expired").
    func exportMyData() async throws -> DataExportFile {
        do {
            return try await invokeDataExport()
        } catch let error as DataExportError where error.status == 401 {
            guard (try? await client.auth.refreshSession()) != nil else { throw error }
            return try await invokeDataExport()
        }
    }

    private func invokeDataExport() async throws -> DataExportFile {
        do {
            return try await client.functions.invoke(DataExport.function, options: FunctionInvokeOptions(body: [String: String]())) { data, response in
                DataExportFile(data: data, filename: DataExport.filename(contentDisposition: response.value(forHTTPHeaderField: "Content-Disposition")))
            }
        } catch FunctionsError.httpError(let code, let data) {
            throw DataExportError.from(status: code, body: data)
        }
    }
}
