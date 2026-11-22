import CryptoKit
import Foundation
import Security
import UIKit

/// Where the device secret lives. The app uses the Keychain; tests use memory.
protocol DeviceSecretStore: Sendable {
    func read() -> String?
    func write(_ value: String) -> Bool
    func delete()
}

/// Keychain item for this install's device id (docs/auth-security.md §2): `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`,
/// never synchronised, so it survives sign-out but not a restore onto another phone.
struct KeychainDeviceSecretStore: DeviceSecretStore {
    var service = "ro.boolaa.app.device"
    var account = "device_id"

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account,
         kSecAttrSynchronizable as String: kCFBooleanFalse as Any]
    }

    func read() -> String? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func write(_ value: String) -> Bool {
        delete()
        var q = query
        q[kSecValueData as String] = Data(value.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
    }

    func delete() { SecItemDelete(query as CFDictionary) }
}

/// In-memory store for unit tests.
final class MemoryDeviceSecretStore: DeviceSecretStore, @unchecked Sendable {
    private var value: String?
    private let lock = NSLock()
    init(_ value: String? = nil) { self.value = value }
    func read() -> String? { lock.withLock { value } }
    func write(_ value: String) -> Bool { lock.withLock { self.value = value }; return true }
    func delete() { lock.withLock { value = nil } }
}

/// This install's device id and label for `start_device_check` and the `device-code` function.
struct DeviceIdentity: Sendable {
    /// 32 random bytes, base64url (43 characters). Created once, kept across sign-outs.
    let id: String
    /// "iPhone · iOS 27": model family and OS major only, no personal data (max 120 characters).
    let label: String

    /// Reads the stored id or creates one. A DEBUG override (`-UITestDeviceID boolaa-test-device`) lets tests use the
    /// device the seed already trusts.
    static func load(store: any DeviceSecretStore = KeychainDeviceSecretStore(), label: String, override: String? = nil) -> DeviceIdentity {
        if let override, isValid(override) { return DeviceIdentity(id: override, label: label) }
        if let existing = store.read(), isValid(existing) { return DeviceIdentity(id: existing, label: label) }
        let id = generateID()
        _ = store.write(id)
        return DeviceIdentity(id: id, label: label)
    }

    /// The server accepts 16 to 512 characters.
    static func isValid(_ id: String) -> Bool { (16...512).contains(id.count) }

    static func generateID() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        if status != errSecSuccess {
            // SecRandomCopyBytes doesn't fail in practice; CryptoKit's key material is the same CSPRNG.
            bytes = SymmetricKey(size: .bits256).withUnsafeBytes { Array($0) }
        }
        return base64url(Data(bytes))
    }

    static func base64url(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    /// Lowercase hex sha256, as the server stores device ids (and as `list_my_devices` returns them).
    static func sha256Hex(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    var hash: String { Self.sha256Hex(id) }

    static func makeLabel(model: String, systemVersion: String) -> String {
        let major = systemVersion.split(separator: ".").first.map(String.init) ?? systemVersion
        return String("\(model) · iOS \(major)".prefix(120))
    }

    @MainActor static var currentLabel: String {
        makeLabel(model: UIDevice.current.model, systemVersion: UIDevice.current.systemVersion)
    }
}
