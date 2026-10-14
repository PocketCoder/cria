import Foundation

/// One-time takeover of a sign-in made by the Tauri desktop app (Phase 8 of the macOS plan). The Tauri app keeps the
/// whole credential as JSON in a Keychain item, service `Cria`, account `vikunja-token` (stable) or
/// `vikunja-token.<flavour>`, with the same keys as `Credentials`.
///
/// It never runs at launch: reading another app's Keychain item can raise a securityd access prompt that blocks the
/// calling thread until answered, which hung the Mac app on its spinner. The user starts it from the sign-in screen
/// (`adopt(into:timeout:)`), which reads off the caller with a timeout. Once it has adopted or been refused it is not
/// offered again, so signing out does not quietly sign the user back in from the old app's item.
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
        let prefix = "io.cria.app."
        guard bundleIdentifier.hasPrefix(prefix), bundleIdentifier.count > prefix.count else { return "vikunja-token" }
        return "vikunja-token.\(bundleIdentifier.dropFirst(prefix.count))"
    }

    /// Keychain statuses where the user (or the system) said no: errSecAuthFailed and errSecUserCanceled. Asking again on
    /// every launch would be a nag, so these end the import.
    private static let refusalStatuses: Set<Int32> = [-25293, -128]

    /// The credentials to adopt, or nil if the import already ran or there is nothing usable. An unreadable item
    /// (locked, interaction not allowed) returns nil without marking the import done, so it is tried again next launch;
    /// a refusal, a missing item or a corrupt one ends it. A usable item is NOT marked here: the caller calls
    /// `commit()` once it has saved the credentials, so a failed save is retried.
    public func credentials() -> Credentials? {
        guard !hasRun() else { return nil }
        let raw: String?
        do {
            raw = try slot.read()
        } catch {
            if let keychain = error as? KeychainError, Self.refusalStatuses.contains(keychain.status) { markRun() }
            return nil
        }
        guard let raw, let data = raw.data(using: .utf8),
              let credentials = try? JSONDecoder().decode(Credentials.self, from: data),
              !credentials.token.isEmpty, !credentials.serverURL.isEmpty else {
            markRun()
            return nil
        }
        return credentials
    }

    /// Ends the import after the adopted credentials were saved.
    public func commit() { markRun() }

    /// Whether the sign-in screen should still offer the takeover.
    public var isAvailable: Bool { !hasRun() }

    public enum Outcome: Equatable, Sendable {
        case adopted
        /// Nothing usable to adopt: no item, a corrupt one, a refused prompt, or the import already ran.
        case nothingToAdopt
        /// The Keychain did not answer in time (an unanswered access prompt). Not marked done, so it can be tried again.
        case timedOut
        /// The credentials were read but the native Keychain item could not be written. Not marked done.
        case saveFailed
    }

    /// User-initiated takeover. The Keychain read runs on a detached task and is abandoned after `timeout` seconds
    /// (SecItemCopyMatching cannot be cancelled; a late answer is dropped). The import is only marked done after the
    /// credentials were saved by `session.signIn`.
    public func adopt(into session: AuthSession, timeout: Double = 20) async -> Outcome {
        guard let read = await readWithTimeout(timeout) else { return .timedOut }
        guard let credentials = read else { return .nothingToAdopt }
        do {
            try await session.signIn(credentials)
        } catch {
            return .saveFailed
        }
        commit()
        return .adopted
    }

    /// nil on timeout, `.some(nil)` when there is nothing to adopt.
    func readWithTimeout(_ timeout: Double) async -> Credentials?? {
        let gate = ResumeOnce()
        return await withCheckedContinuation { (continuation: CheckedContinuation<Credentials??, Never>) in
            Task.detached(priority: .userInitiated) {
                let value = self.credentials()
                if gate.claim() { continuation.resume(returning: .some(value)) }
            }
            Task.detached {
                try? await Task.sleep(nanoseconds: UInt64(max(timeout, 0) * 1_000_000_000))
                if gate.claim() { continuation.resume(returning: nil) }
            }
        }
    }
}

/// Lets exactly one of two racing tasks resume a continuation.
private final class ResumeOnce: @unchecked Sendable {
    private let lock = NSLock()
    private var done = false

    func claim() -> Bool {
        lock.withLock {
            if done { return false }
            done = true
            return true
        }
    }
}
