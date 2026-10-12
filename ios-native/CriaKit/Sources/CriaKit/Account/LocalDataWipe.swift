import Foundation

/// Removes everything the signed-in account left on disk: the SQLite database (with its WAL and SHM files), queued
/// attachment blobs and cached backgrounds. Run after sign-out so the next account never sees the last one's data.
public enum LocalDataWipe {
    static let databaseName = "cria.sqlite"

    /// Deletes what it finds under `root`. Missing files are fine; the first real failure is thrown after the rest
    /// have been tried, so one stuck file does not leave the others behind.
    public static func wipe(root: URL, fileManager: FileManager = .default) throws {
        let names = [databaseName, "\(databaseName)-wal", "\(databaseName)-shm", "blobs"]
        var firstError: (any Error)?
        for name in names {
            let target = root.appendingPathComponent(name)
            guard fileManager.fileExists(atPath: target.path) else { continue }
            do {
                try fileManager.removeItem(at: target)
            } catch {
                firstError = firstError ?? error
            }
        }
        if let firstError { throw firstError }
    }

    /// Settings values that belong to the account: other people's names, cached server settings, hand-set progress
    /// (keyed by task), the last full reconcile and, in the App Group, the capture project.
    static let accountDefaultsKeys = [
        "cria.userNames", "cria.timezone", "cria.weekStart", "cria.quickAddMagicMode", "cria.manualProgress",
        "cria.lastReconcileAt"
    ]
    static let sharedAccountDefaultsKeys = ["cria.captureProjectLocalId"]

    /// Forgets what the account left outside the data directory: the values above, the in-memory name directory and
    /// the temporary folder (a data export, attachments opened for preview). Device preferences stay.
    public static func forgetAccount(
        defaults: UserDefaults = .standard,
        shared: UserDefaults = CriaPaths.sharedDefaults(),
        temporaryDirectory: URL = FileManager.default.temporaryDirectory,
        fileManager: FileManager = .default
    ) {
        accountDefaultsKeys.forEach { defaults.removeObject(forKey: $0) }
        sharedAccountDefaultsKeys.forEach { shared.removeObject(forKey: $0) }
        UserNameDirectory.shared.forget()
        let leftovers = (try? fileManager.contentsOfDirectory(at: temporaryDirectory, includingPropertiesForKeys: nil)) ?? []
        for item in leftovers { try? fileManager.removeItem(at: item) }
    }
}
