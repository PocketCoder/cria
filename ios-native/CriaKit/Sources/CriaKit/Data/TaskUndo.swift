import Foundation

/// What it takes to put one user action back: the before-values of every task field the action touched (a
/// `TaskPatch` per task), card placements, and soft deletes to take back. Applying it goes through `updateTask`
/// like any edit, so the reversal syncs through the outbox as a normal change; nothing in the outbox is cancelled
/// (except a delete still inside its undo window).
public struct TaskUndoStep: Equatable, Sendable {
    public struct Entry: Equatable, Sendable {
        public var taskLocalId: String
        public var inverse: TaskPatch

        public init(taskLocalId: String, inverse: TaskPatch) {
            self.taskLocalId = taskLocalId
            self.inverse = inverse
        }
    }

    /// Where a card sat on a kanban board before it was moved.
    public struct BucketMove: Equatable, Sendable {
        public var taskLocalId: String
        public var viewLocalId: String
        public var bucketLocalId: String
        public var position: Double?

        public init(taskLocalId: String, viewLocalId: String, bucketLocalId: String, position: Double?) {
            self.taskLocalId = taskLocalId
            self.viewLocalId = viewLocalId
            self.bucketLocalId = bucketLocalId
            self.position = position
        }
    }

    /// Shown in the toast, such as "Task completed" or "3 tasks moved".
    public var message: String
    public var entries: [Entry]
    public var bucketMoves: [BucketMove]
    /// Tasks soft-deleted with an undo window, to bring back.
    public var deletedLocalIds: [String]

    public init(message: String, entries: [Entry] = [], bucketMoves: [BucketMove] = [], deletedLocalIds: [String] = []) {
        self.message = message
        self.entries = entries
        self.bucketMoves = bucketMoves
        self.deletedLocalIds = deletedLocalIds
    }

    public var isEmpty: Bool { entries.isEmpty && bucketMoves.isEmpty && deletedLocalIds.isEmpty }

    /// The toast text for a patch applied to `count` tasks.
    public static func message(for patch: TaskPatch, count: Int = 1) -> String {
        let subject = count == 1 ? "Task" : "\(count) tasks"
        if let done = patch.done { return "\(subject) \(done ? "completed" : "reopened")" }
        if patch.projectLocalId != nil { return "\(subject) moved" }
        if let due = patch.dueDate { return due.isEmpty ? "Due date cleared" : "\(subject) rescheduled" }
        if patch.priority != nil { return "Priority changed" }
        if patch.isFavorite != nil { return "Favourite changed" }
        return "\(subject) updated"
    }
}

extension TaskPatch {
    /// The patch that puts every field this one sets back to its value in `before`. A cleared date or empty text
    /// becomes the empty string, which `updateTask` reads as "clear".
    ///
    /// Completing a repeating task makes the server move its dates on, so a patch that sets `done` on one also
    /// restores the start, due and end dates exactly as they were (they may have advanced by the time of the undo).
    public func inverse(restoring before: TaskRecord) -> TaskPatch {
        var inverse = TaskPatch()
        if title != nil { inverse.title = before.title }
        if done != nil { inverse.done = before.done }
        if priority != nil { inverse.priority = before.priority }
        if isFavorite != nil { inverse.isFavorite = before.isFavorite }
        if description != nil { inverse.description = before.description ?? "" }
        if percentDone != nil { inverse.percentDone = before.percentDone }
        if projectLocalId != nil { inverse.projectLocalId = before.projectLocalId }
        if repeatAfter != nil { inverse.repeatAfter = before.repeatAfter }
        if repeatMode != nil { inverse.repeatMode = before.repeatMode }
        if hexColor != nil { inverse.hexColor = before.hexColor ?? "" }
        if coverImageAttachmentId != nil { inverse.coverImageAttachmentId = before.coverImageAttachmentId ?? 0 }
        let repeating = before.repeatAfter > 0 || before.repeatMode != 0
        let restoreDates = done != nil && repeating
        if dueDate != nil || restoreDates { inverse.dueDate = before.dueDate ?? "" }
        if startDate != nil || restoreDates { inverse.startDate = before.startDate ?? "" }
        if endDate != nil || restoreDates { inverse.endDate = before.endDate ?? "" }
        return inverse
    }
}

extension CriaStore {
    /// `updateTask`, plus the step that reverses it. Throws like `updateTask` when the task is gone.
    @discardableResult
    public func updateTaskUndoable(localId: String, patch: TaskPatch, message: String? = nil) throws -> TaskUndoStep {
        guard let before = try task(localId: localId) else { throw CriaStoreError.notFound(localId) }
        _ = try updateTask(localId: localId, patch: patch)
        return TaskUndoStep(
            message: message ?? TaskUndoStep.message(for: patch),
            entries: [TaskUndoStep.Entry(taskLocalId: localId, inverse: patch.inverse(restoring: before))]
        )
    }

    /// Reverses a step: takes back deletes, restores card placements, then writes the inverse patches. A task that
    /// is gone is skipped. False when a delete could not be taken back (it had already been sent); the rest still
    /// goes ahead.
    @discardableResult
    public func undo(_ step: TaskUndoStep) throws -> Bool {
        var allRestored = true
        for localId in step.deletedLocalIds.reversed() {
            if try !undoDeleteTask(localId: localId) { allRestored = false }
        }
        for move in step.bucketMoves.reversed() {
            try setTaskBucket(
                taskLocalId: move.taskLocalId, viewLocalId: move.viewLocalId,
                bucketLocalId: move.bucketLocalId, position: move.position
            )
        }
        for entry in step.entries.reversed() {
            guard try task(localId: entry.taskLocalId) != nil else { continue }
            _ = try updateTask(localId: entry.taskLocalId, patch: entry.inverse)
        }
        return allRestored
    }
}
