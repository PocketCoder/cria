import Foundation

/// One-time takeover of a sign-in made by the Tauri desktop app (Phase 8 of the macOS plan). The Tauri app keeps the
/// whole credential as JSON in a Keychain item, service `Cria`, account `vikunja-token` (stable) or
/// `vikunja-token.<flavour>`, with the same keys as `Credentials`.
///
/// It runs at most once per install: signing out must not quietly sign the user back in from the old app's item.
public struct LegacyCredentialImport: Sendable {
    private let slot: any SecretSlot
    private let hasRun: @Sendable () -> Bool
    private let markRun: @Sendable () -> Void

    public init(slot: any SecretSlot, hasRun: @escaping @Sendable () -> Bool, markRun: @escaping @Sendable () -> Void) {
        self.slot = slot
        self.hasRun = hasRun
        self.markRun = markRun
    }

    /// The Tauri app's keychain item for a bundle ID: stable keeps the original account name, other flavours add a
    /// suffix (mirrors `account_for` in `src-tauri/src/secure.rs`).
    public static func tauriSlot(bundleIdentifier: String) -> KeychainSlot {
        KeychainSlot(service: "Cria", account: tauriAccount(bundleIdentifier: bundleIdentifier))
    }

    static func tauriAccount(bundleIdentifier: String) -> String {
        guard bundleIdentifier != "io.cria.app", let flavour = bundleIdentifier.split(separator: ".").last,
              bundleIdentifier.hasPrefix("io.cria.app.") else { return "vikunja-token" }
        return "vikunja-token.\(flavour)"
    }

    /// The credentials to adopt, or nil if the import already ran or there is nothing usable. An unreadable item
    /// (locked, access denied) returns nil without marking the import done, so it is tried again next launch.
    /// A missing or corrupt item marks it done.
    public func credentials() -> Credentials? {
        guard !hasRun() else { return nil }
        let raw: String?
        do {
            raw = try slot.read()
        } catch {
            return nil
        }
        markRun()
        guard let raw, let data = raw.data(using: .utf8),
              let credentials = try? JSONDecoder().decode(Credentials.self, from: data),
              !credentials.token.isEmpty, !credentials.serverURL.isEmpty else { return nil }
        return credentials
    }
}
