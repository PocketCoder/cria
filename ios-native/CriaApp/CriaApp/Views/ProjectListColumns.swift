#if os(macOS)
import CriaKit
import SwiftUI

/// The Mac List view's sections when they are on for the project: one per column of the chosen board, in board order,
/// each with its own New Task row.
enum ProjectListGrouping {
    private static let keyPrefix = "column:"

    /// Every column gets a section, even an empty one, so it still has its New Task row; the Done column only when an
    /// open task sits in it. A task the board does not place (none should be: unplaced tasks show in the default column)
    /// goes in a last, untitled section.
    static func byColumn(_ items: [TaskListItem], board: ProjectListBoard) -> [DisplaySection] {
        let columns = board.columns
        let columnOf = board.columnOf
        var grouped = Array(repeating: [TaskListItem](), count: columns.count)
        var unplaced: [TaskListItem] = []
        for item in items {
            if let index = columnOf[item.task.localId], grouped.indices.contains(index) {
                grouped[index].append(item)
            } else {
                unplaced.append(item)
            }
        }
        var sections = columns.indices.compactMap { index -> DisplaySection? in
            if columns[index].isDone && grouped[index].isEmpty { return nil }
            return DisplaySection(key: keyPrefix + columns[index].bucketLocalId, label: columns[index].title, items: grouped[index])
        }
        if !unplaced.isEmpty { sections.append(DisplaySection(key: "unplaced", label: "", items: unplaced)) }
        return sections
    }

    /// The column a group stands for; nil for a group that is not a column.
    static func column(of section: DisplaySection, in board: ProjectListBoard?) -> ProjectListColumn? {
        guard let board, section.key.hasPrefix(keyPrefix) else { return nil }
        let bucketId = String(section.key.dropFirst(keyPrefix.count))
        return board.columns.first { $0.bucketLocalId == bucketId }
    }
}

/// "New Task" at the end of a column's group: a button until clicked, then a field that adds the task to that column.
struct ProjectListAddRow: View {
    let services: AppServices
    let projectLocalId: String
    let column: ProjectListColumn
    @State private var adding = false
    @State private var draft = ""
    @State private var failure: String?
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "plus").foregroundStyle(Color(.primary)).frame(width: 18).accessibilityHidden(true)
            if adding {
                TextField("New Task", text: $draft)
                    .textFieldStyle(.plain)
                    .focused($focused)
                    .onSubmit { add() }
                    .onExitCommand { cancel() }
                    .onChange(of: focused) { _, now in if !now && draft.trimmingCharacters(in: .whitespaces).isEmpty { cancel() } }
            } else {
                Button("New Task") {
                    adding = true
                    focused = true
                }
                .buttonStyle(.plain)
                .macPointer()
                .foregroundStyle(MacTheme.label2)
                .accessibilityLabel("New task in \(column.title)")
            }
            Spacer(minLength: 0)
        }
        .font(.system(size: 13))
        .frame(minHeight: 28)
        .alert("Could not save", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(failure ?? "")
        }
    }

    private func cancel() {
        draft = ""
        adding = false
    }

    /// Adds the task and keeps the field open for the next one.
    private func add() {
        let title = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        draft = ""
        guard !title.isEmpty else { return }
        do {
            let task = try services.store.createTask(TaskInput(title: title, projectLocalId: projectLocalId))
            try services.store.setTaskBucket(
                taskLocalId: task.localId, viewLocalId: column.viewLocalId, bucketLocalId: column.bucketLocalId
            )
        } catch {
            failure = String(describing: error)
        }
    }
}
#endif
