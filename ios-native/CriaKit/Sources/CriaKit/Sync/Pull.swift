import Foundation
import GRDB

/// Server-to-local pull. Ported from `src/sync/pull.ts`. Every write here is a silent upsert: a pull must
/// never announce changes, or the query that owns it refetches forever (AGENTS.md).
public final class Puller: Sendable {
    let api: ApiClient
    let store: CriaStore
    let flights = SingleFlight()
    /// Overlap subtracted from the task watermark (15 hours). Vikunja before the "resolve absolute date filters in
    /// UTC" fix (#3181) read `updated > '<UTC time>'` as a wall-clock time in the server's own timezone, while the
    /// column holds UTC: on a server east of UTC (Europe/London in summer) every task changed within the offset of
    /// the watermark was left out, and once the watermark moved on it was never fetched. New tasks made on another
    /// device were the visible symptom. Timezones run to UTC+14, so 15 hours covers any server, plus clock skew.
    static let deltaOverlap: TimeInterval = 15 * 60 * 60

    public init(api: ApiClient, store: CriaStore) {
        self.api = api
        self.store = store
    }

    // MARK: Projects and labels (S-30)

    @discardableResult
    public func pullProjects() async throws -> Int {
        try await flights.run("pullProjects") { [self] in
            // Archived projects are left out by default; they are listed under Archived projects, so ask for them.
            let started = isoNow()
            let raws = try await api.fetchAllPages("/projects", query: ["is_archived": "true"])
            var collected: [(payload: ProjectResponse, raw: String)] = []
            for data in raws {
                guard let payload = try? JSONDecoder().decode(ProjectResponse.self, from: data) else { continue }
                if payload.id == -1 { continue }  // the Favorites pseudo-project
                collected.append((payload, String(bytes: data, encoding: .utf8) ?? ""))
            }
            for item in collected {
                try store.upsertProjectFromServer(item.payload, rawJSON: item.raw)
            }
            // Second pass links children whose parent arrived later in the list.
            for item in collected where (item.payload.parentProjectId ?? 0) > 0 {
                try store.upsertProjectFromServer(item.payload, rawJSON: item.raw)
            }
            // The full list every cycle, so a project deleted elsewhere goes here too (not when the list was cut short).
            if raws.count < defaultPerPage * maxPages {
                // Ids from the raw list: a project this build cannot decode is still on the server and must stay.
                try store.removeProjectsMissingOnServer(serverIds: Self.ids(in: raws), fetchedSince: started)
            }
            try store.stampSync(.projects)
            return collected.count
        }
    }

    // MARK: Saved filters

    /// Refreshes saved filters behind pseudo-projects (`server_id < -1`, filter id `-server_id - 1`).
    /// Only a confirmed 404 drops a filter; a transient failure keeps it, so a network blip cannot prune the cache.
    @discardableResult
    public func pullSavedFilters() async throws -> Int {
        try await flights.run("pullSavedFilters") { [self] in
            let serverIds = try store.savedFilterProjectServerIds()
            var keep = Set(serverIds.map { -$0 - 1 })
            for serverId in serverIds {
                let filterId = -serverId - 1
                guard let response = try? await api.send(.get, "/filters/\(filterId)") else { continue }
                if response.status == 404 {
                    try store.deleteProjectRow(serverId: serverId)
                    keep.remove(filterId)
                    continue
                }
                guard response.isSuccess,
                      let payload = try? JSONDecoder().decode(SavedFilterResponse.self, from: response.data) else { continue }
                try store.upsertSavedFilterFromServer(payload)
            }
            try store.pruneSavedFilters(keeping: Array(keep))
            return keep.count
        }
    }

    // MARK: Tasks (S-31)

