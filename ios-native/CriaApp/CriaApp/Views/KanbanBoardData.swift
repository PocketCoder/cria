import CriaKit
import SwiftUI

/// The board's columns, plus each card's labels for the chips.
struct KanbanBoardData: Equatable, Sendable {
    var columns: [KanbanColumn] = []
    var labels: [String: [LabelRecord]] = [:]
    /// Every label, for the filter's label choices.
    var allLabels: [LabelRecord] = []
    /// Parent local id to its subtasks' local ids, for nesting subtasks inside their parent's card.
    var children: [String: [String]] = [:]
    /// Each card's parent title and subtask progress, wherever the parent or subtasks are.
    var subtaskInfo = KanbanSubtaskInfo()

    /// Label local ids by task, for `BoardFilter`.
    var labelIds: [String: [String]] { labels.mapValues { $0.map(\.localId) } }
}

struct BucketEdit: Identifiable {
    let bucket: BucketRecord
    /// False for the last column: the server refuses to delete a view's only bucket.
    let canDelete: Bool
    var id: String { bucket.localId }
}

/// The role a column can take for its view.
enum KanbanBucketRole {
    case done, defaultColumn
}
