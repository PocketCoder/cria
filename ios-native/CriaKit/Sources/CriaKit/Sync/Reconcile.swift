import Foundation
import GRDB

/// Removes local rows the server no longer has, and refreshes every task from the same full list. Ported from
/// `src/sync/reconcile.ts`. A row with a pending local edit (`dirty = 1`) is never removed.
extension Puller {
    public func reconcileDeletions() async throws {
        // Rows touched after this moment were created or pushed while the lists were being fetched, so the lists
        // cannot vouch for them either way.
        let started = isoNow()
        // Rows stuck dirty or deleted with nothing queued would never take the server's copy again.
        try store.healOrphanedSyncFlags()
        // Projects first, so the tasks below find theirs (and a project revived above is filled in again).
        try await pullProjects()
        let raws = try await api.fetchAllPages("/tasks")
        let truncated = raws.count >= defaultPerPage * maxPages
        // The delta pull only sees tasks whose `updated` moved, and label, assignee, position and unarchive changes
        // do not move it. This list is fetched anyway, so store it: every task is brought up to date here.
        try await storeTaskPages(raws, stamp: !truncated)
        // `/tasks` leaves archived projects out, so their tasks come from each project's own view listing.
        let archivedIds = await pullArchivedProjectTasks()
        await refreshViewsAndBuckets()
        if !truncated {
            try store.removeTasksMissingOnServer(serverIds: Self.ids(in: raws).union(archivedIds), fetchedSince: started)
        }
        // Archived included, or an archived project would look deleted and be removed here.
        let projects = try await serverIds("/projects", query: ["is_archived": "true"])
        if !projects.truncated { try store.removeProjectsMissingOnServer(serverIds: projects.ids, fetchedSince: started) }
        store.bus.notify(.tasks)
        store.bus.notify(.projects)
        store.bus.notify(.views)
    }

    /// The task half of the reconcile only: the full task list, stored, then local tasks the server no longer has
    /// removed. Deletions never show in a delta pull (Vikunja keeps no tombstones), so a manual refresh and every few
    /// periodic ticks run this to carry a delete from another device across without waiting for the full reconcile.
    public func reconcileTaskDeletions() async throws {
        let started = isoNow()
        let raws = try await api.fetchAllPages("/tasks")
        guard raws.count < defaultPerPage * maxPages else { return }
        try await storeTaskPages(raws, stamp: true)
        // Archived projects' tasks are not in this list; the removal leaves archived projects alone.
        try store.removeTasksMissingOnServer(serverIds: Self.ids(in: raws), fetchedSince: started)
        store.bus.notify(.tasks)
    }

    /// Re-reads every project's views and the columns of its kanban views in full, which also drops the ones the
    /// server no longer has (rows with an op queued or dead-lettered are spared). A project that fails is skipped.
    /// Comments are not repaired here: no list endpoint carries them, so it would take a request per task. They are
    /// refreshed when a task is opened and by the task's own expand on push.
    private func refreshViewsAndBuckets() async {
        for project in (try? store.syncedProjects()) ?? [] where project.serverId > 0 {
            _ = try? await pullViewsAndBuckets(projectLocalId: project.localId)
        }
    }

    /// Stores the tasks of every locally known archived project and returns their server ids. One views request (only
    /// when no usable view is stored yet) and the task pages per archived project. A project that fails is skipped:
    /// its tasks are kept anyway, because the removal below never touches archived projects.
    private func pullArchivedProjectTasks() async -> Set<Int> {
        var ids = Set<Int>()
        for project in (try? store.archivedProjects()) ?? [] {
            do {
                var view = try store.unfilteredTaskView(projectLocalId: project.localId)
                if view == nil {
                    _ = try await pullViews(projectServerId: project.serverId, projectLocalId: project.localId)
                    view = try store.unfilteredTaskView(projectLocalId: project.localId)
                }
                guard let view else { continue }
                let raws = try await api.fetchAllPages("/projects/\(project.serverId)/views/\(view)/tasks")
                try await storeTaskPages(raws, stamp: false)
                ids.formUnion(Self.ids(in: raws))
            } catch {
                continue
            }
        }
        return ids
    }

    static func ids(in raws: [Data]) -> Set<Int> {
        var ids = Set<Int>()
        for data in raws {
            if let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let id = object["id"] as? Int {
                ids.insert(id)
            }
        }
        return ids
    }

    /// `truncated` means the page cap was hit: the list is incomplete, so nothing may be deleted on its evidence.
    private func serverIds(
        _ path: String, query: [String: String] = [:]
    ) async throws -> (ids: Set<Int>, truncated: Bool) {
        let raws = try await api.fetchAllPages(path, query: query)
        return (Self.ids(in: raws), raws.count >= defaultPerPage * maxPages)
    }
}