    /// `updated > '<watermark - 5 min>'`, or nil on the first pull or while no tasks are stored
    /// (migration 017 resets the watermark, and an empty table needs a full pull regardless).
    func tasksDeltaFilter() throws -> String? {
        guard let last = try store.syncStamp(.tasks), try store.liveTaskCount() > 0 else { return nil }
        guard let date = try? Date(last, strategy: .iso8601) else { return "updated > '\(last)'" }
        let since = date.addingTimeInterval(-Puller.deltaOverlap).formatted(.iso8601)
        return "updated > '\(since)'"
    }

    @discardableResult
    public func pullTasks(projectServerId: Int) async throws -> Int {
        try await flights.run("pullTasksForProject:\(projectServerId)") { [self] in
            let delta = try tasksDeltaFilter()
            let filter = delta.map { "project_id = \(projectServerId) && \($0)" } ?? "project_id = \(projectServerId)"
            return try await pullTaskPages(filter: filter, stamp: false)
        }
    }

    @discardableResult
    public func pullAllTasks() async throws -> Int {
        try await flights.run("pullAllTasks") { [self] in
            try await pullTaskPages(filter: try tasksDeltaFilter(), stamp: true)
        }
    }

    private func pullTaskPages(filter: String?, stamp: Bool) async throws -> Int {
        let query = filter.map { ["filter": $0] } ?? [:]
        let raws = try await api.fetchAllPages("/tasks", query: query)
        return try await storeTaskPages(raws, stamp: stamp)
    }

    /// Stores listed tasks with their relations; with `stamp`, moves the task watermark when nothing was skipped
    /// (or regardless, without `holdForSkipped`: a full list fetches a skipped task again anyway).
    @discardableResult
    func storeTaskPages(
        _ raws: [Data], stamp: Bool, clearMissingRelations: Bool = false, holdForSkipped: Bool = true
    ) async throws -> Int {
        var decoded: [(task: TaskResponse, raw: Data)] = []
        for data in raws {
            guard let task = try? JSONDecoder().decode(TaskResponse.self, from: data) else { continue }
            decoded.append((task, data))
        }
        // One transaction per page of tasks instead of about seven per task: far fewer commits and fsyncs on a large
        // account. A task that fails still stops the step, as before; its page rolls back and is retried next cycle.
        var skipped = 0
        for start in stride(from: 0, to: decoded.count, by: Self.writeBatchSize) {
            let batch = Array(decoded[start..<min(start + Self.writeBatchSize, decoded.count)])
            skipped += try await store.database.writer.write { connection in
                var missing = 0
                for item in batch {
                    let stored = try self.upsertTaskWithRelations(
                        item.task, raw: item.raw, clearMissingRelations: clearMissingRelations, in: connection
                    )
                    // Only a missing project counts: a row kept hidden by a queued project delete is not a task
                    // the next cycle could fetch, and counting it would hold the watermark back for as long.
                    if !stored, try !CriaStore.projectIsStored(connection, serverId: item.task.projectId) { missing += 1 }
                }
                return missing
            }
        }
        // A task whose project is not stored yet (a projects step that failed this cycle, or a project made
        // elsewhere moments ago) was skipped. Stamping now would put it behind the delta window for good, so it
        // never arrived; leaving the watermark makes the next cycle fetch it again once its project is here.
        if stamp, skipped == 0 || !holdForSkipped, let mark = Self.watermark(for: decoded.map(\.task)) {
            try store.stampSync(.tasks, at: mark)
        }
        return decoded.count
    }

    /// The newest server `updated` among the listed tasks, never later than now. The server's clock, not this
    /// device's: a device clock running ahead by more than the overlap would otherwise skip other devices' edits.
    /// Nil when no task carries a time (an empty delta), so the watermark stays where it was.
    static func watermark(for tasks: [TaskResponse], now: Date = Date()) -> Date? {
        let newest = tasks.compactMap { $0.updated.flatMap(DueDates.parse) }.max()
        return newest.map { min($0, now) }
    }

    /// Tasks written per transaction: the server's page size.
    static let writeBatchSize = 50

