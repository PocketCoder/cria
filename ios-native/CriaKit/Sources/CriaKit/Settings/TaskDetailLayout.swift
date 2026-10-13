import Foundation

/// The movable sections of the task screen, in the order the user chose (Settings > Task layout). The title and
/// description stay at the top and Delete at the bottom.
public enum TaskDetailSection: String, CaseIterable, Sendable, Identifiable {
    case details, when, schedule, subtasks, labels, assignees, attachments, comments

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .details: "Project, priority and progress"
        case .when: "Due date and reminders"
        case .schedule: "Start and end"
        case .subtasks: "Subtasks and relations"
        case .labels: "Labels"
        case .assignees: "Assignees"
        case .attachments: "Attachments"
        case .comments: "Comments"
        }
    }

    public static let defaultOrder: [TaskDetailSection] = allCases

    /// Parses a stored order: unknown names are dropped, missing sections are added at the end in default order, so
    /// a section added in a later release still shows.
    public static func order(from text: String) -> [TaskDetailSection] {
        var seen = Set<TaskDetailSection>()
        let parsed = text.split(separator: ",").compactMap { TaskDetailSection(rawValue: String($0)) }.filter { seen.insert($0).inserted }
        return parsed + defaultOrder.filter { !seen.contains($0) }
    }

    public static func text(of order: [TaskDetailSection]) -> String {
        order.map(\.rawValue).joined(separator: ",")
    }
}

/// Tasks whose progress the user set by hand. Those keep it; the others follow their subtasks. Kept on this device.
public enum ProgressOverride {
    private static let key = "cria.manualProgress"
    private static let lock = NSLock()

    public static func isManual(_ taskLocalId: String, defaults: UserDefaults = .standard) -> Bool {
        lock.withLock { Set(defaults.stringArray(forKey: key) ?? []).contains(taskLocalId) }
    }

    public static func setManual(_ taskLocalId: String, _ manual: Bool, defaults: UserDefaults = .standard) {
        lock.withLock {
            var ids = Set(defaults.stringArray(forKey: key) ?? [])
            if manual { ids.insert(taskLocalId) } else { ids.remove(taskLocalId) }
            defaults.set(Array(ids).sorted(), forKey: key)
        }
    }
}
