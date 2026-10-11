import Foundation

/// The appearance choice. Raw values match the `colorScheme` pref the Tauri build keeps in `frontend_settings.cria`.
public enum ColorSchemePreference: String, CaseIterable, Sendable {
    case system
    case light
    case dark
}

/// Client-side preferences that live only on this device. Replaces the Zustand `cria:settings/v2` store.
/// Every field here has a reader in the app target (a setting nobody reads must not ship).
public struct LocalPreferences: Equatable, Sendable {
    public var colorScheme: ColorSchemePreference

    public static let `default` = LocalPreferences(colorScheme: .system)

    public init(colorScheme: ColorSchemePreference) {
        self.colorScheme = colorScheme
    }

    /// Reads values leniently: a missing or unknown value falls back to the default for that field only.
    init(values: JSONBody) {
        let raw = values["colorScheme"].flatMap { value -> String? in
            if case .string(let text) = value { return text }
            return nil
        }
        colorScheme = raw.flatMap(ColorSchemePreference.init(rawValue:)) ?? Self.default.colorScheme
    }

    var values: JSONBody {
        ["colorScheme": .string(colorScheme.rawValue)]
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
