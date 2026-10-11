import CriaKit
import Foundation
import Observation

/// State behind the Settings screen: the server's general settings, saved one field at a time.
@MainActor @Observable
final class SettingsModel {
    var general = GeneralSettings(user: .null)
    var username = ""
    var errorMessage: String?
    var backgroundCount = 0
    /// Server base URL, for the About section.
    var server = ""
    private(set) var loaded = false
    private let services: AppServices

    init(services: AppServices) {
        self.services = services
        backgroundCount = services.backgrounds.count()
    }

    func load() async {
        do {
            let user: JSONValue = try await services.api.get("/user")
            general = GeneralSettings(user: user)
            username = user["username"]?.stringValue ?? ""
            UserDefaults.standard.set(general.quickAddMagicMode, forKey: QuickAddStorage.key)
            UserDefaults.standard.set(general.weekStart, forKey: GeneralSettings.weekStartDefaultsKey)
            // Only a zone the server really holds; an unset one keeps the device's.
            if !(user["settings"]?["timezone"]?.stringValue ?? "").isEmpty {
                UserDefaults.standard.set(general.timezone, forKey: GeneralSettings.timezoneDefaultsKey)
            }
            server = await services.api.serverBase() ?? ""
            NotificationCenter.default.post(name: .criaPreferencesChanged, object: nil)
            loaded = true
        } catch {
            errorMessage = String(describing: error)
        }
    }

    /// Applies the change to the local copy first (`apply`), then saves; on failure reloads the server's values.
    func save(_ change: SettingsChange?, apply: (inout GeneralSettings) -> Void) async {
        guard let change, let service = services.settings else { return }
        apply(&general)
        do {
            try await service.save(change)
            errorMessage = nil
        } catch {
            errorMessage = String(describing: error)
            await load()
        }
    }

    func setQuickAddMode(_ mode: String) async {
        UserDefaults.standard.set(mode, forKey: QuickAddStorage.key)
        await save(GeneralSettings.changeQuickAddMode(mode)) { $0.quickAddMagicMode = mode }
    }

    func setWeekStart(_ day: Int) async {
        UserDefaults.standard.set(day, forKey: GeneralSettings.weekStartDefaultsKey)
        await save(GeneralSettings.changeWeekStart(day)) { $0.weekStart = day }
        // The weekly round-up lands on the week start day.
        NotificationCenter.default.post(name: .criaPreferencesChanged, object: nil)
    }

    func setLanguage(_ code: String) async {
        await save(GeneralSettings.changeLanguage(code)) { $0.language = code }
    }

    /// `TimeZone.criaServerSetting` reads the stored identifier when tasks are pushed.
    func setTimezone(_ identifier: String) async {
        guard GeneralSettings.changeTimezone(identifier) != nil else { return }
        UserDefaults.standard.set(identifier, forKey: GeneralSettings.timezoneDefaultsKey)
        await save(GeneralSettings.changeTimezone(identifier)) { $0.timezone = identifier }
    }

    /// The IANA identifiers the server accepts; the device's own list if the request fails.
    func timezones() async -> [String] {
        if let zones: [String] = try? await services.api.get("/user/timezones"), !zones.isEmpty { return zones }
        return TimeZone.knownTimeZoneIdentifiers.sorted()
    }

    func setDefaultProject(_ serverId: Int) async {
        await save(GeneralSettings.changeDefaultProject(serverId)) { $0.defaultProjectId = serverId }
        services.rememberDefaultProject(serverId: serverId)
    }

    func clearBackgrounds() {
        services.backgrounds.clear()
        backgroundCount = services.backgrounds.count()
    }
}

/// The `@AppStorage` key `QuickAddSheet` reads.
enum QuickAddStorage {
    static let key = GeneralSettings.quickAddDefaultsKey
}
