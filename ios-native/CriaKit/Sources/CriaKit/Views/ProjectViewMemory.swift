import Foundation

/// The view last opened in each project, kept on this device like Vikunja-web's per-project view memory (and the
/// desktop app's `cria:projectView:<id>`). The value is the view's local id.
public enum ProjectViewMemory {
    public static func key(projectLocalId: String) -> String { "cria.projectView.\(projectLocalId)" }

    public static func remembered(projectLocalId: String, defaults: UserDefaults = .standard) -> String? {
        defaults.string(forKey: key(projectLocalId: projectLocalId))
    }

    public static func remember(_ viewLocalId: String, projectLocalId: String, defaults: UserDefaults = .standard) {
        defaults.set(viewLocalId, forKey: key(projectLocalId: projectLocalId))
    }

    /// The view to open, as Vikunja-web picks it: the remembered one when the project still has it, else the first view
    /// of the account's default kind (Settings > Default view), else the first view.
    public static func choose(
        remembered: String?, among views: [ViewRecord], defaultView: String = GeneralSettings.defaultDefaultView
    ) -> ViewRecord? {
        if let match = views.first(where: { $0.localId == remembered }) { return match }
        if defaultView != GeneralSettings.defaultDefaultView, let match = views.first(where: { $0.viewKind.rawValue == defaultView }) {
            return match
        }
        return views.first
    }
}
