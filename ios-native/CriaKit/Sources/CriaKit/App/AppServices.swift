import Foundation

/// Everything the signed-in app needs, built once per session: the local store, the sync coordinator and the
/// outbox executors. Ported from the wiring in `src/App.tsx` and `src/sync/`.
public final class AppServices: Sendable {
    public let store: CriaStore
    public let coordinator: SyncCoordinator
    public let api: ApiClient
    /// Saves general settings (S-70). Nil in tests that do not exercise settings.
    public let settings: UserSettingsService?
    public let backgrounds: ProjectBackgroundCache
    /// Hears the share extension and App Intents, which write to the shared database from other processes.
    private let signal: CrossProcessSignal
    let blobs: FileBlobStore

    public init(api: ApiClient, store: CriaStore, blobDirectory: URL, settings: UserSettingsService? = nil) async {
        self.api = api
        self.store = store
        self.settings = settings
        let fileBlobs = FileBlobStore(directory: blobDirectory)
        blobs = fileBlobs
        backgrounds = ProjectBackgroundCache(blobs: fileBlobs)
        let drainer = OutboxDrainer(api: api, store: store)
        await drainer.registerStandardExecutors()
        await drainer.registerAttachmentExecutor(blobs: fileBlobs)
        coordinator = SyncCoordinator(puller: Puller(api: api, store: store), drainer: drainer, store: store)
        signal = CrossProcessSignal { [store] in
            // New rows came from another process: refresh the screens and push them.
            for kind in [ChangeKind.tasks, .projects, .outbox] { store.bus.notify(kind) }
        }
    }

    public func start() async {
        await coordinator.start()
        await coordinator.forceSync()
        announcePull()
        await applyAccountDefaults()
    }

    /// Tells the extensions and intents the default project changed in Settings, without waiting for the next launch.
    public func rememberDefaultProject(serverId: Int) {
        try? store.rememberCaptureProject(serverId: serverId > 0 ? serverId : nil)
    }

    /// One read of the user, applied where it is needed: the default project (extensions and intents file new tasks
    /// there without asking the server), the Quick Add Magic mode, week start and timezone (so they apply from the
    /// first launch, not only after Settings is opened). A failed read (offline) changes nothing.
    func applyAccountDefaults() async {
        guard let user: JSONValue = try? await api.get("/user") else { return }
        let projectId = user["settings"]?["default_project_id"]?.intValue
        try? store.rememberCaptureProject(serverId: projectId.flatMap { $0 > 0 ? $0 : nil })
        let general = GeneralSettings(user: user)
        UserDefaults.standard.set(general.quickAddMagicMode, forKey: GeneralSettings.quickAddDefaultsKey)
        // The Upcoming week strip, the weekly round-up and pushed all-day dates read these without opening Settings.
        UserDefaults.standard.set(general.weekStart, forKey: GeneralSettings.weekStartDefaultsKey)
        // Only a zone the server really holds; an unset one keeps the device's.
        if !(user["settings"]?["timezone"]?.stringValue ?? "").isEmpty {
            UserDefaults.standard.set(general.timezone, forKey: GeneralSettings.timezoneDefaultsKey)
        }
    }

    public func stop() async {
        await coordinator.stop()
    }

    /// Pulls write silently, so tell observers once a cycle ends.
    public func announcePull() {
        for kind in [ChangeKind.projects, .tasks, .labels, .views, .savedFilters] {
            store.bus.notify(kind)
        }
    }

    public func refresh() async {
        await coordinator.forceSync()
        announcePull()
    }

    /// The user's default (inbox) project server id, or nil when offline or unset.
    public func defaultProjectServerId() async -> Int? {
        guard let id = (try? await api.currentUser())?.settings?.defaultProjectId, id > 0 else { return nil }
        return id
    }

    // MARK: Comment reactions

    /// Toggles the current user's reaction: optimistic local write, then a fire-and-forget API call.
    /// Like the web client, a failure is corrected by the next pull. Needs a server user and a pushed comment.
    public func toggleCommentReaction(commentLocalId: String, emoji: String) async {
        guard let user = try? await api.currentUser(),
              let comment = try? store.comment(localId: commentLocalId), comment.serverId != 0,
              let added = try? store.toggleCommentReaction(
                  commentLocalId: commentLocalId,
                  emoji: emoji,
                  user: ReactionUserRecord(id: user.id, name: user.name, username: user.username)
              ) else { return }
        if added {
            try? await api.addCommentReaction(commentId: comment.serverId, emoji: emoji)
        } else {
            try? await api.removeCommentReaction(commentId: comment.serverId, emoji: emoji)
        }
    }

    // MARK: Saved filters (online only, like the web client)

    public func createSavedFilter(title: String, description: String, query: String, includeNulls: Bool) async throws {
        _ = try await api.createSavedFilter(savedFilterBody(title, description, query, includeNulls))
        await refresh()
    }

    public func updateSavedFilter(serverId: Int, title: String, description: String, query: String, includeNulls: Bool) async throws {
        _ = try await api.updateSavedFilter(id: serverId, savedFilterBody(title, description, query, includeNulls))
        await refresh()
    }

    public func deleteSavedFilter(serverId: Int) async throws {
        try await api.deleteSavedFilter(id: serverId)
        try store.deleteSavedFilter(serverId: serverId)
        await refresh()
    }

    private func savedFilterBody(_ title: String, _ description: String, _ query: String, _ includeNulls: Bool) -> JSONBody {
        let filters: JSONBody = [
            "filter": .string(query.trimmingCharacters(in: .whitespacesAndNewlines)),
            "filter_include_nulls": .bool(includeNulls)
        ]
        var body: JSONBody = ["title": .string(title.trimmingCharacters(in: .whitespacesAndNewlines)), "filters": .object(filters)]
        let note = description.trimmingCharacters(in: .whitespacesAndNewlines)
        if !note.isEmpty { body["description"] = .string(note) }
        return body
    }
}
