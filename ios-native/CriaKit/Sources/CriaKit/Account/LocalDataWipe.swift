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
}
