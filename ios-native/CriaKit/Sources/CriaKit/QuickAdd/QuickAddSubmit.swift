import Foundation

/// Fields the quick-add form holds outside the typed line (the pickers).
public struct QuickAddFields: Equatable, Sendable {
    public var description = ""
    public var dueDate: String?
    public var priority = 0
    public var repeatAfter: Int?
    public var repeatMode: Int?

    public init(description: String = "", dueDate: String? = nil, priority: Int = 0,
                repeatAfter: Int? = nil, repeatMode: Int? = nil) {
        self.description = description
        self.dueDate = dueDate
        self.priority = priority
        self.repeatAfter = repeatAfter
        self.repeatMode = repeatMode
    }
}

/// Case-insensitive project lookup for a `+project` token.
public func findProject(titled title: String, in projects: [ProjectRecord]) -> ProjectRecord? {
    projects.first { $0.title.lowercased() == title.lowercased() }
}

/// Which project the chip row shows: a typed token wins (no colour, it may not match a real project), else the
/// chosen project. Ported from `resolveProjectChip`.
public func resolveProjectChip(
    parsedProjectTitle: String?, projects: [ProjectRecord], projectLocalId: String?
) -> (title: String?, color: String?) {
    let chosen = projects.first { $0.localId == projectLocalId }
    if let parsedProjectTitle { return (parsedProjectTitle, nil) }
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

/// A reminder chosen in quick add: an offset from the due date (0 = at the due time) or a fixed instant (ISO).
public enum QuickAddReminder: Hashable, Sendable {
    case beforeDue(seconds: Int)
    case atTime(String)

    /// The relative options need a due date to follow.
    public var needsDueDate: Bool {
        if case .beforeDue = self { return true }
        return false
    }

    public var input: ReminderInput {
        switch self {
        case .beforeDue(let seconds): return ReminderInput(period: -seconds, relativeTo: .dueDate)
        case .atTime(let iso): return ReminderInput(triggerAt: iso)
        }
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
        let hasDueDate = !(input.dueDate ?? "").isEmpty
        var seen = Set<QuickAddReminder>()
        for reminder in reminders where (hasDueDate || !reminder.needsDueDate) && seen.insert(reminder).inserted {
            try? addReminder(taskLocalId: created.localId, reminder.input)
        }
        try? queueAssignees(assigneeUsernames, toTask: created.localId)
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
