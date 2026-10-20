import Foundation

/// Fields the quick-add form holds outside the typed line (the pickers).
public struct QuickAddFields: Equatable, Sendable {
    public var description = ""
    public var dueDate: String?
    public var priority = 0
    public var repeatAfter: Int?
    public var repeatMode: Int?
    /// From the expanded syntax: the start and end dates.
    public var startDate: String?
    public var endDate: String?

    public init(description: String = "", dueDate: String? = nil, priority: Int = 0,
                repeatAfter: Int? = nil, repeatMode: Int? = nil, startDate: String? = nil, endDate: String? = nil) {
        self.description = description
        self.dueDate = dueDate
        self.priority = priority
        self.repeatAfter = repeatAfter
        self.repeatMode = repeatMode
        self.startDate = startDate
        self.endDate = endDate
    }
}

/// Case-insensitive project lookup for a `+project` token.
/// The project a typed `+name` means: the exact title (any case), else the one project whose title matches once
/// emoji, punctuation and spacing are ignored ("+flat" finds "Flat 🏠"), else the one whose title starts with it, else
/// the one that contains it as a word. Nil when nothing or more than one project fits.
public func findProject(titled title: String, in projects: [ProjectRecord]) -> ProjectRecord? {
    if let exact = projects.first(where: { $0.title.lowercased() == title.lowercased() }) { return exact }
    let wanted = projectKey(title)
    guard !wanted.isEmpty else { return nil }
    let keyed = projects.map { (project: $0, key: projectKey($0.title)) }
    let tests: [(String) -> Bool] = [
        { $0 == wanted },
        { $0.hasPrefix(wanted) },
        { (" " + $0 + " ").contains(" " + wanted + " ") }
    ]
    for test in tests {
        let matches = keyed.filter { test($0.key) }
        if matches.count == 1 { return matches[0].project }
        if matches.count > 1 { return nil }
    }
    return nil
}

/// Lowercased letters and digits, words separated by single spaces.
private func projectKey(_ text: String) -> String {
    let words = text.lowercased().unicodeScalars.split { !CharacterSet.alphanumerics.contains($0) }
    return words.map { String(String.UnicodeScalarView($0)) }.joined(separator: " ")
}

/// Which project the chip row shows: a typed token wins (no colour, it may not match a real project), else the
/// chosen project. Ported from `resolveProjectChip`.
public func resolveProjectChip(
    parsedProjectTitle: String?, projects: [ProjectRecord], projectLocalId: String?
) -> (title: String?, color: String?) {
    let chosen = projects.first { $0.localId == projectLocalId }
    if let parsedProjectTitle {
        // The project it will really go to, so a near miss is visible before adding.
        if let match = findProject(titled: parsedProjectTitle, in: projects) { return (match.title, match.hexColor) }
        return ("No project “\(parsedProjectTitle)”", nil)
    }
    return (chosen?.title, chosen?.hexColor)
}

/// The fallback target: the open project when it is real, else the user's default project, else the first.
public func pickFallbackProjectId(
    projects: [ProjectRecord], selectedLocalId: String?, defaultServerProjectId: Int?
) -> String? {
    guard let first = projects.first else { return nil }
    if let selectedLocalId, projects.contains(where: { $0.localId == selectedLocalId }) { return selectedLocalId }
    if let defaultServerProjectId, let match = projects.first(where: { $0.serverId == defaultServerProjectId }) {
        return match.localId
    }
    return first.localId
}

/// A title is needed, and a project, unless a `+project` token was typed (resolved when the task is built).
public func canSubmitQuickAdd(title: String, projectTitle: String?, projectLocalId: String?) -> Bool {
    if title.isEmpty { return false }
    return projectTitle != nil || projectLocalId != nil
}

/// Builds the task input. The project token resolves here, not only in the picker, so a type-then-submit race
/// cannot send the task to the previously selected project. An unknown token falls back to `fallbackProjectId`
/// (the default or first project), as the web client falls back to the Inbox. Nil when no project is available.
public func buildQuickAddInput(
    title: String,
    projectTitle: String?,
    projects: [ProjectRecord],
    selectedProjectId: String?,
    fallbackProjectId: String?,
    fields: QuickAddFields
) -> TaskInput? {
    let projectId: String?
    if let projectTitle {
        projectId = findProject(titled: projectTitle, in: projects)?.localId ?? fallbackProjectId
    } else {
        projectId = selectedProjectId
    }
    guard let projectId else { return nil }
    var input = TaskInput(title: title, projectLocalId: projectId)
    let note = fields.description.trimmingCharacters(in: .whitespacesAndNewlines)
    if !note.isEmpty { input.description = note }
    input.dueDate = fields.dueDate
    if fields.priority > 0 { input.priority = fields.priority }
    input.repeatAfter = fields.repeatAfter ?? 0
    input.repeatMode = fields.repeatMode ?? 0
    input.startDate = fields.startDate
    input.endDate = fields.endDate
    return input
}