    /// Re-reads one task with comments (after a push, or when a detail screen opens). Announces `tasks`:
    /// this is a user-triggered refresh, not part of the pull loop.
    public func refetchTask(serverId: Int) async {
        guard let response = try? await api.send(.get, "/tasks/\(serverId)", query: ["expand": "comments"]),
              response.isSuccess,
              let task = try? JSONDecoder().decode(TaskResponse.self, from: response.data) else { return }
        guard (try? upsertTaskWithRelations(task, raw: response.data, clearMissingRelations: true)) != nil else { return }
        store.bus.notify(.tasks)
    }

    /// Replaces a task's comments from the server. Silent; the caller decides whether to announce.
    public func pullComments(taskLocalId: String) async {
        guard let serverId = try? store.taskServerId(localId: taskLocalId),
              let response = try? await api.send(.get, "/tasks/\(serverId)", query: ["expand": "comments"]),
              response.isSuccess,
              let task = try? JSONDecoder().decode(TaskResponse.self, from: response.data),
              let comments = task.comments else { return }
        try? store.replaceTaskCommentsFromServer(taskLocalId: taskLocalId, comments)
    }

    /// False when the task was not stored because its project is not synced yet.
    @discardableResult
    func upsertTaskWithRelations(
        _ task: TaskResponse, raw: Data, clearMissingRelations: Bool = false, in held: Database? = nil
    ) throws -> Bool {
        let json = String(bytes: raw, encoding: .utf8) ?? ""
        guard let taskLocalId = try store.upsertTaskFromServer(task, rawJSON: json, in: held) else { return false }
        if task.labels != nil {
            let rawLabels = rawElements(raw, key: "labels")
            let items: [(payload: LabelResponse, rawJSON: String)] = rawLabels.compactMap { data in
                guard let payload = try? JSONDecoder().decode(LabelResponse.self, from: data) else { return nil }
                return (payload, String(bytes: data, encoding: .utf8) ?? "")
            }
            try store.replaceTaskLabelsFromServer(taskLocalId: taskLocalId, items, in: held)
        }
        if let assignees = task.assignees {
            try store.replaceTaskAssigneesFromServer(taskLocalId: taskLocalId, assignees, in: held)
        }
        if let attachments = task.attachments {
            try store.replaceTaskAttachmentsFromServer(taskLocalId: taskLocalId, attachments, in: held)
        }
        if let reminders = task.reminders {
            try store.replaceRemindersFromServer(taskLocalId: taskLocalId, reminders, in: held)
        }
        if let comments = task.comments {
            try store.replaceTaskCommentsFromServer(taskLocalId: taskLocalId, comments, in: held)
        }
        if let related = task.relatedTasks {
            let nonEmpty = related.filter { !$0.value.isEmpty }
            if clearMissingRelations || !nonEmpty.isEmpty {
                try store.replaceRelationsFromServer(taskLocalId: taskLocalId, nonEmpty, in: held)
            }
        }
        return true
    }

    // MARK: Views and buckets

    @discardableResult
    public func pullAllViews() async throws -> Int {
        try await flights.run("pullAllViews") { [self] in
            var total = 0
            for project in try store.syncedProjects() {
                do {
                    total += try await pullViews(projectServerId: project.serverId, projectLocalId: project.localId)
                } catch {
                    continue  // one project failing must not block the rest
                }
            }
            try store.stampSync(.views)
            return total
        }
    }

    /// Pulls a project's views, then the buckets of its kanban views.
    @discardableResult
    public func pullViewsAndBuckets(projectLocalId: String) async throws -> Int {
        try await flights.run("pullViewsForProjectLocal:\(projectLocalId)") { [self] in
            guard let serverId = try store.projectServerId(localId: projectLocalId) else { return 0 }
            let count = try await pullViews(projectServerId: serverId, projectLocalId: projectLocalId)
            for view in try store.syncedKanbanViews(projectLocalId: projectLocalId) {
                _ = try? await pullBuckets(projectServerId: serverId, viewServerId: view.viewServerId, viewLocalId: view.viewLocalId)
            }
            return count
        }
    }

