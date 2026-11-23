import Foundation
import Supabase

/// Maps backend, auth and network failures to translated messages (docs/i18n-glossary.md, "Backend errors").
/// Raw Postgres / GoTrue English is never shown to the user.
enum UserFacingError: Equatable, Sendable, CaseIterable {
    static let allCases: [UserFacingError] = [
        .invalidInviteCode, .alreadyMember, .bubbleFull, .notMember, .requestNotFound, .eventNotFound, .eventEnded, .ownerOnlyRemove,
        .removeSelf, .memberNotFound, .cannotReportSelf, .reportTargetNotFound, .notAuthenticated, .permissionDenied,
        .invalidCredentials, .emailTaken, .weakPassword, .network, .generic,
        .sessionNotVerified, .ageConfirmationRequired, .reauthenticationRequired, .invalidDeviceId, .invalidTermsVersion,
        .codeWrong(attemptsLeft: 1), .codeWrong(attemptsLeft: 3), .codeWrongOrExpired, .codeFormat, .codeExpired,
        .noActiveCode, .tooManyCodeAttempts, .tooManyCodes, .emailSendFailed, .emailRateLimited, .samePassword,
        .oauthFailed, .accountSuspended, .userBanned, .invalidEmail, .imageTooLarge, .imageUnsupported,
        .tooManyInviteAttempts, .ownerOnlyRotate, .ownerOnlyAction, .chatMessageGone, .exportRateLimited,
    ]

    case invalidInviteCode
    case alreadyMember
    case bubbleFull
    case notMember
    case requestNotFound
    case eventNotFound
    /// toggle_rsvp on an event that already ended (20261123220000_past_events_export_check.sql).
    case eventEnded
    case ownerOnlyRemove
    case removeSelf
    case memberNotFound
    case cannotReportSelf
    case reportTargetNotFound
    case notAuthenticated
    case permissionDenied
    case invalidCredentials
    case emailTaken
    case weakPassword
    case network
    case generic
    // Auth security (docs/auth-security.md §3, glossary "Auth security errors")
    case sessionNotVerified
    case ageConfirmationRequired
    case reauthenticationRequired
    case invalidDeviceId
    case invalidTermsVersion
    case codeWrong(attemptsLeft: Int)
    case codeWrongOrExpired
    case codeFormat
    case codeExpired
    case noActiveCode
    case tooManyCodeAttempts
    case tooManyCodes
    case emailSendFailed
    case emailRateLimited
    case samePassword
    case oauthFailed
    // Moderation (docs/moderation.md)
    case accountSuspended
    case userBanned
    case invalidEmail
    // Images (ImageCompression and the bucket limits in 20261123100000_image_limits.sql)
    case imageTooLarge
    case imageUnsupported
    // Invite links (20261123140000_invite_links.sql)
    case tooManyInviteAttempts
    case ownerOnlyRotate
    // Bubble roles (20261123190000_bubble_roles.sql): remove an admin, change roles, transfer ownership
    case ownerOnlyAction
    // Chat (20261123120000_chat_improvements.sql)
    case chatMessageGone
    // "Download my data": data-export answers 429 export_rate_limited (one export an hour).
    case exportRateLimited

    /// Classifies any error thrown by the SDK or by URLSession.
    static func classify(_ error: any Error) -> UserFacingError {
        let result = classifyWithoutEvents(error)
        switch result {
        case .sessionNotVerified: SecurityEvents.post(.sessionNotVerified)
        case .accountSuspended: SecurityEvents.post(.accountSuspended)
        default: break
        }
        return result
    }