/// Union of typed `*label` tokens into the picker's titles (case-insensitive, order kept).
public func mergeLabelTitles(_ previous: [String], _ incoming: [String]) -> [String] {
    var known = Set(previous.map { $0.lowercased() })
    var merged = previous
    for title in incoming where known.insert(title.lowercased()).inserted {
        merged.append(title)
    }
    return merged
}

/// A picker's value after the parsed token behind it changes from `before` to `after`. A parsed value is copied in.
/// When the parse stops producing one, the value it put there is taken back out (`empty`), unless the user has
/// changed the picker since.
public func followParsed<Value: Equatable>(_ current: Value, before: Value?, after: Value?, empty: Value) -> Value {
    if let after { return after }
    if let before, current == before { return empty }
    return current
}

/// The label picker after the typed label tokens change: labels whose token is gone leave the picker and new ones
/// join it. Other picks stay, unless they match a removed token.
public func followParsedLabels(_ current: [String], before: [String], after: [String]) -> [String] {
    let kept = Set(after.map { $0.lowercased() })
    let gone = Set(before.map { $0.lowercased() }).subtracting(kept)
    return mergeLabelTitles(current.filter { !gone.contains($0.lowercased()) }, after)
}

/// The day presets on the quick-add date chip.
public enum QuickAddDatePreset: String, CaseIterable, Sendable {
    case today, tomorrow, thisWeekend, nextWeek

    public var title: String {
        switch self {
        case .today: return "Today"
        case .tomorrow: return "Tomorrow"
        case .thisWeekend: return "This weekend"
        case .nextWeek: return "Next week"
        }
    }

    /// All-day value for the preset's day. This weekend and next week read as the typed phrases do: the coming
    /// weekend day (today when it is that day) and the day `rules` gives "next week".
    public func iso(now: Date, calendar: Calendar = .cria, rules: CriaRules = .current) -> String {
        let today = calendar.startOfDay(for: now)
        let days: Int
        switch self {
        case .today: days = 0
        case .tomorrow: days = 1
        case .thisWeekend: days = rules.weekendOffset(from: today, calendar: calendar)
        case .nextWeek: days = rules.nextWeekOffset(from: today, calendar: calendar)
        }
        return DueDates.allDayISO(for: calendar.date(byAdding: .day, value: days, to: today) ?? today, calendar: calendar)
    }
}

/// A reminder chosen or typed in quick add. Every kind that follows the due date is stored as a relative reminder, so
/// it moves when the date does.
public enum QuickAddReminder: Hashable, Sendable {
    /// An offset before the due date (0 = at the due time).
    case beforeDue(seconds: Int)
    /// A fixed instant (ISO).
    case atTime(String)
    /// That many days before the due day, at a time of day (minutes after midnight); nil uses the day reminder time
    /// from Settings.
    case daysBeforeDue(days: Int, minute: Int?)
    /// A time of day: on the due day when there is one, else the next time the clock shows it.
    case atTimeOfDay(minute: Int)

    /// The kinds that need a due date to follow.
    public var needsDueDate: Bool {
        switch self {
        case .beforeDue, .daysBeforeDue: return true
        case .atTime, .atTimeOfDay: return false
        }
    }

    /// What to store for a task with this due date, or nil when it needs a due date and there is none.
    public func input(
        dueDate: String?, now: Date = Date(), calendar: Calendar = .cria, rules: CriaRules = .current
    ) -> ReminderInput? {
        let due = dueDate.flatMap { $0.isEmpty ? nil : DueDates.pickerDate($0, calendar: calendar) }
        switch self {
        case .beforeDue(let seconds):
            return due == nil ? nil : ReminderInput(period: -seconds, relativeTo: .dueDate)
        case .atTime(let iso):
            return ReminderInput(triggerAt: iso)
        case .daysBeforeDue(let days, let minute):
            guard let due else { return nil }
            let period = Self.offset(from: due, days: days, minute: minute ?? rules.dayReminderMinute, calendar: calendar)
            return ReminderInput(period: period, relativeTo: .dueDate)
        case .atTimeOfDay(let minute):
            if let due {
                let period = Self.offset(from: due, days: 0, minute: minute, calendar: calendar)
                return ReminderInput(period: period, relativeTo: .dueDate)
            }
            let today = Self.time(minute, on: calendar.startOfDay(for: now), calendar: calendar)
            let fires = today > now ? today : calendar.date(byAdding: .day, value: 1, to: today) ?? today
            return ReminderInput(triggerAt: ISO8601DateFormatter().string(from: fires))
        }
    }

