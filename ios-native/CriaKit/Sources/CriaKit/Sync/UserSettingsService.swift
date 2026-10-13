import Foundation

/// Saves user settings without overwriting anything another client wrote. Ported from `saveUserSettings` in
/// `src/sync/settingsSync.ts` and `src/api/userSettings.ts`.
///
/// Vikunja v2.7.0+ takes a merge-patch at `PATCH /api/v2/user/settings/general`: only the changed fields go over the
/// wire and the server merges them into what it holds at that moment, so a stale copy is never sent back. Older servers
/// answer 404, 405 or 501 (or a 2xx that is not JSON, such as a proxy's fallback page). There the save falls back to
/// v1: `GET /user` for the server's current settings, apply only the change, POST the whole object. It never falls back
/// to cached settings: if that GET fails, nothing is sent (AGENTS.md: the settings POST is a full-object replace).
///
/// Saves run one at a time either way: the server applies a PATCH as read, merge, write, so two in flight at once
/// could still revert each other.
public actor UserSettingsService {
    private let api: ApiClient
    private let apiV2: ApiClient
    private let resolver: VersionResolver?
    private var unsupportedServers = Set<String>()
    private var tail: Task<Void, Never>?

    /// With a `resolver`, a server it resolves to v1 (older than 2.7.0, or "Force API v1") never gets the PATCH probe.
    public init(api: ApiClient, apiV2: ApiClient, resolver: VersionResolver? = nil) {
        self.api = api
        self.apiV2 = apiV2
        self.resolver = resolver
    }

    public init(session: any SessionProviding, core: HTTPCore = HTTPCore(), resolver: VersionResolver? = nil) {
        self.init(api: ApiClient(session: session, core: core, version: .apiV1),
                  apiV2: ApiClient(session: session, core: core, version: .apiV2), resolver: resolver)
    }

    /// Queues the save behind any in flight and returns when it has been written. A failed save does not block
    /// the ones queued after it.
    public func save(_ change: SettingsChange) async throws {
        let previous = tail
        let work = Task<Void, any Error> {
            await previous?.value
            try await self.run(change)
        }
        tail = Task { _ = await work.result }
        try await work.value
    }

    private func run(_ change: SettingsChange) async throws {
        if try await savedByPatch(change) { return }
        try await saveByFullPost(change)
    }

    static let patchUnsupported: Set<Int> = [404, 405, 501]

    /// The v2 path. False when the server has no settings PATCH (nothing was written).
    private func savedByPatch(_ change: SettingsChange) async throws -> Bool {
        let server = await api.serverBase() ?? ""
        if unsupportedServers.contains(server) { return false }
        if let resolver, await resolver.version(forServer: server, core: api.core) == .apiV1 { return false }
        let response = try await apiV2.mergePatch("/user/settings/general", body: FrontendSettings.mergePatch(change))
        let json = (response.contentType ?? "").lowercased().contains("json")
        // A patch that changes nothing gets an empty 304.
        if response.status == 304 { return true }
        if Self.patchUnsupported.contains(response.status) || (response.isSuccess && !json) {
            unsupportedServers.insert(server)
            return false
        }
        try response.requireSuccess()
        return true
    }

    /// The v1 path: re-read, apply only the change, POST the whole object.
    private func saveByFullPost(_ change: SettingsChange) async throws {
        let response = try await api.send(.get, "/user")
        try response.requireSuccess()
        let user = try JSONDecoder().decode(JSONValue.self, from: response.data)
        let server = user.objectValue?["settings"]?.objectValue
        let body = FrontendSettings.applying(change, to: server)
        try await api.perform(.post, "/user/settings/general", body: body)
    }
}
