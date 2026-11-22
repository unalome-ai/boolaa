import CoreImage
import CoreImage.CIFilterBuiltins
import Foundation
import UIKit

/// Invite links (docs/boolaa-spec.md, "Invite links"): `https://boolaa.ro/join/<CODE>`, opened as a universal
/// link (Associated Domains `applinks:boolaa.ro`), plus the custom schemes `boolaa://join/<CODE>` (legacy) and
/// `ro.boolaa.app://join/<CODE>` as fallbacks. CODE is the bubble's invite code; opening a link only shows a
/// preview, joining still needs the members' approval.
enum InviteLink {
    /// Links are always shared with the production host, also from debug builds pointing at a local backend.
    static let host = "boolaa.ro"
    static let acceptedHosts: Set<String> = ["boolaa.ro", "www.boolaa.ro"]
    static let customSchemes: Set<String> = ["boolaa", "ro.boolaa.app"]

    /// The invite code in `url`, normalised, or nil when `url` is not an invite link.
    static func code(from url: URL) -> String? {
        guard let scheme = url.scheme?.lowercased() else { return nil }
        let parts = url.pathComponents.filter { $0 != "/" }
        if scheme == "https" {
            guard let host = url.host()?.lowercased(), acceptedHosts.contains(host),
                  parts.count == 2, parts[0].lowercased() == "join" else { return nil }
            return normalize(parts[1])
        }
        if customSchemes.contains(scheme) {
            // boolaa://join/CODE parses as host "join", path "/CODE".
            guard url.host()?.lowercased() == "join", parts.count == 1 else { return nil }
            return normalize(parts[0])
        }
        return nil
    }

    /// Upper-cases and drops spaces and dashes; nil unless 4–32 ASCII letters and digits remain
    /// (the backend's `normalize_invite_code` accepts the same).
    static func normalize(_ raw: String) -> String? {
        let cleaned = (raw.removingPercentEncoding ?? raw).filter { !$0.isWhitespace && $0 != "-" }.uppercased()
        guard (4...32).contains(cleaned.count),
              cleaned.unicodeScalars.allSatisfy({ ("A"..."Z").contains($0) || ("0"..."9").contains($0) }) else { return nil }
        return cleaned
    }

    /// `https://boolaa.ro/join/<CODE>`.
    static func url(for code: String) -> URL {
        var components = URLComponents()
        components.scheme = "https"
        components.host = host
        components.path = "/join/\(normalize(code) ?? code)"
        return components.url!
    }

    /// A crisp QR code for `string`: one point per module times `scale`, no smoothing (show it with
    /// `.interpolation(.none)`).
    static func qrImage(for string: String, scale: CGFloat = 12) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(string.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: scale, y: scale)),
              let cgImage = CIContext().createCGImage(output, from: output.extent) else { return nil }
        return UIImage(cgImage: cgImage)
    }
}

/// `get_invite_preview(p_code)`: what a non-member may see before asking to join.
struct InvitePreview: Decodable, Equatable, Sendable {
    enum Status: String, Decodable, Sendable {
        /// Already in: `bubbleId` is set so the app can switch to it.
        case member
        /// The caller already asked to join.
        case pending
        /// No free seat.
        case full
        case open
    }

    /// Only set when `status == .member`.
    let bubbleId: UUID?
    let name: String
    let logo: String?
    let memberCount: Int
    let maxSize: Int
    let status: Status

    enum CodingKeys: String, CodingKey {
        case name, logo, status
        case bubbleId = "bubble_id"
        case memberCount = "member_count"
        case maxSize = "max_size"
    }
}
