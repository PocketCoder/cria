import Foundation
import Security

/// One secret value in secure storage. `KeychainSlot` is production; tests use `MemorySlot`.
public protocol SecretSlot: Sendable {
    func read() throws -> String?
    func write(_ value: String) throws
    func delete() throws
}

public struct KeychainError: Error, Equatable, Sendable, CustomStringConvertible {
    public let status: Int32
    public var description: String { "Keychain error \(status)" }
}

/// Keychain generic-password item. The account is the bundle ID so a dev and a release flavour
/// never share a credential (mirrors the per-flavour split of the Tauri apps).
public struct KeychainSlot: SecretSlot {
    private let service: String
    private let account: String
    private let accessGroup: String?

    public init(service: String = "io.cria.credentials", account: String = Bundle.main.bundleIdentifier ?? "io.cria.app.swift",
                accessGroup: String? = nil) {
        self.service = service
        self.account = account
        self.accessGroup = accessGroup
    }

    private var baseQuery: [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        if let accessGroup { query[kSecAttrAccessGroup as String] = accessGroup }
        return query
    }

    public func read() throws -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw KeychainError(status: status) }
        return String(data: data, encoding: .utf8)
    }

    public func write(_ value: String) throws {
        let data = Data(value.utf8)
        let update = SecItemUpdate(baseQuery as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if update == errSecSuccess { return }
        guard update == errSecItemNotFound else { throw KeychainError(status: update) }
        var add = baseQuery
        add[kSecValueData as String] = data
        // Readable after the first unlock so background sync works with the screen locked.
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let status = SecItemAdd(add as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainError(status: status) }
    }

    public func delete() throws {
        let status = SecItemDelete(baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw KeychainError(status: status) }
    }
}

/// In-memory slot for tests and previews.
public final class MemorySlot: SecretSlot, @unchecked Sendable {
    private let lock = NSLock()
    private var value: String?

    public init(_ value: String? = nil) {
        self.value = value
    }

    public func read() throws -> String? { lock.withLock { value } }
    public func write(_ newValue: String) throws { lock.withLock { value = newValue } }
    public func delete() throws { lock.withLock { value = nil } }
}

/// Credential persistence. Everything lives in the one Keychain slot as a JSON blob.
/// Unlike the Tauri client there is deliberately **no plaintext fallback**: a Keychain error
/// (for example a locked device) is surfaced to the caller and never causes the token to be written
/// anywhere else (AGENTS.md "Credentials live in the OS keychain").
public struct CredentialStore: Sendable {
    private let slot: any SecretSlot

    public init(slot: any SecretSlot = KeychainSlot()) {
        self.slot = slot
    }

    /// An unreadable Keychain or a corrupt blob counts as signed out; signing in rewrites the slot.
    public func load() -> Credentials? {
        guard let raw = try? slot.read(), let data = raw.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(Credentials.self, from: data)
    }

    public func save(_ credentials: Credentials) throws {
        let data = try JSONEncoder().encode(credentials)
        try slot.write(String(decoding: data, as: UTF8.self))
    }

    /// Sign-out must not fail because the Keychain is unhappy, so errors are swallowed.
    public func clear() {
        try? slot.delete()
    }
}
