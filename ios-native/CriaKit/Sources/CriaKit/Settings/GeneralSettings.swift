import Foundation

/// The general settings the Settings screen edits, read from a raw `GET /user` payload, plus the `SettingsChange`
/// each control produces. Saved through `UserSettingsService`, which sends only the changed field.
///
/// Language and timezone are left out on purpose, as in the Tauri build: they sync to the server but nothing in the
/// client reads them, so a control would mislead. The server values round-trip untouched. Week start is here because
/// the Upcoming week strip reads it.
public struct GeneralSettings: Equatable, Sendable {
    public var name: String
    public var emailRemindersEnabled: Bool
    public var overdueRemindersEnabled: Bool
    /// "HH:mm", as the server stores it.
    public var overdueRemindersTime: String
    public var quickAddMagicMode: String
    /// 0 = Sunday ... 6 = Saturday, as Vikunja stores it.
    public var weekStart: Int
    /// Server id of the default (inbox) project; 0 when unset.
    public var defaultProjectId: Int
    public var discoverableByEmail: Bool
    public var discoverableByName: Bool

    public static let defaultQuickAddMode = "vikunja"
    public static let defaultWeekStart = 1
    /// The UserDefaults key the Upcoming week strip reads the week start from.
    public static let weekStartDefaultsKey = "cria.weekStart"
    /// The UserDefaults key the quick add and Ramble screens read the mode from.
    public static let quickAddDefaultsKey = "cria.quickAddMagicMode"

    public init(user: JSONValue) {
        let settings = user["settings"]
        name = settings?["name"]?.stringValue ?? user["name"]?.stringValue ?? ""
        emailRemindersEnabled = settings?["email_reminders_enabled"]?.boolValue ?? false
        overdueRemindersEnabled = settings?["overdue_tasks_reminders_enabled"]?.boolValue ?? false
        overdueRemindersTime = settings?["overdue_tasks_reminders_time"]?.stringValue ?? "09:00"
        let start = settings?["week_start"]?.intValue ?? Self.defaultWeekStart
        weekStart = (0...6).contains(start) ? start : Self.defaultWeekStart
        defaultProjectId = max(settings?["default_project_id"]?.intValue ?? 0, 0)
        discoverableByEmail = settings?["discoverable_by_email"]?.boolValue ?? false
        discoverableByName = settings?["discoverable_by_name"]?.boolValue ?? false
        let frontend = FrontendSettings.frontendSettings(of: settings?.objectValue)
        quickAddMagicMode = FrontendSettings.quickAddMagicMode(of: frontend) ?? Self.defaultQuickAddMode
    }

    public static func changeName(_ name: String) -> SettingsChange {
        SettingsChange(settings: ["name": .string(name.trimmingCharacters(in: .whitespacesAndNewlines))])
    }

    public static func changeEmailReminders(_ enabled: Bool) -> SettingsChange {
        SettingsChange(settings: ["email_reminders_enabled": .bool(enabled)])
    }

    public static func changeOverdueReminders(_ enabled: Bool) -> SettingsChange {
        SettingsChange(settings: ["overdue_tasks_reminders_enabled": .bool(enabled)])
    }

    /// Nil when `time` is not "HH:mm".
    public static func changeOverdueTime(_ time: String) -> SettingsChange? {
        let parts = time.split(separator: ":")
        guard parts.count == 2, parts[0].count == 2, parts[1].count == 2,
              let hour = Int(parts[0]), let minute = Int(parts[1]),
              (0..<24).contains(hour), (0..<60).contains(minute) else { return nil }
        return SettingsChange(settings: ["overdue_tasks_reminders_time": .string(time)])
    }

    /// Nil when `mode` is not one of the three Vikunja knows.
    public static func changeQuickAddMode(_ mode: String) -> SettingsChange? {
        guard FrontendSettings.quickAddMagicModes.contains(mode) else { return nil }
        return SettingsChange(frontend: [FrontendSettings.quickAddMagicKey: .string(mode)])
    }

    /// Nil when `day` is not 0 (Sunday) ... 6 (Saturday).
    public static func changeWeekStart(_ day: Int) -> SettingsChange? {
        guard (0...6).contains(day) else { return nil }
        return SettingsChange(settings: ["week_start": .number(Double(day))])
    }

    /// 0 clears the default, so the server falls back to its own inbox.
    public static func changeDefaultProject(_ serverId: Int) -> SettingsChange? {
        guard serverId >= 0 else { return nil }
        return SettingsChange(settings: ["default_project_id": .number(Double(serverId))])
    }

    public static func changeDiscoverableByEmail(_ enabled: Bool) -> SettingsChange {
        SettingsChange(settings: ["discoverable_by_email": .bool(enabled)])
    }

    public static func changeDiscoverableByName(_ enabled: Bool) -> SettingsChange {
        SettingsChange(settings: ["discoverable_by_name": .bool(enabled)])
    }
}