    func pullViews(projectServerId: Int, projectLocalId: String) async throws -> Int {
        let raws = try await api.fetchAllPages("/projects/\(projectServerId)/views")
        let items: [(payload: ViewResponse, rawJSON: String)] = raws.compactMap { data in
            guard let payload = try? JSONDecoder().decode(ViewResponse.self, from: data) else { return nil }
            return (payload, String(bytes: data, encoding: .utf8) ?? "")
        }
        try store.replaceViewsForProjectFromServer(projectLocalId: projectLocalId, items)
        return items.count
    }

    @discardableResult
    public func pullAllBuckets() async throws -> Int {
        try await flights.run("pullAllBuckets") { [self] in
            var total = 0
            for view in try store.syncedKanbanViews() {
                total += (try? await pullBuckets(
                    projectServerId: view.projectServerId, viewServerId: view.viewServerId, viewLocalId: view.viewLocalId
                )) ?? 0
            }
            try store.stampSync(.buckets)
            return total
        }
    }

    func pullBuckets(projectServerId: Int, viewServerId: Int, viewLocalId: String) async throws -> Int {
        let raws = try await api.fetchAllPages("/projects/\(projectServerId)/views/\(viewServerId)/buckets")
        let items: [(payload: BucketResponse, rawJSON: String)] = raws.compactMap { data in
            guard let payload = try? JSONDecoder().decode(BucketResponse.self, from: data) else { return nil }
            return (payload, String(bytes: data, encoding: .utf8) ?? "")
        }
        try store.replaceBucketsForViewFromServer(viewLocalId: viewLocalId, items)
        try await pullBucketAssignments(projectServerId: projectServerId, viewServerId: viewServerId, viewLocalId: viewLocalId)
        return items.count
    }

    /// Which task sits in which column, as the server has it, so a card moved in Vikunja-web or on another device
    /// moves here too. One listing per column (`filter=bucket_id = N`, paged), as Vikunja-web loads a column; a
    /// filter-mode board has no stored columns and is skipped. If any column fails, nothing is replaced.
    func pullBucketAssignments(projectServerId: Int, viewServerId: Int, viewLocalId: String) async throws {
        let buckets = try store.bucketServerIds(viewLocalId: viewLocalId)
        guard !buckets.isEmpty else { return }
        var assignments: [BucketAssignment] = []
        for bucketServerId in buckets {
            let raws = try await api.fetchAllPages(
                "/projects/\(projectServerId)/views/\(viewServerId)/tasks", query: ["filter": "bucket_id = \(bucketServerId)"]
            )
            for data in raws {
                guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let taskId = object["id"] as? Int else { continue }
                assignments.append(BucketAssignment(
                    taskServerId: taskId, bucketServerId: bucketServerId, position: object["position"] as? Double
                ))
            }
        }
        try store.replaceBucketAssignmentsFromServer(viewLocalId: viewLocalId, assignments)
    }
}

/// The elements of a top-level array field in a JSON object, each re-serialised.
func rawElements(_ data: Data, key: String) -> [Data] {
    guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let array = object[key] as? [Any] else { return [] }
    return array.compactMap { try? JSONSerialization.data(withJSONObject: $0, options: [.fragmentsAllowed]) }
}

extension Puller {
    @discardableResult
    public func pullLabels() async throws -> Int {
        try await flights.run("pullLabels") { [self] in
            let started = isoNow()
            let raws = try await api.fetchAllPages("/labels")
            var ids = Set<Int>()
            for data in raws {
                guard let payload = try? JSONDecoder().decode(LabelResponse.self, from: data) else { continue }
                try store.upsertLabelFromServer(payload, rawJSON: String(bytes: data, encoding: .utf8) ?? "")
                ids.insert(payload.id)
            }
            if raws.count < defaultPerPage * maxPages {
                try store.removeLabelsMissingOnServer(serverIds: Self.ids(in: raws), fetchedSince: started)
            }
            let count = ids.count
            try store.stampSync(.labels)
            return count
        }
    }
}
