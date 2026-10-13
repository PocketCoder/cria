import Foundation
import GRDB

extension CriaStore {
    /// Sets each parent of `childLocalId` to the share of its subtasks that are done (1 of 2 is 50%), unless the user
    /// set that parent's progress by hand (`ProgressOverride`). Runs inside the user mutation that changed the child,
    /// so the parent's update op is queued with it. A parent with no remaining subtasks keeps its value.
    static func refreshParentProgress(_ connection: Database, childLocalId: String, now: String) throws {
        let parents = try String.fetchAll(connection, sql: """
            SELECT task_local_id FROM task_relations WHERE other_task_local_id = ? AND relation_kind = 'subtask'
            UNION
            SELECT other_task_local_id FROM task_relations
             WHERE task_local_id = ? AND relation_kind = 'parenttask' AND other_task_local_id IS NOT NULL
            """, arguments: [childLocalId, childLocalId])
        for parent in parents where !ProgressOverride.isManual(parent) {
            try refreshProgress(connection, parentLocalId: parent, now: now)
        }
    }

    static func refreshProgress(_ connection: Database, parentLocalId: String, now: String) throws {
        let row = try Row.fetchOne(connection, sql: """
            SELECT COUNT(*) AS total, COALESCE(SUM(t.done), 0) AS done
              FROM task_relations r JOIN tasks t ON t.local_id = r.other_task_local_id
             WHERE r.task_local_id = ? AND r.relation_kind = 'subtask' AND t.deleted = 0
            """, arguments: [parentLocalId])
        let total: Int = row?["total"] ?? 0
        let done: Int = row?["done"] ?? 0
        guard total > 0, let parent = try fetchTask(connection, localId: parentLocalId) else { return }
        let share = (Double(done) / Double(total) * 100).rounded() / 100
        guard abs(parent.percentDone - share) > 0.001 else { return }
        try connection.execute(
            sql: "UPDATE tasks SET percent_done = ?, dirty = 1, updated_at = ? WHERE local_id = ? AND deleted = 0",
            arguments: [share, now, parentLocalId]
        )
        guard let updated = try fetchTask(connection, localId: parentLocalId) else { return }
        try connection.enqueue(.task, localId: parentLocalId, operation: .update, payload: taskPayload(updated), at: now)
    }

    /// Completing a repeating task (the server moves it to its next date) marks its done subtasks not done again, when
    /// that setting is on (`CriaRules.resetsSubtasksOnRepeat`), so the next round starts clean.
    static func resetSubtasksIfRepeating(_ connection: Database, task: TaskRecord, now: String) throws {
        guard CriaRules.current.resetsSubtasksOnRepeat, task.repeatAfter > 0 || task.repeatMode != 0 else { return }
        let children = try String.fetchAll(connection, sql: """
            SELECT t.local_id FROM task_relations r JOIN tasks t ON t.local_id = r.other_task_local_id
             WHERE r.task_local_id = ? AND r.relation_kind = 'subtask' AND t.done = 1 AND t.deleted = 0
            """, arguments: [task.localId])
        guard !children.isEmpty else { return }
        let (assignments, changes) = TaskPatch(done: false).assignments(now: now)
        for child in children {
            try connection.execute(
                sql: "UPDATE tasks SET \(assignments.joined(separator: ", ")) WHERE local_id = ? AND deleted = 0",
                arguments: StatementArguments(changes + [child])
            )
            guard let updated = try fetchTask(connection, localId: child) else { continue }
            try connection.enqueue(.task, localId: child, operation: .update, payload: taskPayload(updated), at: now)
        }
        if !ProgressOverride.isManual(task.localId) { try refreshProgress(connection, parentLocalId: task.localId, now: now) }
    }

    /// Hands a task's progress back to its subtasks after the user had set it by hand.
    public func followSubtaskProgress(taskLocalId: String) throws {
        ProgressOverride.setManual(taskLocalId, false)
        try userWrite(announcing: [.tasks, .outbox]) { connection in
            try CriaStore.refreshProgress(connection, parentLocalId: taskLocalId, now: isoNow())
        }
    }
}
