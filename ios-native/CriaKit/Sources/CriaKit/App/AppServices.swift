import Foundation

/// Everything the signed-in app needs, built once per session: the local store, the sync coordinator and the
/// outbox executors. Ported from the wiring in `src/App.tsx` and `src/sync/`.
public final class AppServices: Sendable {
    public let store: CriaStore
    public let coordinator: SyncCoordinator
    public let api: ApiClient
    let blobs: FileBlobStore

    public init(api: ApiClient, store: CriaStore, blobDirectory: URL) async {
        self.api = api
        self.store = store
        let fileBlobs = FileBlobStore(directory: blobDirectory)
        blobs = fileBlobs
        let drainer = OutboxDrainer(api: api, store: store)
        await drainer.registerStandardExecutors()
        await drainer.registerAttachmentExecutor(blobs: fileBlobs)
        coordinator = SyncCoordinator(puller: Puller(api: api, store: store), drainer: drainer, store: store)
    }

    public func start() async {
        await coordinator.start()
        await coordinator.forceSync()
        announcePull()
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
