import Foundation

/// Startup sweep of the side-store. Ported from `src/sync/blobSweep.ts`.
///
/// Whoever ends a queued upload deletes its bytes. A crash between writing the bytes and inserting the row, a failed
/// delete, or a row dropped some other way leaves a file nothing will remove. This clears such leftovers once per launch.
///
/// A blob is deleted only when it was last written more than `grace` ago (so the file being picked right now is never
/// touched) and nothing refers to it. Cache blobs are exempt from both rules; they go only when their project is gone.
/// Anything uncertain keeps the file. Errors never escape, so app start cannot fail here.
public enum BlobSweep {
    public static let grace: TimeInterval = 24 * 60 * 60
    /// Delay after launch, clear of first render, the initial pull and the outbox drain.
    public static let launchDelay: TimeInterval = 30

    @discardableResult
    public static func sweep(store: CriaStore, blobs: any BlobStoring, now: Date = Date()) -> Int {
        guard let entries = try? blobs.list() else { return 0 }
        var removed = 0
        for entry in entries {
            if BlobIds.isCache(entry.id) {
                guard let serverId = BlobIds.projectServerId(ofBlob: entry.id),
                      let exists = try? store.projectExists(serverId: serverId), !exists else { continue }
                if (try? blobs.delete(entry.id)) != nil { removed += 1 }
                continue
            }
            guard let modified = entry.modified, now.timeIntervalSince(modified) >= grace else { continue }
            guard let referenced = try? store.isBlobReferenced(key: entry.id), !referenced else { continue }
            if (try? blobs.delete(entry.id)) != nil { removed += 1 }
        }
        return removed
    }

    /// Runs the sweep once, `delay` seconds from now. Cancel the returned task from an effect cleanup.
    public static func schedule(store: CriaStore, blobs: any BlobStoring, delay: TimeInterval = launchDelay) -> Task<Void, Never> {
        Task {
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard !Task.isCancelled else { return }
            sweep(store: store, blobs: blobs)
        }
    }
}

extension CriaStore {
    func projectExists(serverId: Int) throws -> Bool {
        try database.writer.read { connection in
            try Bool.fetchOne(connection, sql: """
                SELECT EXISTS(SELECT 1 FROM projects WHERE server_id = ? AND deleted = 0)
                """, arguments: [serverId]) ?? true
        }
    }
}
