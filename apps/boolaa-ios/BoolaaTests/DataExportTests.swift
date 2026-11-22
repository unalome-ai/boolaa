import Foundation
import Testing
@testable import Boolaa

/// "Download my data": the sensitive action, the `data-export` error mapping and the saved file's name.
@Suite("Data export")
struct DataExportTests {
    private let now = ISO8601DateFormatter().date(from: "2026-11-22T23:30:00Z")!

    @Test func exportDataIsASensitiveAction() {
        #expect(SensitiveAction.exportData.rawValue == "export_data")
        #expect(BoolaaAPI.DeviceCodeBody.sendSensitive(.exportData, locale: "ro")
            == ["action": "send", "purpose": "sensitive_action", "sensitive_action": "export_data", "locale": "ro"])
    }

    @Test(arguments: [
        (401, #"{"error":"unauthorized"}"#, UserFacingError.notAuthenticated),
        (401, "", .notAuthenticated),
        (403, #"{"error":"session_not_verified"}"#, .sessionNotVerified),
        (403, #"{"error":"reauthentication_required"}"#, .reauthenticationRequired),
        (429, #"{"error":"export_rate_limited","retry_after":1800}"#, .exportRateLimited),
        (500, #"{"error":"server_error"}"#, .generic),
        (502, "<html>Bad gateway</html>", .generic),
    ])
    func httpErrorsMapToUserErrors(status: Int, body: String, expected: UserFacingError) {
        let error = DataExportError.from(status: status, body: Data(body.utf8))
        #expect(UserFacingError.classify(dataExport: error) == expected)
    }

    @Test func parsesTheErrorBody() {
        let limited = DataExportError.from(status: 429, body: Data(#"{"error":"export_rate_limited","retry_after":1800}"#.utf8))
        #expect(limited == DataExportError(status: 429, code: "export_rate_limited", retryAfter: 1800))
        #expect(DataExportError.from(status: 500, body: Data("oops".utf8)) == DataExportError(status: 500, code: "server_error"))
    }

    @Test func filenameFromContentDisposition() {
        #expect(DataExport.filename(contentDisposition: #"attachment; filename="boolaa-data-2026-11-20.json""#, now: now) == "boolaa-data-2026-11-20.json")
        #expect(DataExport.filename(contentDisposition: "attachment; filename=boolaa-data-2026-11-20.json", now: now) == "boolaa-data-2026-11-20.json")
        #expect(DataExport.filename(contentDisposition: #"ATTACHMENT; FILENAME="boolaa-data-2026-11-20.json"; size=42"#, now: now) == "boolaa-data-2026-11-20.json")
        #expect(DataExport.filename(contentDisposition: #"attachment; filename="x.json"; filename*=UTF-8''donn%C3%A9es.json"#, now: now) == "données.json")
        #expect(DataExport.filename(contentDisposition: #"attachment; filename="../../evil.json""#, now: now) == "evil.json")
    }

    @Test func filenameFallsBackToTheUTCDate() {
        #expect(DataExport.filename(contentDisposition: nil, now: now) == "boolaa-data-2026-11-22.json")
        #expect(DataExport.filename(contentDisposition: "attachment", now: now) == "boolaa-data-2026-11-22.json")
        #expect(DataExport.filename(contentDisposition: #"attachment; filename="""#, now: now) == "boolaa-data-2026-11-22.json")
        // 23:30 UTC is already the 23rd in Bucharest; the name stays in UTC.
        #expect(DataExport.fallbackFilename(now: now) == "boolaa-data-2026-11-22.json")
    }

    @Test func rateLimitMessageIsTranslated() {
        #expect(String(localized: UserFacingError.exportRateLimited.message) != "")
        #expect(UserFacingError.allCases.contains(.exportRateLimited))
    }
}
