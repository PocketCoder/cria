import Foundation

/// Everything the signed-in app needs, built once per session: the local store, the sync coordinator and the
/// outbox executors. Ported from the wiring in `src/App.tsx` and `src/sync/`.
public final class AppServices: Sendable {
    public let store: CriaStore
    public let coordinator: SyncCoordinator
    public let api: ApiClient

    public init(api: ApiClient, store: CriaStore, blobDirectory: URL) async {
        self.api = api
        self.store = store
        let drainer = OutboxDrainer(api: api, store: store)
        await drainer.registerStandardExecutors()
        await drainer.registerAttachmentExecutor(blobs: FileBlobStore(directory: blobDirectory))
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
}
