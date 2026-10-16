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

    /// Children grouped by effective parent (nil = roots), built once so the tree walk is linear. A project whose
    /// parent is not in the list counts as a root, so nothing is hidden. Order follows the input.
    public static func childIndex(_ projects: [ProjectRecord]) -> [String?: [ProjectRecord]] {
        let ids = Set(projects.map(\.localId))
        var index: [String?: [ProjectRecord]] = [:]
        for project in projects {
            let effective = project.parentLocalId.flatMap { ids.contains($0) ? $0 : nil }
            index[effective, default: []].append(project)
        }
        return index
    }

    /// Direct children of `parentLocalId` (nil = roots). Ported from `childProjectsOf`.
    public static func children(of parentLocalId: String?, in projects: [ProjectRecord]) -> [ProjectRecord] {
        childIndex(projects)[parentLocalId] ?? []
    }

    /// The tree flattened depth-first. Collapsed projects hide their descendants; the default is open. Projects whose
    /// parents form a cycle have no root above them, so they are shown as roots after the rest.
    public static func rows(_ projects: [ProjectRecord], collapsed: Set<String> = []) -> [ProjectTreeRow] {
        let index = childIndex(projects)
        var result: [ProjectTreeRow] = []
        var seen = Set<String>()
        func visit(_ project: ProjectRecord, depth: Int) {
            guard seen.insert(project.localId).inserted else { return }
            let kids = index[project.localId] ?? []
            let expanded = !collapsed.contains(project.localId)
            result.append(ProjectTreeRow(project: project, depth: depth, hasChildren: !kids.isEmpty, isExpanded: expanded))
            if expanded { for kid in kids { visit(kid, depth: depth + 1) } }
        }
        var reachable = Set<String>()
        var pending = index[nil] ?? []
        while let next = pending.popLast() {
            if reachable.insert(next.localId).inserted { pending += index[next.localId] ?? [] }
        }
        for root in index[nil] ?? [] { visit(root, depth: 0) }
        for orphan in projects where !reachable.contains(orphan.localId) { visit(orphan, depth: 0) }
        return result
    }

    /// Every id under `localId`, used to stop a project becoming its own ancestor.
    public static func descendantIds(of localId: String, in projects: [ProjectRecord]) -> Set<String> {
        let index = childIndex(projects)
        var found = Set<String>()
        var queue = [localId]
        while let next = queue.popLast() {
            for child in index[next] ?? [] where found.insert(child.localId).inserted {
                queue.append(child.localId)
            }
        }
        return found
    }
}
