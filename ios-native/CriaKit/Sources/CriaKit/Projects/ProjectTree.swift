import Foundation

/// One visible row of the project tree.
public struct ProjectTreeRow: Equatable, Sendable {
    public let project: ProjectRecord
    public let depth: Int
    public let hasChildren: Bool
    public let isExpanded: Bool
}

public enum ProjectTree {
    /// Projects shown in the tree. Negative server ids are Vikunja pseudo-projects (-1 Favorites, below that saved
    /// filters), which render elsewhere. Ported from `visibleProjectList` in `sidebarLogic.ts`.
    public static func visible(_ projects: [ProjectRecord], includeArchived: Bool = false) -> [ProjectRecord] {
        projects.filter { project in
            let real = project.serverId.map { $0 > 0 } ?? true
            return real && project.title != "Favorites" && (includeArchived || !project.isArchived)
        }
    }

    /// Direct children of `parentLocalId` (nil = roots). A project whose parent is not visible surfaces as a root,
    /// so nothing is hidden. Order follows the input. Ported from `childProjectsOf`.
    public static func children(of parentLocalId: String?, in projects: [ProjectRecord]) -> [ProjectRecord] {
        let ids = Set(projects.map(\.localId))
        return projects.filter { project in
            let effective = project.parentLocalId.flatMap { ids.contains($0) ? $0 : nil }
            return effective == parentLocalId
        }
    }

    /// The tree flattened depth-first. Collapsed projects hide their descendants; the default is open.
    public static func rows(_ projects: [ProjectRecord], collapsed: Set<String> = []) -> [ProjectTreeRow] {
        var result: [ProjectTreeRow] = []
        var seen = Set<String>()
        func walk(_ parent: String?, depth: Int) {
            for project in children(of: parent, in: projects) where seen.insert(project.localId).inserted {
                let kids = children(of: project.localId, in: projects)
                let expanded = !collapsed.contains(project.localId)
                result.append(ProjectTreeRow(project: project, depth: depth, hasChildren: !kids.isEmpty, isExpanded: expanded))
                if expanded { walk(project.localId, depth: depth + 1) }
            }
        }
        walk(nil, depth: 0)
        return result
    }

    /// Every id under `localId`, used to stop a project becoming its own ancestor.
    public static func descendantIds(of localId: String, in projects: [ProjectRecord]) -> Set<String> {
        var found = Set<String>()
        var queue = [localId]
        while let next = queue.popLast() {
            for child in children(of: next, in: projects) where found.insert(child.localId).inserted {
                queue.append(child.localId)
            }
        }
        return found
    }
}
