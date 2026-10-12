import Foundation

/// The display prefs that follow the account across devices, kept in `frontend_settings.cria` with the same keys and
/// values as the desktop app (`SYNCED_PREF_KEYS` in `src/sync/settingsSync.ts`).
public enum SyncedPreferences {
    static let colorScheme = "colorScheme"
    static let dateFormat = "dateFormat"
    static let timeFormat = "timeFormat"
    static let playSound = "playSoundWhenDone"
    /// Cria-only, so desktop leaves it alone; the iOS task screen reads it.
    static let taskDetailOrder = "taskDetailOrder"

    /// Server values laid over the local prefs. Unknown or missing values leave the local one alone.
    public static func applying(_ cria: JSONBody, to prefs: LocalPreferences) -> LocalPreferences {
        var next = prefs
        if let raw = cria[colorScheme]?.stringValue, let value = ColorSchemePreference(rawValue: raw) { next.colorScheme = value }
        if let raw = cria[dateFormat]?.stringValue, let value = DateFormatPreference(rawValue: raw) { next.dateFormat = value }
        if let raw = cria[timeFormat]?.stringValue, let value = TimeFormatPreference(rawValue: raw) { next.timeFormat = value }
        if case .bool(let value)? = cria[playSound] { next.playSoundWhenDone = value }
        if let raw = cria[taskDetailOrder]?.stringValue { next.taskDetailOrder = TaskDetailSection.order(from: raw) }
        return next
    }

    /// Only the synced prefs that differ, so another device's change to a different one survives. Nil when none did.
    public static func change(from old: LocalPreferences, to new: LocalPreferences) -> SettingsChange? {
        var cria: JSONBody = [:]
        if old.colorScheme != new.colorScheme { cria[colorScheme] = .string(new.colorScheme.rawValue) }
        if old.dateFormat != new.dateFormat { cria[dateFormat] = .string(new.dateFormat.rawValue) }
        if old.timeFormat != new.timeFormat { cria[timeFormat] = .string(new.timeFormat.rawValue) }
        if old.playSoundWhenDone != new.playSoundWhenDone { cria[playSound] = .bool(new.playSoundWhenDone) }
        if old.taskDetailOrder != new.taskDetailOrder {
            cria[taskDetailOrder] = .string(TaskDetailSection.text(of: new.taskDetailOrder))
        }
        return cria.isEmpty ? nil : SettingsChange(cria: cria)
    }
}

extension Notification.Name {
    /// Posted when local preferences change outside the Settings screen (for example, from the server).
    public static let criaSyncedPreferencesApplied = Notification.Name("cria.preferencesChanged")
}
