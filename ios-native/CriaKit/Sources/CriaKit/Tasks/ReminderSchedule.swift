import Foundation

/// One notification the app wants the OS to hold.
public struct PlannedReminder: Equatable, Sendable {
    public let identifier: String
    public let title: String
    public let fireDate: Date
}

/// What to change in the OS pending list to match the wanted set.
public struct ReminderReconcile: Equatable, Sendable {
    public let add: [PlannedReminder]
    public let removeIdentifiers: [String]
}

/// Reconciles local reminders against the OS pending list. Replaces desktop polling; iOS holds at most 64 pending.
public enum ReminderSchedule {
    public static let identifierPrefix = "cria.reminder."
    public static let osLimit = 60

    public static func plan(_ upcoming: [UpcomingReminder]) -> [PlannedReminder] {
        upcoming.compactMap { reminder in
            guard let date = DueDates.parse(reminder.reminderAt) else { return nil }
            let identifier = "\(identifierPrefix)\(reminder.taskLocalId).\(reminder.reminderAt)"
            return PlannedReminder(identifier: identifier, title: reminder.title, fireDate: date)
        }
    }

    /// Adds what is missing and removes stale Cria entries. Identifiers without the prefix belong to something else.
    public static func reconcile(wanted: [PlannedReminder], pendingIdentifiers: [String]) -> ReminderReconcile {
        let wantedIds = Set(wanted.map(\.identifier))
        let pending = Set(pendingIdentifiers)
        let stale = pendingIdentifiers.filter { $0.hasPrefix(identifierPrefix) && !wantedIds.contains($0) }
        return ReminderReconcile(add: wanted.filter { !pending.contains($0.identifier) }, removeIdentifiers: stale)
    }
}
