import CoreSpotlight
import CriaKit
import Foundation
import WidgetKit

/// Things that follow data changes: past reminders are cleared, the Today widget reloads and Spotlight re-indexes open
/// tasks. Runs for the life of the signed-in shell.
enum SyncSideEffects {
    static func run(services: AppServices) async {
        try? services.store.clearPastReminders()
        await refresh(services.store)
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await afterSyncs(services) }
            group.addTask { await afterTaskChanges(services.store) }
        }
    }

    /// When a sync cycle ends.
    private static func afterSyncs(_ services: AppServices) async {
        var wasSyncing = false
        for await status in services.coordinator.status.subscribe() {
            if wasSyncing && !status.isSyncing {
                // A reminder that has gone off is done with; deleting it here also drops it from Vikunja.
                try? services.store.clearPastReminders()
                await refresh(services.store)
            }
            wasSyncing = status.isSyncing
        }
    }

    /// Local edits and announced pulls, a little after the last one so a burst reloads once.
    private static func afterTaskChanges(_ store: CriaStore) async {
        var pending: Task<Void, Never>?
        for await kind in store.bus.subscribe() where kind == .tasks {
            pending?.cancel()
            pending = Task {
                try? await Task.sleep(for: .seconds(2))
                if !Task.isCancelled { await refresh(store) }
            }
        }
    }

    static func refresh(_ store: CriaStore) async {
        WidgetCenter.shared.reloadAllTimelines()
        await SpotlightIndexer.reindex(store: store)
    }
}

/// Open tasks in system search. Tapping a result arrives as a `cria://task/{localId}` link.
enum SpotlightIndexer {
    static let domain = "io.cria.app.tasks"
    private static let limit = 500
    /// What was last indexed. Syncs and task changes both ask for a re-index; when nothing differs, skip the delete
    /// and re-add of up to 500 items.
    private nonisolated(unsafe) static var lastFingerprint: Int?

    /// Removes every indexed task, e.g. on sign-out.
    static func clear() async {
        guard CSSearchableIndex.isIndexingAvailable() else { return }
        lastFingerprint = nil
        try? await CSSearchableIndex.default().deleteSearchableItems(withDomainIdentifiers: [domain])
    }

    static func reindex(store: CriaStore) async {
        guard CSSearchableIndex.isIndexingAvailable(),
              let tasks = try? store.tasks(matching: TaskQuery(includeDone: false)) else { return }
        let fingerprint = tasks.prefix(limit).map { "\($0.localId)|\($0.title)|\($0.dueDate ?? "")" }.joined().hashValue
        if fingerprint == lastFingerprint { return }
        lastFingerprint = fingerprint
        let items = tasks.prefix(limit).map { task -> CSSearchableItem in
            let attributes = CSSearchableItemAttributeSet(contentType: .text)
            attributes.title = task.title
            attributes.contentDescription = task.dueDate.map { "Due \($0.prefix(10))" }
            return CSSearchableItem(uniqueIdentifier: task.localId, domainIdentifier: domain, attributeSet: attributes)
        }
        let index = CSSearchableIndex.default()
        try? await index.deleteSearchableItems(withDomainIdentifiers: [domain])
        try? await index.indexSearchableItems(Array(items))
    }
}
