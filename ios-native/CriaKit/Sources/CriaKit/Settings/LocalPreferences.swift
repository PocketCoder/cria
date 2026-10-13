import Foundation

/// The appearance choice. Raw values match the `colorScheme` pref the Tauri build keeps in `frontend_settings.cria`.
public enum ColorSchemePreference: String, CaseIterable, Sendable {
    case system
    case light
    case dark
}

/// Date style for rows and labels. `automatic` is the compact "d MMM" the app has always used; the others match the
/// Tauri build's numeric patterns.
public enum DateFormatPreference: String, CaseIterable, Sendable {
    case automatic = "auto"
    case iso = "YYYY-MM-DD"
    case american = "MM/DD/YYYY"
    case european = "DD/MM/YYYY"
}

public enum TimeFormatPreference: String, CaseIterable, Sendable {
    case h24 = "24h"
    case h12 = "12h"
}

/// Client-side preferences that live only on this device. Replaces the Zustand `cria:settings/v2` store.
/// Every field here has a reader in the app target (a setting nobody reads must not ship).
public struct LocalPreferences: Equatable, Sendable {
    public var colorScheme: ColorSchemePreference
    public var dateFormat: DateFormatPreference
    public var timeFormat: TimeFormatPreference
    public var playSoundWhenDone: Bool
    /// Master switch for every notification Cria schedules on this device.
    public var notificationsEnabled: Bool
    public var morningSummaryEnabled: Bool
    /// "HH:mm"
    public var morningSummaryTime: String
    public var weeklyRoundupEnabled: Bool
    /// "HH:mm"
    public var weeklyRoundupTime: String
    /// Local id of the project photo capture files into; nil asks each time.
    public var photoProjectId: String?
    /// Label photo capture tags tasks with; empty means none.
    public var photoLabel: String
    /// "Let Ramble choose projects and labels": the on-device model files and tags each task from the existing names.
    public var rambleChoosesTags: Bool
    /// Order of the task screen's sections. Follows the account (frontend_settings.cria).
    public var taskDetailOrder: [TaskDetailSection]
    /// Navigation, quick add, swipes, dates and links (Settings > Customise).
    public var custom: Customisation

    public static let `default` = LocalPreferences()

    public init(
        colorScheme: ColorSchemePreference = .system,
        dateFormat: DateFormatPreference = .automatic,
        timeFormat: TimeFormatPreference = .h24,
        playSoundWhenDone: Bool = false,
        notificationsEnabled: Bool = true,
        morningSummaryEnabled: Bool = true,
        morningSummaryTime: String = "08:00",
        weeklyRoundupEnabled: Bool = true,
        weeklyRoundupTime: String = "09:00",
        photoProjectId: String? = nil,
        photoLabel: String = "shopping",
        rambleChoosesTags: Bool = false,
        taskDetailOrder: [TaskDetailSection] = TaskDetailSection.defaultOrder,
        custom: Customisation = .default
    ) {
        self.colorScheme = colorScheme
        self.dateFormat = dateFormat
        self.timeFormat = timeFormat
        self.playSoundWhenDone = playSoundWhenDone
        self.notificationsEnabled = notificationsEnabled
        self.morningSummaryEnabled = morningSummaryEnabled
        self.morningSummaryTime = morningSummaryTime
        self.weeklyRoundupEnabled = weeklyRoundupEnabled
        self.weeklyRoundupTime = weeklyRoundupTime
        self.photoProjectId = photoProjectId
        self.photoLabel = photoLabel
        self.rambleChoosesTags = rambleChoosesTags
        self.taskDetailOrder = taskDetailOrder
        self.custom = custom
    }

    /// Reads values leniently: a missing or unknown value falls back to the default for that field only.
    init(values: JSONBody) {
        let base = Self.default
        func text(_ key: String) -> String? {
            if case .string(let value)? = values[key] { return value }
            return nil
        }
        func flag(_ key: String, _ fallback: Bool) -> Bool {
            if case .bool(let value)? = values[key] { return value }
            return fallback
        }
        func clock(_ key: String, _ fallback: String) -> String {
            text(key).flatMap { Self.isClockTime($0) ? $0 : nil } ?? fallback
        }
        colorScheme = text("colorScheme").flatMap(ColorSchemePreference.init(rawValue:)) ?? base.colorScheme
        dateFormat = text("dateFormat").flatMap(DateFormatPreference.init(rawValue:)) ?? base.dateFormat
        timeFormat = text("timeFormat").flatMap(TimeFormatPreference.init(rawValue:)) ?? base.timeFormat
        playSoundWhenDone = flag("playSoundWhenDone", base.playSoundWhenDone)
        notificationsEnabled = flag("notificationsEnabled", base.notificationsEnabled)
        morningSummaryEnabled = flag("morningSummaryEnabled", base.morningSummaryEnabled)
        morningSummaryTime = clock("morningSummaryTime", base.morningSummaryTime)
        weeklyRoundupEnabled = flag("weeklyRoundupEnabled", base.weeklyRoundupEnabled)
        weeklyRoundupTime = clock("weeklyRoundupTime", base.weeklyRoundupTime)
        photoProjectId = text("photoProjectId").flatMap { $0.isEmpty ? nil : $0 }
        photoLabel = text("photoLabel") ?? base.photoLabel
        rambleChoosesTags = flag("rambleChoosesTags", base.rambleChoosesTags)
        taskDetailOrder = text("taskDetailOrder").map(TaskDetailSection.order(from:)) ?? base.taskDetailOrder
        custom = Customisation(values: values)
    }

