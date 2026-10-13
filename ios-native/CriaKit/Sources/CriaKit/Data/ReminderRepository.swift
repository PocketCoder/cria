import Foundation
import GRDB

/// One reminder on a task. A relative reminder carries a period (seconds, negative = before) and the date field it follows.
public struct ReminderRecord: Equatable, Sendable {
    public let reminderAt: String?
    public let relativePeriod: Int?
    public let relativeTo: String?

    public init(reminderAt: String?, relativePeriod: Int?, relativeTo: String?) {
        self.reminderAt = reminderAt
        self.relativePeriod = relativePeriod
        self.relativeTo = relativeTo
    }

    /// An empty anchor (what an older pull stored for a fixed-time reminder) reads as absolute.
    init(_ row: Row) {
        let anchor: String? = row["relative_to"]
        let hasAnchor = !(anchor ?? "").isEmpty
        self.init(
            reminderAt: row["reminder_at"],
            relativePeriod: hasAnchor ? row["relative_period"] : nil,
            relativeTo: hasAnchor ? anchor : nil
        )
    }
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
                ReminderRecord(row)
            }
        }
    }

    /// Unfired reminders of open tasks that trigger after `date`, soonest first. The OS scheduler is fed from this.
    ///
    /// Compared as dates, not text: server reminders keep the server's offset (`…T05:30:00-04:00`) while local ones
    /// are UTC, so a string comparison dropped future reminders and let past ones take up the OS's slots.
    public func upcomingReminders(after date: Date, limit: Int) throws -> [UpcomingReminder] {
        let rows = try database.writer.read { connection in
            try Row.fetchAll(connection, sql: """
                SELECT r.task_local_id, t.title, r.reminder_at
                  FROM task_reminders r JOIN tasks t ON t.local_id = r.task_local_id
                 WHERE r.notified = 0 AND r.reminder_at IS NOT NULL AND t.done = 0 AND t.deleted = 0
                """)
        }
        let upcoming = rows.compactMap { row -> (Date, UpcomingReminder)? in
            let reminderAt: String = row["reminder_at"]
            guard let fires = DueDates.parse(reminderAt), fires > date else { return nil }
            return (fires, UpcomingReminder(taskLocalId: row["task_local_id"], title: row["title"], reminderAt: reminderAt))
        }
        return upcoming.sorted { $0.0 < $1.0 }.prefix(max(limit, 0)).map(\.1)
    }

    /// User mutation: adds a reminder and queues a task update (the task body carries the full reminder set).
    /// A relative reminder resolves its local trigger time from the task's matching date; the next pull corrects it.
    public func addReminder(taskLocalId: String, _ input: ReminderInput) throws {
        try userWrite(announcing: [.tasks, .outbox]) { connection in
            try CriaStore.insertReminder(connection, taskLocalId: taskLocalId, input)
            try CriaStore.markTaskChanged(connection, localId: taskLocalId)
        }
    }

    /// User mutation: removes the reminder with this exact shape and queues a task update.
    public func removeReminder(taskLocalId: String, _ reminder: ReminderRecord) throws {
        try userWrite(announcing: [.tasks, .outbox]) { connection in
            try CriaStore.deleteReminder(connection, taskLocalId: taskLocalId, reminder)
            try CriaStore.markTaskChanged(connection, localId: taskLocalId)
        }
    }

    /// User mutation: swaps `old` for a new reminder in one transaction, so one task update is queued and the push
    /// never sees the task without it. Either kind can become the other (a fixed time can turn relative and back).
    /// The new row starts unfired, so an edited reminder whose old one already went off can fire again. Throws
    /// `notFound` when `old` is no longer on the task (it was removed or replaced by a pull), changing nothing.
    public func replaceReminder(taskLocalId: String, old: ReminderRecord, with input: ReminderInput) throws {
        try userWrite(announcing: [.tasks, .outbox]) { connection in
            guard try CriaStore.deleteReminder(connection, taskLocalId: taskLocalId, old) else {
                throw CriaStoreError.notFound("reminder")
            }
            try CriaStore.insertReminder(connection, taskLocalId: taskLocalId, input)
            try CriaStore.markTaskChanged(connection, localId: taskLocalId)
        }
    }

    private static func insertReminder(_ connection: Database, taskLocalId: String, _ input: ReminderInput) throws {
        var resolved = input.triggerAt
        let relative = input.period != nil && input.relativeTo != nil
        if let period = input.period, let anchor = input.relativeTo {
            let column = anchor.rawValue
            let base = try String.fetchOne(
                connection, sql: "SELECT \(column) FROM tasks WHERE local_id = ?", arguments: [taskLocalId]
            )
            // An all-day date counts from the start of that day here, as the date sheet and the push read it.
            if let base, let date = DueDates.pickerDate(base) {
                resolved = ISO8601DateFormatter().string(from: date.addingTimeInterval(TimeInterval(period)))
            }
        }
        try connection.execute(sql: """
            INSERT OR IGNORE INTO task_reminders (task_local_id, reminder_at, relative_period, relative_to, notified)
            VALUES (?, ?, ?, ?, 0)
            """, arguments: [taskLocalId, resolved, relative ? input.period : nil, relative ? input.relativeTo?.rawValue : nil])
    }

    /// Whether a row matched and was deleted.
    @discardableResult
    private static func deleteReminder(_ connection: Database, taskLocalId: String, _ reminder: ReminderRecord) throws -> Bool {
        try connection.execute(sql: """
            DELETE FROM task_reminders
             WHERE task_local_id = ?
               AND COALESCE(reminder_at, '') = COALESCE(?, '')
               AND COALESCE(relative_to, '') = COALESCE(?, '')
               AND (COALESCE(relative_to, '') = '' OR relative_period IS ?)
            """, arguments: [taskLocalId, reminder.reminderAt, reminder.relativeTo, reminder.relativePeriod])
        return connection.changesCount > 0
    }

    private static func markTaskChanged(_ connection: Database, localId: String) throws {
        let now = isoNow()
        try connection.execute(sql: "UPDATE tasks SET dirty = 1, updated_at = ? WHERE local_id = ?", arguments: [now, localId])
        guard let record = try CriaStore.fetchTask(connection, localId: localId) else { throw CriaStoreError.notFound(localId) }
        try connection.enqueue(.task, localId: localId, operation: .update, payload: CriaStore.taskPayload(record), at: now)
    }
}