    /// Seconds from `due` to `minute` past midnight, `days` days before the due day (negative before).
    static func offset(from due: Date, days: Int, minute: Int, calendar: Calendar) -> Int {
        let day = calendar.date(byAdding: .day, value: -days, to: calendar.startOfDay(for: due)) ?? due
        return Int(time(minute, on: day, calendar: calendar).timeIntervalSince(due).rounded())
    }

    static func time(_ minute: Int, on day: Date, calendar: Calendar) -> Date {
        calendar.date(bySettingHour: minute / 60, minute: minute % 60, second: 0, of: day) ?? day
    }
}

/// One task queued in quick add's multiple mode. A subtask belongs to the nearest queued task above it that is not one.
public struct QuickAddBatchItem: Sendable {
    public var input: TaskInput
    public var labelTitles: [String]
    public var assigneeUsernames: [String]
    public var reminders: [QuickAddReminder]
    public var isSubtask: Bool
    /// Subtasks typed under this task, created in its project and linked to it.
    public var subtaskTitles: [String]

    public init(
        input: TaskInput, labelTitles: [String] = [], assigneeUsernames: [String] = [], reminders: [QuickAddReminder] = [],
        isSubtask: Bool = false, subtaskTitles: [String] = []
    ) {
        self.input = input
        self.labelTitles = labelTitles
        self.assigneeUsernames = assigneeUsernames
        self.reminders = reminders
        self.isSubtask = isSubtask
        self.subtaskTitles = subtaskTitles
    }
}

extension CriaStore {
    /// Creates the task, then applies the labels (typed and picked; a title with no label yet creates one) and the
    /// reminders, best effort: a bad label or reminder never fails the create. Relative reminders are dropped when the
    /// task has no due date to follow.
    /// Typed `@name` assignees are queued by username and resolved when the op is pushed (the user's id is not known
    /// offline), so they are never lost; a name that matches nobody is dropped at that point.
    @discardableResult
    public func persistQuickAdd(
        _ input: TaskInput, labelTitles: [String], assigneeUsernames: [String] = [], reminders: [QuickAddReminder] = []
    ) throws -> TaskRecord {
        let created = try createTask(input)
        if !labelTitles.isEmpty {
            try? applyLabels(byTitle: labelTitles, toTask: created.localId)
        }
        var seen = Set<QuickAddReminder>()
        for reminder in reminders where seen.insert(reminder).inserted {
            guard let reminderInput = reminder.input(dueDate: input.dueDate) else { continue }
            try? addReminder(taskLocalId: created.localId, reminderInput)
        }
        try? queueAssignees(assigneeUsernames, toTask: created.localId)
        return created
    }

    /// Creates quick add's tasks in order, each followed by its typed subtasks. A queued subtask is created in the
    /// project of the task it belongs to and linked to it; one queued first, with nothing above it, is a plain task.
    @discardableResult
    public func persistQuickAddBatch(_ items: [QuickAddBatchItem]) throws -> [TaskRecord] {
        var created: [TaskRecord] = []
        var parent: TaskRecord?
        for item in items {
            var input = item.input
            let owner = item.isSubtask ? parent : nil
            if let owner { input.projectLocalId = owner.projectLocalId }
            let record = try persistQuickAdd(
                input, labelTitles: item.labelTitles, assigneeUsernames: item.assigneeUsernames, reminders: item.reminders
            )
            if let owner {
                try addRelation(taskLocalId: owner.localId, otherTaskLocalId: record.localId, kind: .subtask)
            } else {
                parent = record
            }
            created.append(record)
            for title in item.subtaskTitles where !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                created.append(try createSubtask(parentLocalId: record.localId, title: title))
            }
        }
        return created
    }

    /// Queues one assign op per distinct username (case-insensitive).
    func queueAssignees(_ usernames: [String], toTask taskLocalId: String) throws {
        var seen = Set<String>()
        let names = usernames
            .map { $0.trimmingCharacters(in: CharacterSet(charactersIn: "@ ")) }
            .filter { !$0.isEmpty && seen.insert($0.lowercased()).inserted }
        guard !names.isEmpty else { return }
        try userWrite(announcing: [.outbox]) { connection in
            let now = isoNow()
            for name in names {
                try connection.enqueue(
                    .taskAssignee, localId: taskLocalId, operation: .add,
                    payload: ["task_local_id": taskLocalId, "username": name], at: now
                )
            }
        }
    }
}
