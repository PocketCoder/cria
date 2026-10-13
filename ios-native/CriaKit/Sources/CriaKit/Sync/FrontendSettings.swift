import Foundation

/// Reading and changing Vikunja's `settings.frontend_settings`, the free-form JSON blob the server stores and returns
/// verbatim. Vikunja-web keeps its own prefs there and so may other clients; Cria keeps its prefs under a `cria` key.
/// Ported from `src/sync/frontendSettings.ts`.
///
/// Pure: no store, no network. The one rule: a change sets only the keys it names and passes every other key
/// through untouched, known or not.
public enum FrontendSettings {
    /// Cria's own namespace inside frontend_settings.
    public static let criaKey = "cria"
    /// Vikunja-web's key for the Quick Add Magic mode, shared on purpose.
    public static let quickAddMagicKey = "quick_add_magic_mode"

    /// Defaults for every field Vikunja's `UpdateUser` with `forceOverride = true` would zero if omitted from a POST.
    public static let defaults: JSONBody = [
        "language": .string("en"),
        "timezone": .string("UTC"),
        "week_start": .number(1),
        "email_reminders_enabled": .bool(false),
        "overdue_tasks_reminders_enabled": .bool(false),
        "overdue_tasks_reminders_time": .string("09:00"),
        "default_project_id": .number(0),
        "discoverable_by_email": .bool(false),
        "discoverable_by_name": .bool(false)
    ]

    /// The frontend_settings blob of a settings object; empty when unset or not an object.
    public static func frontendSettings(of settings: JSONBody?) -> JSONBody {
        settings?["frontend_settings"]?.objectValue ?? [:]
    }

    /// Cria's namespaced prefs, or nil when absent.
    public static func criaPrefs(of frontendSettings: JSONBody) -> JSONBody? {
        frontendSettings[criaKey]?.objectValue
    }

    public static let quickAddMagicModes: Set<String> = ["disabled", "todoist", "vikunja"]

    /// The user's Quick Add Magic mode, or nil when unset or not a known mode.
    public static func quickAddMagicMode(of frontendSettings: JSONBody) -> String? {
        guard case .string(let mode)? = frontendSettings[quickAddMagicKey], quickAddMagicModes.contains(mode) else { return nil }
        return mode
    }

    /// The full POST body for `change`: the server's current settings with only the named fields replaced. The settings
    /// POST overwrites every column (omitted fields become Go zero values), so `server` must be fresh from the server,
    /// never a cached copy. Defaults fill any field an older server leaves out.
    public static func applying(_ change: SettingsChange, to server: JSONBody?) -> JSONBody {
        var body = defaults.merging(server ?? [:]) { _, new in new }
        body.merge(change.settings) { _, new in new }
        if !change.frontend.isEmpty || !change.cria.isEmpty {
            let current = frontendSettings(of: server)
            var next = current.merging(change.frontend) { _, new in new }
            if !change.cria.isEmpty {
                next[criaKey] = .object((criaPrefs(of: current) ?? [:]).merging(change.cria) { _, new in new })
            }
            body["frontend_settings"] = .object(next)
        }
        return body
    }

    /// The v2 PATCH body for `change`: a JSON merge-patch (RFC 7386) naming only the changed fields. The server merges
    /// it into what it holds, so every key the change does not name keeps its stored value, whoever wrote it. A null
    /// deletes a key in a merge-patch, and a deleted top-level field is written back as its Go zero value, so nulls are
    /// left out: a save can set keys but never remove one.
    public static func mergePatch(_ change: SettingsChange) -> JSONBody {
        var patch = withoutNulls(change.settings)
        var frontend = withoutNulls(change.frontend)
        let cria = withoutNulls(change.cria)
        if !cria.isEmpty { frontend[criaKey] = .object(cria) }
        if !frontend.isEmpty { patch["frontend_settings"] = .object(frontend) }
        return patch
    }

    static func withoutNulls(_ value: JSONBody) -> JSONBody {
        var out: JSONBody = [:]
        for (key, member) in value {
            switch member {
            case .null: continue
            case .object(let nested): out[key] = .object(withoutNulls(nested))
            default: out[key] = member
            }
        }
        return out
    }
}

/// One user change to the general settings. Anything not named is left as it is.
public struct SettingsChange: Equatable, Sendable {
    /// Top-level fields (name, week_start, ...). Do not put `frontend_settings` here.
    public var settings: JSONBody
    /// frontend_settings keys to set, e.g. `quick_add_magic_mode`. Give plain values: the v1 POST replaces an object
    /// value whole, the v2 merge-patch merges it into the stored one.
    public var frontend: JSONBody
    /// Cria prefs to set inside frontend_settings.cria, merged key by key.
    public var cria: JSONBody

    public init(settings: JSONBody = [:], frontend: JSONBody = [:], cria: JSONBody = [:]) {
        self.settings = settings
        self.frontend = frontend
        self.cria = cria
    }
}

extension JSONValue {
    var objectValue: [String: JSONValue]? {
        if case .object(let value) = self { return value }
        return nil
    }
}
