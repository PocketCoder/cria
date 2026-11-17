import CriaKit
import Foundation

/// Every board task's parent title and every parent's subtask progress, read across projects, so a card can say whose
/// subtask it is even when the parent is not on the board, and a parent can show how many of its subtasks are done.
struct KanbanSubtaskInfo: Equatable, Sendable {
    var parentTitles: [String: String] = [:]
    var progress: [String: SubtaskProgress] = [:]

    static func read(_ reading: CriaStore, tasks: [TaskRecord]) throws -> KanbanSubtaskInfo {
        let byId = Dictionary(tasks.map { ($0.localId, $0) }, uniquingKeysWith: { first, _ in first })
        var info = KanbanSubtaskInfo()
        let children = try reading.subtaskMap()
        // Parents and subtasks that are not on the board, read in one go.
        var outsideIds = Set<String>()
        for (parent, kids) in children {
            let kids = Set(kids).subtracting([parent])
            if byId[parent] != nil { outsideIds.formUnion(kids.filter { byId[$0] == nil }) }
            if byId[parent] == nil, kids.contains(where: { byId[$0] != nil }) { outsideIds.insert(parent) }
        }
        let outside = try reading.tasks(localIds: outsideIds)
        func record(_ id: String) -> TaskRecord? { byId[id] ?? outside[id] }
        for (parent, kids) in children.sorted(by: { $0.key < $1.key }) {
            let kids = Set(kids).subtracting([parent])
            if byId[parent] != nil {
                var done = 0
                var total = 0
                for kid in kids {
                    guard let task = record(kid) else { continue }
                    total += 1
                    if task.done { done += 1 }
                }
                if total > 0 { info.progress[parent] = SubtaskProgress(done: done, total: total) }
            }
            for kid in kids where byId[kid] != nil && info.parentTitles[kid] == nil {
                if let title = record(parent)?.title { info.parentTitles[kid] = title }
            }
        }
        return info
    }
}
