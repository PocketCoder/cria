import Foundation

public extension ApiClient {
    /// A project's background image bytes, or nil when it has none. A 404, or a JSON answer where image bytes should
    /// be (the server does that for projects without one), both mean "no background". Ported from
    /// `fetchProjectBackground` in `src/api/projects.ts`.
    func projectBackground(projectId: Int) async throws -> Data? {
        let response = try await send(.get, "/projects/\(projectId)/background")
        if response.status == 404 { return nil }
        try response.requireSuccess()
        guard (response.contentType ?? "").lowercased().hasPrefix("image/") else { return nil }
        return response.data
    }

    /// The user's avatar image bytes, or nil when the server has none to give.
    func avatar(username: String) async throws -> Data? {
        let response = try await avatarResponse(username: username)
        if response.status == 404 { return nil }
        try response.requireSuccess()
        guard (response.contentType ?? "").lowercased().hasPrefix("image/") else { return nil }
        return response.data
    }

    /// Current Vikunja serves avatars at `/avatar/{username}`; older releases at `/{username}/avatar`. The new path
    /// is tried first and a 404 falls back to the old one.
    func avatarResponse(username: String) async throws -> ApiResponse {
        let encoded = username.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? username
        let current = try await send(.get, "/avatar/\(encoded)")
        guard current.status == 404 else { return current }
        return try await send(.get, "/\(encoded)/avatar")
    }

    /// Whether the instance offers a background provider (`upload` or `unsplash`), from `/info`.
    static func hasBackgroundProvider(_ providers: [String], _ name: String) -> Bool {
        providers.contains(name)
    }
}

/// A project's background image cached in the blob store so it shows offline and straight after launch. Online, the
/// server wins: its image replaces the cached bytes and "no background" deletes them. If the server cannot be reached
/// the cached copy is used. Ported from `src/lib/projectBackgroundCache.ts` and `clearBackgroundCache.ts`.
public struct ProjectBackgroundCache: Sendable {
    private let blobs: any BlobStoring

    public init(blobs: any BlobStoring) {
        self.blobs = blobs
    }

    /// `fetch` returns the server's bytes, nil for "no background", or throws when unreachable.
    public func load(serverId: Int, online: Bool, fetch: @Sendable () async throws -> Data?) async -> Data? {
        let blobId = BlobIds.projectBackground(serverId: serverId)
        if online {
            do {
                if let fresh = try await fetch() {
                    try? blobs.write(blobId, fresh)
                    return fresh
                }
                try? blobs.delete(blobId)
                return nil
            } catch {
                // Fall through to the cache.
            }
        }
        return try? blobs.read(blobId)
    }

    /// Drops every cached background, e.g. from Settings or on sign-out. Never throws. Returns how many were removed.
    @discardableResult
    public func clear() -> Int {
        guard let entries = try? blobs.list() else { return 0 }
        var removed = 0
        for entry in entries where BlobIds.isCache(entry.id) {
            if (try? blobs.delete(entry.id)) != nil { removed += 1 }
        }
        return removed
    }

    /// Number of cached backgrounds, for the Settings storage row.
    public func count() -> Int {
        ((try? blobs.list()) ?? []).filter { BlobIds.isCache($0.id) }.count
    }
}
