import Foundation
import GRDB

/// One reminder on a task. A relative reminder carries a period (seconds, negative = before) and the date field it follows.
public struct ReminderRecord: Equatable, Sendable {
    public let reminderAt: String?
    public let relativePeriod: Int?
    public let relativeTo: String?
}

/// A reminder that has not fired yet, joined with its task for the notification text.
public struct UpcomingReminder: Equatable, Sendable {
    public let taskLocalId: String
    public let title: String
    public let reminderAt: String
}

/// Date fields a relative reminder can follow.
public enum ReminderAnchor: String, CaseIterable, Sendable {
    case dueDate = "due_date"
    case startDate = "start_date"
    case endDate = "end_date"
}

/// What to add: an absolute time, or an offset from one of the task's dates.
public struct ReminderInput: Sendable {
    public var triggerAt: String?
    public var period: Int?
    public var relativeTo: ReminderAnchor?

    public init(triggerAt: String? = nil, period: Int? = nil, relativeTo: ReminderAnchor? = nil) {
        self.triggerAt = triggerAt
        self.period = period
        self.relativeTo = relativeTo
    }
}

extension CriaStore {
    public func reminders(forTask taskLocalId: String) throws -> [ReminderRecord] {
        try database.writer.read { connection in
            try Row.fetchAll(connection, sql: """
                SELECT reminder_at, relative_period, relative_to FROM task_reminders
                 WHERE task_local_id = ? ORDER BY reminder_at ASC
                """, arguments: [taskLocalId]).map { row in
                ReminderRecord(reminderAt: row["reminder_at"], relativePeriod: row["relative_period"], relativeTo: row["relative_to"])
            }
        }
    }

    /// Unfired reminders of open tasks that trigger after `date`, soonest first. The OS scheduler is fed from this.
    public func upcomingReminders(after date: Date, limit: Int) throws -> [UpcomingReminder] {
        let cutoff = ISO8601DateFormatter().string(from: date)
        return try database.writer.read { connection in
            try Row.fetchAll(connection, sql: """
                SELECT r.task_local_id, t.title, r.reminder_at
                  FROM task_reminders r JOIN tasks t ON t.local_id = r.task_local_id
                 WHERE r.notified = 0 AND r.reminder_at IS NOT NULL AND r.reminder_at > ? AND t.done = 0 AND t.deleted = 0
                 ORDER BY r.reminder_at ASC LIMIT ?
                """, arguments: [cutoff, limit]).map { row in
                UpcomingReminder(taskLocalId: row["task_local_id"], title: row["title"], reminderAt: row["reminder_at"])
            }
        }
    }

    /// User mutation: adds a reminder and queues a task update (the task body carries the full reminder set).
    /// A relative reminder resolves its local trigger time from the task's matching date; the next pull corrects it.
    public func addReminder(taskLocalId: String, _ input: ReminderInput) throws {
        try userWrite(announcing: [.tasks, .outbox]) { connection in
            var resolved = input.triggerAt
            let relative = input.period != nil && input.relativeTo != nil
            if let period = input.period, let anchor = input.relativeTo {
                let column = anchor.rawValue
                let base = try String.fetchOne(
                    connection, sql: "SELECT \(column) FROM tasks WHERE local_id = ?", arguments: [taskLocalId]
                )
                if let base, let date = DueDates.parse(base) {
                    resolved = ISO8601DateFormatter().string(from: date.addingTimeInterval(TimeInterval(period)))
                }
            }
            try connection.execute(sql: """
                INSERT OR IGNORE INTO task_reminders (task_local_id, reminder_at, relative_period, relative_to, notified)
                VALUES (?, ?, ?, ?, 0)
                """, arguments: [taskLocalId, resolved, relative ? input.period : nil, relative ? input.relativeTo?.rawValue : nil])
            try CriaStore.markTaskChanged(connection, localId: taskLocalId)
        }
    }

    /// User mutation: removes the reminder with this exact shape and queues a task update.
    public func removeReminder(taskLocalId: String, _ reminder: ReminderRecord) throws {
        try userWrite(announcing: [.tasks, .outbox]) { connection in
            try connection.execute(sql: """
                DELETE FROM task_reminders
                 WHERE task_local_id = ?
                   AND COALESCE(reminder_at, '') = COALESCE(?, '')
                   AND COALESCE(relative_period, -2147483648) = COALESCE(?, -2147483648)
                   AND COALESCE(relative_to, '') = COALESCE(?, '')
                """, arguments: [taskLocalId, reminder.reminderAt, reminder.relativePeriod, reminder.relativeTo])
            try CriaStore.markTaskChanged(connection, localId: taskLocalId)
        }
    }

    private static func markTaskChanged(_ connection: Database, localId: String) throws {
        let now = isoNow()
        try connection.execute(sql: "UPDATE tasks SET dirty = 1, updated_at = ? WHERE local_id = ?", arguments: [now, localId])
        guard let record = try CriaStore.fetchTask(connection, localId: localId) else { throw CriaStoreError.notFound(localId) }
        try connection.enqueue(.task, localId: localId, operation: .update, payload: CriaStore.taskPayload(record), at: now)
    }
}