    private static func classifyWithoutEvents(_ error: any Error) -> UserFacingError {
        if let code = error as? DeviceCodeError { return classify(deviceCode: code) }
        if let export = error as? DataExportError { return classify(dataExport: export) }
        if let image = error as? ImageCompression.Failure { return image == .tooLarge ? .imageTooLarge : .imageUnsupported }
        if let storage = error as? StorageError { return classify(storage: storage) }
        if let urlError = error as? URLError {
            return urlError.code == .cancelled ? .generic : .network
        }
        if let auth = error as? AuthError {
            switch auth.errorCode {
            case .invalidCredentials: return .invalidCredentials
            case .userAlreadyExists, .emailExists: return .emailTaken
            case .weakPassword: return .weakPassword
            case .sessionNotFound, .sessionExpired: return .notAuthenticated
            case .otpExpired, .reauthenticationNotValid: return .codeWrongOrExpired
            case .reauthenticationNeeded: return .reauthenticationRequired
            case .overEmailSendRateLimit, .overRequestRateLimit: return .emailRateLimited
            case .samePassword: return .samePassword
            case .userBanned: return .userBanned
            case .validationFailed: return .invalidEmail
            default: return classify(message: auth.message, code: nil) ?? .generic
            }
        }
        if let pg = error as? PostgrestError {
            return classify(message: pg.message, code: pg.code) ?? .generic
        }
        let ns = error as NSError
        if ns.domain == NSURLErrorDomain { return .network }
        return classify(message: String(describing: error), code: nil) ?? .generic
    }

    /// Matches the exception texts raised by the RPCs in the migration, plus RLS failures.
    static func classify(message: String, code: String?) -> UserFacingError? {
        let text = message.lowercased()
        let table: [(String, UserFacingError)] = [
            ("invalid invite code", .invalidInviteCode),
            ("too many attempts", .tooManyInviteAttempts),
            ("only the owner can change the invite code", .ownerOnlyRotate),
            ("already a member", .alreadyMember),
            ("bubble is full", .bubbleFull),
            ("not a member of this bubble", .notMember),
            ("request not found", .requestNotFound),
            ("event not found", .eventNotFound),
            ("event has ended", .eventEnded),
            ("only the owner can remove members", .ownerOnlyRemove),
            ("only the owner can remove admins", .ownerOnlyAction),
            ("only the owner can transfer ownership", .ownerOnlyAction),
            ("only the owner can change roles", .ownerOnlyAction),
            ("use leave to remove yourself", .removeSelf),
            ("member not found", .memberNotFound),
            ("message not found", .chatMessageGone),
            ("cannot report yourself", .cannotReportSelf),
            ("report target not found", .reportTargetNotFound),
            ("not authenticated", .notAuthenticated),
            ("session not verified", .sessionNotVerified),
            ("age confirmation required", .ageConfirmationRequired),
            ("reauthentication required", .reauthenticationRequired),
            ("invalid device id", .invalidDeviceId),
            ("invalid terms version", .invalidTermsVersion),
            ("account suspended", .accountSuspended),
            ("user is banned", .userBanned),
            ("invalid login credentials", .invalidCredentials),
            ("user already registered", .emailTaken),
            ("row-level security", .permissionDenied),
            ("permission denied", .permissionDenied),
        ]
        if let hit = table.first(where: { text.contains($0.0) }) { return hit.1 }
        if code == "42501" { return .permissionDenied }
        return nil
    }

    /// Storage upload failures. The bucket limits answer statusCode "413" (EntityTooLarge, "exceeded the maximum
    /// allowed size") or "415" (`invalid_mime_type`, "mime type ... is not supported").
    static func classify(storage error: StorageError) -> UserFacingError {
        let text = error.message.lowercased()
        let code = error.error?.lowercased() ?? ""
        if error.statusCode == "413" || text.contains("exceeded the maximum allowed size") || code.contains("too large") {
            return .imageTooLarge
        }
        if error.statusCode == "415" || code == "invalid_mime_type" || (text.contains("mime type") && text.contains("not supported")) {
            return .imageUnsupported
        }
        return classify(message: error.message, code: nil) ?? .generic
    }

    /// The `data-export` function's `error` codes.
    static func classify(dataExport error: DataExportError) -> UserFacingError {
        switch error.code {
        case "unauthorized": .notAuthenticated
        case "session_not_verified": .sessionNotVerified
        case "reauthentication_required": .reauthenticationRequired
        case "export_rate_limited": .exportRateLimited
        default: .generic
        }
    }

