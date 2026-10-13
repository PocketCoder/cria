import CriaKit
import Foundation
import Observation

/// State behind the Settings screen: the server's general settings, saved one field at a time.
@MainActor @Observable
final class SettingsModel {
    var general = GeneralSettings(user: .null)
    var username = ""
    /// The last failed save, shown under the controls.
    var errorMessage: String?
    /// Why the last load failed. Kept apart from `errorMessage` so a follow-up load never hides a save error.
    private(set) var loadError: String?
    var backgroundCount = 0
    /// Server base URL, for the About section.
    var server = ""
    /// True once a load has succeeded. Server-backed controls stay disabled until then: before it `general` holds
    /// defaults, and a save from them would show (and persist) values the server never had.
    private(set) var loaded = false
    private let services: AppServices
    private var loadTask: Task<Void, Never>?
    private var savesInFlight = 0
    /// Bumped when a save starts and when it ends, so a load can tell its answer may predate a save.
    private var saveEpoch = 0
    private var reloadAfterSaves = false

    init(services: AppServices) {
        self.services = services
        backgroundCount = services.backgrounds.count()
    }

    /// The first load only. Screens call this on appear, so popping back from a pushed screen does not re-read.
    func loadIfNeeded() async {
        guard !loaded else { return }
        await load()
    }

    /// Reads the user from the server. Joins a load already running. While a save is in flight the read is deferred
    /// until the last save lands (its answer could predate the save and revert it), and an answer that raced a save
    /// is dropped and re-read.
    func load() async {
        if let running = loadTask {
            await running.value
            return
        }
        let task = Task {
            await performLoad()
            loadTask = nil
        }
        loadTask = task
        await task.value
    }

    private func performLoad() async {
        guard savesInFlight == 0 else {
            reloadAfterSaves = true
            return
        }
        for _ in 0..<5 {
            let epoch = saveEpoch
            let user: JSONValue
            do {
                user = try await services.api.get("/user")
            } catch {
                loadError = String(describing: error)
                return
            }
            if savesInFlight > 0 {
                reloadAfterSaves = true
                return
            }
            // A save started and finished while the request was out: the answer may predate it. Ask again.
            if epoch != saveEpoch { continue }
            await apply(user)
            return
        }
    }

    private func apply(_ user: JSONValue) async {
        general = GeneralSettings(user: user)
        username = user["username"]?.stringValue ?? ""
        UserDefaults.standard.set(general.quickAddMagicMode, forKey: QuickAddStorage.key)
        UserDefaults.standard.set(general.defaultView, forKey: GeneralSettings.defaultViewDefaultsKey)
        UserDefaults.standard.set(general.weekStart, forKey: GeneralSettings.weekStartDefaultsKey)
        // Only a zone the server really holds; an unset one keeps the device's.
        if !(user["settings"]?["timezone"]?.stringValue ?? "").isEmpty {
            UserDefaults.standard.set(general.timezone, forKey: GeneralSettings.timezoneDefaultsKey)
        }
        server = await services.api.serverBase() ?? ""
        NotificationCenter.default.post(name: .criaPreferencesChanged, object: nil)
        loadError = nil
        loaded = true
    }

    /// Applies the change to the local copy first (`apply`), then saves. On failure the fields it changed go back to
    /// their previous values and the server's are re-read once the last save has finished. Returns whether it saved.
    @discardableResult
    func save(_ change: SettingsChange?, apply: (inout GeneralSettings) -> Void) async -> Bool {
        guard let change, let service = services.settings else { return false }
        let previous = general
        apply(&general)
        let applied = general
        savesInFlight += 1
        saveEpoch += 1
        var saved = false
        do {
            try await service.save(change)
            errorMessage = nil
            saved = true
        } catch {
            errorMessage = String(describing: error)
            general = general.undoing(applied: applied, previous: previous)
            reloadAfterSaves = true
        }
        savesInFlight -= 1
        saveEpoch += 1
        if savesInFlight == 0, reloadAfterSaves {
            reloadAfterSaves = false
            await load()
        }
        return saved
    }

    /// The device-local copies below change only once the server has the value, so a failed save leaves them as they
    /// were (and an in-flight one never leaves the device ahead of the server).
    func setQuickAddMode(_ mode: String) async {
        let saved = await save(GeneralSettings.changeQuickAddMode(mode)) { $0.quickAddMagicMode = mode }
        if saved { UserDefaults.standard.set(mode, forKey: QuickAddStorage.key) }
    }

    func setDefaultView(_ view: String) async {
        let saved = await save(GeneralSettings.changeDefaultView(view)) { $0.defaultView = view }
        if saved { UserDefaults.standard.set(view, forKey: GeneralSettings.defaultViewDefaultsKey) }
    }

    func setWeekStart(_ day: Int) async {
        let saved = await save(GeneralSettings.changeWeekStart(day)) { $0.weekStart = day }
        guard saved else { return }
        UserDefaults.standard.set(day, forKey: GeneralSettings.weekStartDefaultsKey)
        // The weekly round-up lands on the week start day.
        NotificationCenter.default.post(name: .criaPreferencesChanged, object: nil)
    }

    func setLanguage(_ code: String) async {
        await save(GeneralSettings.changeLanguage(code)) { $0.language = code }
    }

    /// `TimeZone.criaServerSetting` reads the stored identifier when tasks are pushed.
    func setTimezone(_ identifier: String) async {
        guard GeneralSettings.changeTimezone(identifier) != nil else { return }
        let saved = await save(GeneralSettings.changeTimezone(identifier)) { $0.timezone = identifier }
        if saved { UserDefaults.standard.set(identifier, forKey: GeneralSettings.timezoneDefaultsKey) }
    }

    /// The IANA identifiers the server accepts; the device's own list if the request fails.
    func timezones() async -> [String] {
        if let zones: [String] = try? await services.api.get("/user/timezones"), !zones.isEmpty { return zones }
        return TimeZone.knownTimeZoneIdentifiers.sorted()
    }

    func setDefaultProject(_ serverId: Int) async {
        let saved = await save(GeneralSettings.changeDefaultProject(serverId)) { $0.defaultProjectId = serverId }
        if saved { services.rememberDefaultProject(serverId: serverId) }
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