    var values: JSONBody {
        var body: JSONBody = [
            "colorScheme": .string(colorScheme.rawValue),
            "dateFormat": .string(dateFormat.rawValue),
            "timeFormat": .string(timeFormat.rawValue),
            "playSoundWhenDone": .bool(playSoundWhenDone),
            "notificationsEnabled": .bool(notificationsEnabled),
            "morningSummaryEnabled": .bool(morningSummaryEnabled),
            "morningSummaryTime": .string(morningSummaryTime),
            "weeklyRoundupEnabled": .bool(weeklyRoundupEnabled),
            "weeklyRoundupTime": .string(weeklyRoundupTime),
            "photoLabel": .string(photoLabel),
            "rambleChoosesTags": .bool(rambleChoosesTags),
            "taskDetailOrder": .string(TaskDetailSection.text(of: taskDetailOrder))
        ]
        if let photoProjectId { body["photoProjectId"] = .string(photoProjectId) }
        body.merge(custom.values) { current, _ in current }
        return body
    }

    /// "HH:mm" with a valid hour and minute.
    static func isClockTime(_ text: String) -> Bool {
        let parts = text.split(separator: ":")
        guard parts.count == 2, parts[0].count == 2, parts[1].count == 2,
              let hour = Int(parts[0]), let minute = Int(parts[1]) else { return false }
        return (0..<24).contains(hour) && (0..<60).contains(minute)
    }
}

/// One step that upgrades stored values from `from` to `from + 1`.
public struct PreferenceMigration: Sendable {
    public let from: Int
    public let apply: @Sendable (JSONBody) -> JSONBody

    public init(from: Int, apply: @escaping @Sendable (JSONBody) -> JSONBody) {
        self.from = from
        self.apply = apply
    }
}

/// Versioned persistence. The stored blob is `{"version": N, "values": {...}}`. Bump `currentVersion` and append a
/// `PreferenceMigration` together; a bare change of shape would silently reset every preference.
public struct PreferencesCodec: Sendable {
    public static let currentVersion = 1
    public static let migrations: [PreferenceMigration] = []

    let version: Int
    let migrations: [PreferenceMigration]

    public init(version: Int = PreferencesCodec.currentVersion, migrations: [PreferenceMigration] = PreferencesCodec.migrations) {
        self.version = version
        self.migrations = migrations
    }

    public func encode(_ preferences: LocalPreferences) -> Data {
        let envelope: JSONBody = ["version": .number(Double(version)), "values": .object(preferences.values)]
        return (try? JSONEncoder().encode(JSONValue.object(envelope))) ?? Data()
    }

    /// Defaults when the data is absent, unreadable, or written by a newer app version (never overwritten silently
    /// by a downgrade: the caller only saves on user change).
    public func decode(_ data: Data?) -> LocalPreferences {
        guard let data,
              let root = try? JSONDecoder().decode(JSONValue.self, from: data),
              case .object(let envelope) = root,
              case .number(let stored)? = envelope["version"],
              case .object(var values)? = envelope["values"] else { return .default }
        var level = Int(stored)
        guard level <= version else { return .default }
        while level < version {
            guard let step = migrations.first(where: { $0.from == level }) else { return .default }
            values = step.apply(values)
            level += 1
        }
        return LocalPreferences(values: values)
    }
}

/// UserDefaults-backed store for `LocalPreferences`.
public final class PreferencesStore: @unchecked Sendable {
    public static let key = "cria.localPreferences"

    private let defaults: UserDefaults
    private let codec: PreferencesCodec

    public init(defaults: UserDefaults = .standard, codec: PreferencesCodec = PreferencesCodec()) {
        self.defaults = defaults
        self.codec = codec
    }

    public func load() -> LocalPreferences {
        codec.decode(defaults.data(forKey: Self.key))
    }

    public func save(_ preferences: LocalPreferences) {
        defaults.set(codec.encode(preferences), forKey: Self.key)
    }
}
