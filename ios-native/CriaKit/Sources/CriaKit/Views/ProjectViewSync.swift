import Foundation

/// The view last used in each project, shared between a user's devices through `frontend_settings.cria` (Cria-only;
/// Vikunja-web keeps this on the device). One flat key per project, `projectView.<project server id>`, whose value is the
/// view's server id: flat so a device writing one project never overwrites another device's choice for a different one.
/// Only used when the device has turned on `Customisation.syncProjectViews`; the local memory stays the one the project
/// screen reads (`ProjectViewMemory`), so everything else works offline.
public enum ProjectViewSync {
    static let prefix = "projectView."

    public static func key(projectServerId: Int) -> String { prefix + String(projectServerId) }

    /// The change that records `viewServerId` as the view last used in a project; nil unless both exist on the server.
    public static func change(projectServerId: Int?, viewServerId: Int?) -> SettingsChange? {
        guard let projectServerId, let viewServerId, projectServerId > 0, viewServerId > 0 else { return nil }
        return SettingsChange(cria: [key(projectServerId: projectServerId): .number(Double(viewServerId))])
    }

    /// Project server id to view server id, read from the account's cria prefs.
    public static func entries(in cria: JSONBody) -> [Int: Int] {
        var result: [Int: Int] = [:]
        for (key, value) in cria where key.hasPrefix(prefix) {
            guard let project = Int(key.dropFirst(prefix.count)), project > 0,
                  case .number(let view) = value, view > 0 else { continue }
            result[project] = Int(view)
        }
        return result
    }
}

extension CriaStore {
    /// Copies the account's remembered views into this device's memory, turning server ids into local ones. Projects or
    /// views this device has not synced yet are skipped; the next launch picks them up.
    public func applySyncedProjectViews(_ entries: [Int: Int], defaults: UserDefaults = .standard) throws {
        guard !entries.isEmpty else { return }
        let projectByServerId = Dictionary(
            try projects().compactMap { project in project.serverId.map { ($0, project.localId) } },
            uniquingKeysWith: { first, _ in first }
        )
        for (projectServerId, viewServerId) in entries {
            guard let projectLocalId = projectByServerId[projectServerId],
                  let view = try views(forProject: projectLocalId).first(where: { $0.serverId == viewServerId }) else { continue }
            ProjectViewMemory.remember(view.localId, projectLocalId: projectLocalId, defaults: defaults)
        }
    }

    /// The change for a view just chosen on this device; nil when either side has no server id yet.
    public func syncedProjectViewChange(projectLocalId: String, viewLocalId: String) throws -> SettingsChange? {
        guard let project = try project(localId: projectLocalId), let view = try view(localId: viewLocalId) else { return nil }
        return ProjectViewSync.change(projectServerId: project.serverId, viewServerId: view.serverId)
    }
}
