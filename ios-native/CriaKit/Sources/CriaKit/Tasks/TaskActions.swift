import Foundation
import GRDB

/// "Defer" presets for a due date. Ported from `src/lib/defer.ts`.
public enum DeferPreset: String, CaseIterable, Sendable {
    case oneDay, threeDays, oneWeek, nextMonday

    public var title: String {
        switch self {
        case .oneDay: "In 1 day"
        case .threeDays: "In 3 days"
        case .oneWeek: "In 1 week"
        case .nextMonday: "Next Monday"
        }
    }

    /// The due date after deferring. The interval presets count from the later of the current due date and today, so
    /// deferring an overdue task always lands in the future (no due date counts from today). "Next Monday" is the
    /// Monday after today whatever the current due date. A timed due date keeps its time of day; an all-day one stays
    /// all-day. The result is written as `DueDates` writes values. Reminders are left alone.
    public func dueDate(from currentDue: String?, now: Date = Date(), calendar: Calendar = .cria) -> String {
        let today = calendar.startOfDay(for: now)
        let day: Date
        if self == .nextMonday {
            day = calendar.nextDate(after: today, matching: DateComponents(weekday: 2), matchingPolicy: .nextTime) ?? today
        } else {
            let due = currentDue.flatMap { DueDates.calendarDate($0, calendar: calendar) } ?? today
            day = calendar.date(byAdding: .day, value: interval, to: max(due, today)) ?? today
        }
        guard let currentDue, DueDates.hasTimeOfDay(currentDue), let time = DueDates.parse(currentDue) else {
            return DueDates.allDayISO(for: day, calendar: calendar)
        }
        let clock = calendar.dateComponents([.hour, .minute], from: time)
        let timed = calendar.date(bySettingHour: clock.hour ?? 0, minute: clock.minute ?? 0, second: 0, of: day) ?? day
        return DueDates.timedISO(timed)
    }

    private var interval: Int {
        switch self {
        case .oneDay: 1
        case .threeDays: 3
        case .oneWeek: 7
        case .nextMonday: 0
        }
    }
}

extension CriaStore {
    /// User mutation: a copy of the task in the same project, in one transaction (the copy, its labels and reminders,
    /// and their outbox ops, so either all of it is saved or none). Returns the copy.
    ///
    /// Copied, as `duplicateTask` in `src/db/tasks.ts` does: title (unchanged), description, due, start and end dates,
    /// priority, percent done and colour. Also copied: repeat settings, labels and reminders. Not copied: done state,
    /// favourite, subtasks and other relations, assignees, attachments and comments (Tauri leaves these out too).
    @discardableResult
    public func duplicateTask(localId: String) throws -> TaskRecord {
        try userWrite(announcing: [.tasks, .labels, .outbox]) { connection in
            guard let original = try CriaStore.fetchTask(connection, localId: localId) else {
                throw CriaStoreError.notFound(localId)
            }
            let copyId = UUID().uuidString
            let now = isoNow()
            try connection.execute(sql: """
                INSERT INTO tasks (local_id, server_id, project_local_id, title, description, done, due_date, start_date,
                       end_date, priority, percent_done, hex_color, is_favorite, is_subscribed, repeat_after,
                       repeat_mode, updated_at, created_at, dirty, deleted)
                VALUES (?, NULL, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, 1, 0)
                """, arguments: [
                    copyId, original.projectLocalId, original.title, original.description, original.dueDate,
                    original.startDate, original.endDate, original.priority, original.percentDone, original.hexColor,
                    original.repeatAfter, original.repeatMode, now, now
                ])
            guard let copy = try CriaStore.fetchTask(connection, localId: copyId) else { throw CriaStoreError.notFound(copyId) }
            try connection.enqueue(.task, localId: copyId, operation: .create, payload: CriaStore.taskPayload(copy), at: now)
            try CriaStore.copyLabels(connection, from: localId, to: copyId, now: now)
            try CriaStore.copyReminders(connection, from: localId, to: copy, now: now)
            return copy
        }
    }

