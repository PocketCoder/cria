import Foundation

/// One language Vikunja offers.
public struct LanguageOption: Equatable, Sendable, Identifiable {
    public let code: String
    public let label: String
    public var id: String { code }

    public init(code: String, label: String) {
        self.code = code
        self.label = label
    }
}

/// Timezones of one region ("Europe"), labelled without the region and with spaces for underscores.
public struct TimezoneGroup: Equatable, Sendable, Identifiable {
    public struct Item: Equatable, Sendable, Identifiable {
        public let value: String
        public let label: String
        public var id: String { value }

        public init(value: String, label: String) {
            self.value = value
            self.label = label
        }
    }

    public let label: String
    public let items: [Item]
    public var id: String { label }

    public init(label: String, items: [Item]) {
        self.label = label
        self.items = items
    }
}

/// The language list and timezone grouping of the Tauri General tab (`GeneralTab.tsx`).
public enum SettingsOptions {
    public static let languages: [LanguageOption] = [
        ("en", "English"), ("de", "Deutsch"), ("fr", "Français"), ("es", "Español"), ("pt_BR", "Português (Brasil)"),
        ("nl", "Nederlands"), ("pl", "Polski"), ("ru", "Русский"), ("zh", "中文"), ("ja", "日本語"), ("ko", "한국어"),
        ("it", "Italiano"), ("sv", "Svenska"), ("cs", "Čeština"), ("uk", "Українська"), ("ca", "Català")
    ].map { LanguageOption(code: $0.0, label: $0.1) }

    /// The options plus the current code when the server holds one the list lacks, so the picker never shows blank.
    public static func languages(including current: String) -> [LanguageOption] {
        languages.contains { $0.code == current } ? languages : languages + [LanguageOption(code: current, label: current)]
    }

    /// Groups identifiers by region (the part before the first "/"; none goes to "Other"), regions and items sorted.
    public static func groupTimezones(_ zones: [String]) -> [TimezoneGroup] {
        var groups: [String: [TimezoneGroup.Item]] = [:]
        for zone in zones {
            let spaced = zone.replacingOccurrences(of: "_", with: " ")
            if let slash = zone.firstIndex(of: "/") {
                let region = String(zone[..<slash])
                let rest = String(spaced[spaced.index(after: spaced.firstIndex(of: "/") ?? spaced.startIndex)...])
                groups[region, default: []].append(TimezoneGroup.Item(value: zone, label: rest))
            } else {
                groups["Other", default: []].append(TimezoneGroup.Item(value: zone, label: spaced))
            }
        }
        return groups.keys.sorted { $0.localizedCompare($1) == .orderedAscending }.map { region in
            let items = (groups[region] ?? []).sorted { $0.label.localizedCompare($1.label) == .orderedAscending }
            return TimezoneGroup(label: region, items: items)
        }
    }
}
