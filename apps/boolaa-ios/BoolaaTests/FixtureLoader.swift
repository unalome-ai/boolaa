import Foundation
@testable import Boolaa

private final class BundleToken {}

/// Loads JSON captured from the local REST API (as Alice) and decodes it with the app's decoder.
enum Fixture {
    static func data(_ name: String) throws -> Data {
        guard let url = Bundle(for: BundleToken.self).url(forResource: name, withExtension: "json") else {
            throw CocoaError(.fileNoSuchFile, userInfo: [NSFilePathErrorKey: "\(name).json"])
        }
        return try Data(contentsOf: url)
    }

    static func decode<T: Decodable>(_ type: T.Type, _ name: String) throws -> T {
        try BoolaaJSON.decoder.decode(T.self, from: data(name))
    }
}

enum Seed {
    static let alice = UUID(uuidString: "11111111-1111-1111-1111-111111111111")!
    static let bob = UUID(uuidString: "22222222-2222-2222-2222-222222222222")!
    static let carol = UUID(uuidString: "33333333-3333-3333-3333-333333333333")!
    static let flatmates = UUID(uuidString: "aaaaaaaa-0000-0000-0000-000000000001")!
    static let climbing = UUID(uuidString: "aaaaaaaa-0000-0000-0000-000000000002")!
}
