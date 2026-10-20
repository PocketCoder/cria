import Foundation

/// The outcome of one action over several tasks: how many changed, and the titles of those that failed.
public struct BulkResult: Equatable, Sendable {
    public var changed = 0
    public var failures: [String] = []
    /// Puts every change back as one step; nil when nothing changed. Not part of equality.
    public var undo: TaskUndoStep?

    public init(changed: Int = 0, failures: [String] = [], undo: TaskUndoStep? = nil) {
        self.changed = changed
        self.failures = failures
        self.undo = undo
    }

    public static func == (lhs: BulkResult, rhs: BulkResult) -> Bool {
        lhs.changed == rhs.changed && lhs.failures == rhs.failures
    }
}

extension CriaStore {
    /// Applies a patch to each task through `updateTask`, one write (and one outbox op) per task, as the desktop
    /// selection bar does. A task that is gone or whose write fails is reported, and the rest still go ahead.
    /// `patchFor` returns nil to leave a task as it is.
    @discardableResult
    public func bulkUpdate(_ localIds: [String], patchFor: (TaskRecord) -> TaskPatch?) -> BulkResult {
        var result = BulkResult()
        var entries: [TaskUndoStep.Entry] = []
        var sample: TaskPatch?
        for localId in localIds {
            do {
                guard let record = try self.task(localId: localId) else { continue }
                guard let patch = patchFor(record) else { continue }
                _ = try updateTask(localId: localId, patch: patch)
                entries.append(TaskUndoStep.Entry(taskLocalId: localId, inverse: patch.inverse(restoring: record)))
                sample = sample ?? patch
                result.changed += 1
            } catch {
                result.failures.append((try? self.task(localId: localId))?.title ?? localId)
            }
        }
        if let sample {
            result.undo = TaskUndoStep(message: TaskUndoStep.message(for: sample, count: entries.count), entries: entries)
        }
        return result
    }

    /// Marks the tasks done, skipping those that already are.
    @discardableResult
    public func bulkComplete(_ localIds: [String]) -> BulkResult {
        bulkUpdate(localIds) { $0.done ? nil : TaskPatch(done: true) }
    }

    /// Sets the due date on every task. Pass an ISO value from the date sheet; an empty string clears it.
    @discardableResult
    public func bulkSchedule(_ localIds: [String], dueDate: String) -> BulkResult {
        bulkUpdate(localIds) { _ in TaskPatch(dueDate: dueDate) }
    }

    /// Defers each task by the preset, counting from its own due date (or today).
    @discardableResult
    public func bulkDefer(_ localIds: [String], preset: DeferPreset, now: Date = Date(), calendar: Calendar = .cria) -> BulkResult {
        bulkUpdate(localIds) { TaskPatch(dueDate: preset.dueDate(from: $0.dueDate, now: now, calendar: calendar)) }
    }

    @discardableResult
    public func bulkSetPriority(_ localIds: [String], priority: Int) -> BulkResult {
        bulkUpdate(localIds) { _ in TaskPatch(priority: priority) }
    }

    /// Moves the tasks to a project, skipping those already there.
    @discardableResult
    public func bulkMove(_ localIds: [String], toProject projectLocalId: String) -> BulkResult {
        bulkUpdate(localIds) { task in
            guard task.projectLocalId != projectLocalId else { return nil }
            var patch = TaskPatch()
            patch.projectLocalId = projectLocalId
            return patch
        }
    }

    /// Deletes the tasks at once. With an `undoWindow` each delete waits that long in the outbox, and `undo` on the
    /// result takes all of them back as one step.
    @discardableResult
    public func bulkDelete(_ localIds: [String], undoWindow: TimeInterval = 0) -> BulkResult {
        var result = BulkResult()
        var deleted: [String] = []
        for localId in localIds {
            do {
                try deleteTask(localId: localId, undoWindow: undoWindow)
                deleted.append(localId)
                result.changed += 1
            } catch {
                result.failures.append(localId)
            }
        }
        if undoWindow > 0, !deleted.isEmpty {
            let subject = deleted.count == 1 ? "Task" : "\(deleted.count) tasks"
            result.undo = TaskUndoStep(message: "\(subject) deleted", deletedLocalIds: deleted)
        }
        return result
    }
}
