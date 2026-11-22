import Foundation
import Supabase

/// Maps backend, auth and network failures to translated messages (docs/i18n-glossary.md, "Backend errors").
/// Raw Postgres / GoTrue English is never shown to the user.
enum UserFacingError: Equatable, Sendable, CaseIterable {
    case invalidInviteCode
    case alreadyMember
    case bubbleFull
    case notMember
    case requestNotFound
    case eventNotFound
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

    /// Classifies any error thrown by the SDK or by URLSession.
    static func classify(_ error: any Error) -> UserFacingError {
        if let urlError = error as? URLError {
            return urlError.code == .cancelled ? .generic : .network
        }
        if let auth = error as? AuthError {
            switch auth.errorCode {
            case .invalidCredentials: return .invalidCredentials
            case .userAlreadyExists, .emailExists: return .emailTaken
            case .weakPassword: return .weakPassword
            case .sessionNotFound, .sessionExpired: return .notAuthenticated
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
            ("not authenticated", .notAuthenticated),
            ("invalid login credentials", .invalidCredentials),
            ("user already registered", .emailTaken),
            ("row-level security", .permissionDenied),
            ("permission denied", .permissionDenied),
        ]
        if let hit = table.first(where: { text.contains($0.0) }) { return hit.1 }
        if code == "42501" { return .permissionDenied }
        return nil
    }

    var message: LocalizedStringResource {
        switch self {
        case .invalidInviteCode: "That invite code doesn't exist. Check it and try again."
        case .alreadyMember: "You're already a member of this bubble."
        case .bubbleFull: "This bubble is full."
        case .notMember: "You're not a member of this bubble."
        case .requestNotFound: "This join request no longer exists."
        case .eventNotFound: "This event no longer exists."
        case .ownerOnlyRemove: "Only the bubble's owner can remove members."
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
        }
    }
}

extension Error {
    /// A translated, user-facing message for this error.
    var userMessage: String { String(localized: UserFacingError.classify(self).message) }
}
