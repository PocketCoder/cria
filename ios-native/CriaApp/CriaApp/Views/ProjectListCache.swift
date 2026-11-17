import CriaKit
import SwiftUI

#if os(macOS)
/// The last list read for the few most recent projects, so switching back to one shows its tasks on the first frame
/// (then refreshes from the database as usual), and a project the pointer rests on in the sidebar is read before the
/// click. In memory only; eight projects at most.
@MainActor
enum ProjectListCache {
    private static var entries: [String: ProjectListData] = [:]
    private static var recent: [String] = []
    private static let limit = 8

    static func value(for projectLocalId: String) -> ProjectListData? {
        entries[projectLocalId]
    }

    static func store(_ data: ProjectListData, for projectLocalId: String) {
        entries[projectLocalId] = data
        recent.removeAll { $0 == projectLocalId }
        recent.append(projectLocalId)
        while recent.count > limit { entries[recent.removeFirst()] = nil }
    }

    /// Reads a project's list off the main thread into the cache, unless it is already there.
    static func warm(services: AppServices, projectLocalId: String) async {
        guard entries[projectLocalId] == nil else { return }
        let store = services.store
        let data = await Task.detached(priority: .userInitiated) {
            try? ProjectListData.read(store, projectLocalId: projectLocalId)
        }.value
        guard let data, !Task.isCancelled, entries[projectLocalId] == nil else { return }
        self.store(data, for: projectLocalId)
    }
}
#endif