    /// The `device-code` function's `error` codes (docs/auth-security.md §3).
    static func classify(deviceCode error: DeviceCodeError) -> UserFacingError {
        switch error.code {
        case "invalid_request": .codeFormat
        case "invalid_code": error.attemptsLeft.map { .codeWrong(attemptsLeft: $0) } ?? .codeWrongOrExpired
        case "unauthorized": .notAuthenticated
        case "session_not_verified": .sessionNotVerified
        case "no_active_code": .noActiveCode
        case "code_expired": .codeExpired
        case "too_many_attempts": .tooManyCodeAttempts
        case "rate_limited": .tooManyCodes
        case "email_failed": .emailSendFailed
        case "export_rate_limited": .exportRateLimited
        default: .generic
        }
    }

    var message: LocalizedStringResource {
        switch self {
        case .invalidInviteCode: "That invite code doesn't exist. Check it and try again."
        case .alreadyMember: "You're already a member of this bubble."
        case .bubbleFull: "This bubble is full."
        case .notMember: "You're not a member of this bubble."
        case .requestNotFound: "This join request no longer exists."
        case .eventNotFound: "This event no longer exists."
        case .eventEnded: "This event has already ended."
        case .ownerOnlyRemove: "Only the owner or an admin can remove members."
        case .removeSelf: "To remove yourself, leave the bubble instead."
        case .memberNotFound: "This person is no longer a member of the bubble."
        case .cannotReportSelf: "You can't report your own content."
        case .reportTargetNotFound: "This was deleted or is no longer visible to you."
        case .notAuthenticated: "Your session has expired. Sign in again."
        case .permissionDenied: "You don't have permission to do that."
        case .invalidCredentials: "Wrong email or password."
        case .emailTaken: "An account with this email already exists."
        case .weakPassword: "Choose a stronger password (at least 6 characters)."
        case .network: "Can't reach Boolaa. Check your connection and try again."
        case .generic: "Something went wrong. Try again."
        case .sessionNotVerified: "Confirm this device first: enter the code we email you."
        case .ageConfirmationRequired: "Confirm that you're 16 or older to continue."
        case .reauthenticationRequired: "For your safety, confirm it's you with the code we email you."
        case .invalidDeviceId: "We couldn't recognise this device. Restart the app and try again."
        case .invalidTermsVersion: "We couldn't save your confirmation. Restart the app and try again."
        case .codeWrong(let left): "That code isn't right. \(left) tries left."
        case .codeWrongOrExpired: "That code is wrong or expired."
        case .codeFormat: "Enter the 6-digit code."
        case .codeExpired: "That code has expired. Send a new one."
        case .noActiveCode: "There's no active code. Send a new one."
        case .tooManyCodeAttempts: "Too many wrong tries. Send a new code."
        case .tooManyCodes: "Too many codes. Try again later."
        case .emailSendFailed: "Couldn't send the email. Try again."
        case .emailRateLimited: "We just sent you an email. Wait a minute before asking for another."
        case .samePassword: "Your new password must be different from the old one."
        case .oauthFailed: "Couldn't sign you in with that account. Try again."
        case .accountSuspended: "Your account is suspended, so you can't do that right now."
        case .userBanned: "This account can't sign in right now: it's suspended or banned."
        case .invalidEmail: "Enter a valid email address."
        case .imageTooLarge: "That photo is too large. Pick a smaller one."
        case .imageUnsupported: "We can't read that image. Try a different photo."
        case .tooManyInviteAttempts: "Too many tries with invalid codes. Try again in an hour."
        case .ownerOnlyRotate: "Only the owner or an admin can change the invite code."
        case .ownerOnlyAction: "Only the owner can do that."
        case .chatMessageGone: "That message no longer exists."
        case .exportRateLimited: "You can download your data once an hour. Try again later."
        }
    }
}

extension Error {
    /// A translated, user-facing message for this error.
    var userMessage: String { String(localized: UserFacingError.classify(self).message) }
}