    /// Each label link is its own outbox op, queued after the create so the push order holds.
    private static func copyLabels(_ connection: Database, from original: String, to copy: String, now: String) throws {
        let labelIds = try String.fetchAll(connection, sql: """
            SELECT label_local_id FROM task_labels WHERE task_local_id = ? AND deleted = 0 ORDER BY label_local_id
            """, arguments: [original])
        for labelId in labelIds {
            try connection.execute(sql: """
                INSERT INTO task_labels (task_local_id, label_local_id, updated_at, dirty, deleted) VALUES (?, ?, ?, 1, 0)
                """, arguments: [copy, labelId, now])
            try connection.enqueue(
                .taskLabel, localId: "\(copy):\(labelId)", operation: .create,
                payload: ["task_local_id": copy, "label_local_id": labelId], at: now
            )
        }
    }

    /// Reminders ride the task update, not the create, so copying any queues one update behind the create. Fired
    /// reminders stay marked as fired, so the copy does not notify for them again.
    private static func copyReminders(_ connection: Database, from original: String, to copy: TaskRecord, now: String) throws {
        try connection.execute(sql: """
            INSERT INTO task_reminders (task_local_id, reminder_at, relative_period, relative_to, notified)
            SELECT ?, reminder_at, relative_period, relative_to, notified FROM task_reminders WHERE task_local_id = ?
            """, arguments: [copy.localId, original])
        guard connection.changesCount > 0 else { return }
        try connection.enqueue(.task, localId: copy.localId, operation: .update, payload: CriaStore.taskPayload(copy), at: now)
    }
}

extension AppServices {
    /// UserDefaults key for the server origin, so links can be built without waiting on the session actor.
    static let serverBaseKey = "cria.serverBase"

    /// Remembers the server origin for `taskWebURL` and `commentWebURL`. Call once the app is signed in (the task
    /// screen does); a copy from an earlier call is used until then.
    public func rememberServerBase() async {
        guard let base = await api.serverBase(), !base.isEmpty else { return }
        UserDefaults.standard.setIfChanged(base, forKey: Self.serverBaseKey)
    }

    /// The Vikunja web address of a task, `<server>/tasks/<id>`. Nil until the task has synced (no server id), or
    /// while the server address is not yet known.
    public func taskWebURL(_ task: TaskRecord) -> URL? {
        TaskLinks.taskURL(base: Self.knownServerBase(), taskServerId: task.serverId)
    }

    /// Link to one comment, `<server>/tasks/<id>#comment-<id>`. Nil until both the task and the comment have synced.
    public func commentWebURL(task: TaskRecord, commentServerId: Int) -> URL? {
        TaskLinks.commentURL(base: Self.knownServerBase(), taskServerId: task.serverId, commentServerId: commentServerId)
    }

    private static func knownServerBase() -> String? {
        let defaults = UserDefaults.standard
        if let base = defaults.string(forKey: serverBaseKey), !base.isEmpty { return base }
        // The sign-in screen's last address, for the moment before the first `rememberServerBase`.
        let typed = defaults.string(forKey: "cria.login.lastServerURL") ?? ""
        return typed.lowercased().hasPrefix("http") ? typed : nil
    }
}

/// Builds Vikunja web addresses. Ported from `copyTaskLink` and `commentPermalink` in the Tauri app.
public enum TaskLinks {
    public static func taskURL(base: String?, taskServerId: Int?) -> URL? {
        guard let base, !base.isEmpty, let taskServerId, taskServerId > 0 else { return nil }
        return URL(string: "\(normalizeBase(base))/tasks/\(taskServerId)")
    }

    public static func commentURL(base: String?, taskServerId: Int?, commentServerId: Int) -> URL? {
        guard commentServerId > 0, let task = taskURL(base: base, taskServerId: taskServerId) else { return nil }
        return URL(string: task.absoluteString + "#comment-\(commentServerId)")
    }
}
