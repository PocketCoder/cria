import Foundation

public struct BlobEntry: Equatable, Sendable {
    public let id: String
    /// Last write time; nil when the file system does not say.
    public let modified: Date?

    public init(id: String, modified: Date?) {
        self.id = id
        self.modified = modified
    }
}

public struct BlobMissingError: Error, Equatable, Sendable {
    public let id: String
}

public struct BlobIdError: Error, Equatable, Sendable {
    public let id: String
}

/// Side-store for queued upload bytes, so the SQLite file stays small. Replaces `blobs.rs` in the Tauri app.
public protocol BlobStoring: Sendable {
    func write(_ id: String, _ data: Data) throws
    /// Throws `BlobMissingError` when there is no such blob.
    func read(_ id: String) throws -> Data
    /// Deleting a missing blob is not an error.
    func delete(_ id: String) throws
    func list() throws -> [BlobEntry]
}

/// One file per blob under a directory (the app uses Application Support, never the purgeable Caches).
public struct FileBlobStore: BlobStoring {
    public let directory: URL

    public init(directory: URL) {
        self.directory = directory
    }

    /// Ids are file names. Anything that could leave the directory is rejected.
    func url(for id: String) throws -> URL {
        guard !id.isEmpty, id.count <= 200, !id.contains("/"), !id.contains("\\"), id != ".", id != "..", !id.contains("\0") else {
            throw BlobIdError(id: id)
        }
        return directory.appendingPathComponent(id, isDirectory: false)
    }

    public func write(_ id: String, _ data: Data) throws {
        let target = try url(for: id)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try data.write(to: target, options: .atomic)
    }

    public func read(_ id: String) throws -> Data {
        let target = try url(for: id)
        guard FileManager.default.fileExists(atPath: target.path) else { throw BlobMissingError(id: id) }
        return try Data(contentsOf: target)
    }

    public func delete(_ id: String) throws {
        let target = try url(for: id)
        guard FileManager.default.fileExists(atPath: target.path) else { return }
        try FileManager.default.removeItem(at: target)
    }

    public func list() throws -> [BlobEntry] {
        guard FileManager.default.fileExists(atPath: directory.path) else { return [] }
        let urls = try FileManager.default.contentsOfDirectory(
            at: directory, includingPropertiesForKeys: [.contentModificationDateKey, .isRegularFileKey]
        )
        return urls.compactMap { url in
            let values = try? url.resourceValues(forKeys: [.contentModificationDateKey, .isRegularFileKey])
            guard values?.isRegularFile == true else { return nil }
            return BlobEntry(id: url.lastPathComponent, modified: values?.contentModificationDate)
        }
    }
}

/// Blob ids that are caches, not queued uploads. The sweep must leave them alone.
public enum BlobIds {
    public static let projectBackgroundPrefix = "project-bg-"

    public static func projectBackground(serverId: Int) -> String { "\(projectBackgroundPrefix)\(serverId)" }

    public static func isCache(_ id: String) -> Bool { id.hasPrefix(projectBackgroundPrefix) }

    public static func projectServerId(ofBlob id: String) -> Int? {
        guard isCache(id), let value = Int(id.dropFirst(projectBackgroundPrefix.count)), value > 0 else { return nil }
        return value
    }
}