extension CriaStore {
    /// Live archived projects with a server id.
    func archivedProjects() throws -> [(localId: String, serverId: Int)] {
        try database.writer.read { connection in
            try Row.fetchAll(connection, sql: """
                SELECT local_id, server_id FROM projects WHERE is_archived = 1 AND server_id > 0 AND deleted = 0
                """).map { (localId: $0["local_id"], serverId: $0["server_id"]) }
        }
    }

    /// Server id of a list or table view with no filter of its own, which lists every task of the project. A kanban
    /// view answers with buckets, and Vikunja's default list view hides done tasks, so neither will do.
    func unfilteredTaskView(projectLocalId: String) throws -> Int? {
        try database.writer.read { connection in
            try Int.fetchOne(connection, sql: """
                SELECT server_id FROM project_views
                 WHERE project_local_id = ? AND deleted = 0 AND server_id IS NOT NULL
                   AND view_kind IN ('list', 'table') AND (filter IS NULL OR filter = '')
                 ORDER BY CASE view_kind WHEN 'table' THEN 0 ELSE 1 END, position LIMIT 1
                """, arguments: [projectLocalId])
        }
    }

    static func deleteTaskCascade(_ connection: Database, localId: String) throws {
        // task_comments references tasks with no ON DELETE clause (migration 013), so its rows must go first or the
        // task delete fails the foreign key check.
        for table in ["task_labels", "task_buckets", "task_reminders", "task_assignees", "task_comments"] {
            try connection.execute(sql: "DELETE FROM \(table) WHERE task_local_id = ?", arguments: [localId])
        }
        try connection.execute(
            sql: "DELETE FROM task_relations WHERE task_local_id = ? OR other_task_local_id = ?", arguments: [localId, localId]
        )
        try connection.execute(sql: "DELETE FROM tasks WHERE local_id = ?", arguments: [localId])
    }

    /// Comments of every task in a project, before the project (and through ON DELETE CASCADE, its tasks) goes.
    static func deleteCommentsOfProject(_ connection: Database, projectLocalId: String) throws {
        try connection.execute(sql: """
            DELETE FROM task_comments WHERE task_local_id IN (SELECT local_id FROM tasks WHERE project_local_id = ?)
            """, arguments: [projectLocalId])
    }

    /// Tasks of archived projects are kept: Vikunja's `/tasks` leaves archived projects out, so they are never in
    /// the list, and removing them would lose them here until they were next edited.
    func removeTasksMissingOnServer(serverIds: Set<Int>, fetchedSince: String? = nil) throws {
        try database.writer.write { connection in
            let rows = try Row.fetchAll(connection, sql: """
                SELECT local_id, server_id, dirty, synced_at,
                       EXISTS(SELECT 1 FROM outbox WHERE entity_type = 'task' AND entity_local_id = tasks.local_id) AS queued
                  FROM tasks WHERE server_id IS NOT NULL
                   AND project_local_id NOT IN (SELECT local_id FROM projects WHERE is_archived = 1)
                """)
            for row in rows {
                let serverId: Int = row["server_id"]
                let dirty: Bool = row["dirty"]
                let queued: Bool = row["queued"]
                let syncedAt: String? = row["synced_at"]
                if serverIds.contains(serverId) || dirty || queued || CriaStore.touched(syncedAt, since: fetchedSince) { continue }
                try CriaStore.deleteTaskCascade(connection, localId: row["local_id"])
            }
        }
    }

    /// True when a row was written after `since` (timestamps have one-second resolution, so the same second does not
    /// count), so a list fetched from `since` onwards cannot judge it.
    static func touched(_ syncedAt: String?, since: String?) -> Bool {
        guard let since, let syncedAt else { return false }
        return syncedAt > since
    }

    func removeProjectsMissingOnServer(serverIds: Set<Int>, fetchedSince: String? = nil) throws {
        try database.writer.write { connection in
            let rows = try Row.fetchAll(connection, sql: """
                SELECT local_id, server_id, dirty, synced_at,
                       EXISTS(SELECT 1 FROM outbox WHERE entity_type = 'project' AND entity_local_id = projects.local_id) AS queued
                  FROM projects WHERE server_id IS NOT NULL
                """)
            for row in rows {
                let serverId: Int = row["server_id"]
                let dirty: Bool = row["dirty"]
                let queued: Bool = row["queued"]
                let syncedAt: String? = row["synced_at"]
                if serverIds.contains(serverId) || dirty || queued || CriaStore.touched(syncedAt, since: fetchedSince) { continue }
                let localId: String = row["local_id"]
                let children = try String.fetchAll(
                    connection, sql: "SELECT local_id FROM tasks WHERE project_local_id = ? AND dirty = 0", arguments: [localId]
                )
                for child in children {
                    try CriaStore.deleteTaskCascade(connection, localId: child)
                }
                try CriaStore.deleteCommentsOfProject(connection, projectLocalId: localId)
                try connection.execute(sql: "DELETE FROM projects WHERE local_id = ?", arguments: [localId])
            }
        }
    }
}
