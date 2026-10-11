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

    func clearBackgrounds() {
        services.backgrounds.clear()
        backgroundCount = services.backgrounds.count()
    }
}

/// The `@AppStorage` key `QuickAddSheet` reads.
enum QuickAddStorage {
    static let key = "cria.quickAddMagicMode"
}
