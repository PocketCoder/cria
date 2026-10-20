import Foundation

/// The general settings the Settings screen edits, read from a raw `GET /user` payload, plus the `SettingsChange`
/// each control produces. Saved through `UserSettingsService`, which sends only the changed field.
///
/// Week start is read by the Upcoming week strip and the weekly round-up. Timezone is read by `TimeZone.criaServerSetting`
/// (the zone date-only values are normalised in when pushed). Language is stored and sent to the server (so
/// Vikunja-web and emails use it) but the iOS UI is not localised, as in the Tauri build.
public struct GeneralSettings: Equatable, Sendable {
    public var name: String
    public var emailRemindersEnabled: Bool
    public var overdueRemindersEnabled: Bool
    /// "HH:mm", as the server stores it.
    public var overdueRemindersTime: String
    public var quickAddMagicMode: String
    /// Vikunja's "Default view": `first`, or a view kind (list, gantt, table, kanban).
    public var defaultView: String
    /// 0 = Sunday ... 6 = Saturday, as Vikunja stores it.
    public var weekStart: Int
    /// Server id of the default (inbox) project; 0 when unset.
    public var defaultProjectId: Int
    public var discoverableByEmail: Bool
    public var discoverableByName: Bool
    /// Vikunja language code, e.g. "en" or "pt_BR".
    public var language: String
    /// IANA identifier, e.g. "Europe/London".
    public var timezone: String
    /// New-task defaults shared with Vikunja-web: the due time and the quick-add reminders.
    public var quickAddDefaults: QuickAddDefaults

    public static let defaultQuickAddMode = "vikunja"
    public static let defaultDefaultView = "first"
    /// The UserDefaults key the project screen reads the default view from.
    public static let defaultViewDefaultsKey = "cria.defaultView"
    public static let defaultWeekStart = 1
    /// The UserDefaults key the Upcoming week strip reads the week start from.
    public static let weekStartDefaultsKey = "cria.weekStart"
    /// The UserDefaults key the quick add and Ramble screens read the mode from.
    public static let quickAddDefaultsKey = "cria.quickAddMagicMode"
    /// The UserDefaults key `TimeZone.criaServerSetting` reads the timezone from.
    public static let timezoneDefaultsKey = "cria.timezone"
    public static let defaultLanguage = "en"
    public static let defaultTimezone = "UTC"

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
        language = settings?["language"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 } ?? Self.defaultLanguage
        timezone = settings?["timezone"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 } ?? Self.defaultTimezone
        let frontend = FrontendSettings.frontendSettings(of: settings?.objectValue)
        quickAddMagicMode = FrontendSettings.quickAddMagicMode(of: frontend) ?? Self.defaultQuickAddMode
        quickAddDefaults = QuickAddDefaults(frontend: frontend)
        defaultView = FrontendSettings.defaultView(of: frontend) ?? Self.defaultDefaultView
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

    /// Nil when `view` is not one Vikunja knows.
    public static func changeDefaultView(_ view: String) -> SettingsChange? {
        guard FrontendSettings.defaultViews.contains(view) else { return nil }
        return SettingsChange(frontend: [FrontendSettings.defaultViewKey: .string(view)])
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

    /// Nil when `code` is empty.
    public static func changeLanguage(_ code: String) -> SettingsChange? {
        guard !code.isEmpty else { return nil }
        return SettingsChange(settings: ["language": .string(code)])
    }

    /// Nil when `identifier` is not a timezone this device knows.
    public static func changeTimezone(_ identifier: String) -> SettingsChange? {
        guard TimeZone(identifier: identifier) != nil else { return nil }
        return SettingsChange(settings: ["timezone": .string(identifier)])
    }

    /// This value with every field a failed save changed (`previous` to `applied`) put back. Fields the save did not
    /// touch keep their current value, so another save that landed in the meantime is not reverted with it.
    public func undoing(applied: GeneralSettings, previous: GeneralSettings) -> GeneralSettings {
        var result = self
        func restore<Value: Equatable>(_ path: WritableKeyPath<GeneralSettings, Value>) {
            if applied[keyPath: path] != previous[keyPath: path] { result[keyPath: path] = previous[keyPath: path] }
        }
        restore(\.name)
        restore(\.emailRemindersEnabled)
        restore(\.overdueRemindersEnabled)
        restore(\.overdueRemindersTime)
        restore(\.quickAddMagicMode)
        restore(\.defaultView)
        restore(\.weekStart)
        restore(\.defaultProjectId)
        restore(\.discoverableByEmail)
        restore(\.discoverableByName)
        restore(\.language)
        restore(\.timezone)
        restore(\.quickAddDefaults)
        return result
    }
}

public extension TimeZone {
    /// The timezone chosen in Settings (kept in UserDefaults by the Settings screen), else the device's.
    static var criaServerSetting: TimeZone {
        let stored = UserDefaults.standard.string(forKey: GeneralSettings.timezoneDefaultsKey)
        return stored.flatMap { TimeZone(identifier: $0) } ?? .current
    }
}
