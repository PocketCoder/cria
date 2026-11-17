import CriaKit
import Observation
import SwiftUI

/// Multi-select state for a list screen. Rows read it from the environment: while it is active a row shows a tick
/// circle and a tap toggles it instead of opening the task.
@MainActor @Observable
final class TaskSelection {
    private(set) var isActive = false
    private(set) var ids: Set<String> = []
    /// A message for the screen's alert, set when a bulk action could not write every task.
    var failure: String?

    var count: Int { ids.count }

    func start(with id: String? = nil) {
        isActive = true
        ids = id.map { [$0] } ?? []
    }

    func stop() {
        isActive = false
        ids = []
    }

    func contains(_ id: String) -> Bool { ids.contains(id) }

    func toggle(_ id: String) {
        if ids.contains(id) { ids.remove(id) } else { ids.insert(id) }
    }
}

extension View {
    /// Adds multi-select to a task list screen: the shared selection for its rows, and the bulk action bar above the
    /// tab bar while it is active.
    func taskSelection(_ selection: TaskSelection, services: AppServices) -> some View {
        modifier(TaskSelectionHost(selection: selection, services: services))
    }
}

/// Owns the bar, its sheets and its confirmation, so they outlive the bar when an action ends the selection.
private struct TaskSelectionHost: ViewModifier {
    let selection: TaskSelection
    let services: AppServices
    @Environment(UndoCenter.self) private var undo: UndoCenter?
    @State private var scheduling = false
    @State private var moving = false
    @State private var confirmingDelete = false
    /// One tick per bulk action that saved every task, for the haptics: one per action, not one per task. Deletes
    /// play the toast's own.
    @State private var completions = 0

    private var ids: [String] { selection.ids.sorted() }
    private var store: CriaStore { services.store }

    func body(content: Content) -> some View {
        content
            .environment(selection)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if selection.isActive {
                    SelectionBar(
                        count: selection.count,
                        onComplete: { perform({ $0.bulkComplete($1) }, onAllSaved: { completions += 1 }) },
                        onSchedule: { scheduling = true },
                        onDefer: { preset in perform { $0.bulkDefer($1, preset: preset) } },
                        onMove: { moving = true },
                        onPriority: { priority in perform { $0.bulkSetPriority($1, priority: priority) } },
                        onDelete: delete
                    )
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .animation(.snappy, value: selection.isActive)
            .sheet(isPresented: $scheduling) {
                DateSheet(title: "Schedule", iso: nil) { iso, _ in perform { $0.bulkSchedule($1, dueDate: iso) } }
            }
            .sheet(isPresented: $moving) {
                BulkMoveSheet(services: services) { projectId in perform { $0.bulkMove($1, toProject: projectId) } }
            }
            .confirmationDialog(
                "Delete \(selection.count) tasks?", isPresented: $confirmingDelete, titleVisibility: .visible
            ) {
                Button("Delete \(selection.count) tasks", role: .destructive) {
                    perform { $0.bulkDelete($1, undoWindow: UndoCenter.window) }
                }
            }
            .sensoryFeedback(.success, trigger: completions)
            .errorHaptic(selection.failure)
            .alert("Could not update every task", isPresented: Binding(
                get: { selection.failure != nil }, set: { if !$0 { selection.failure = nil } }
            )) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(selection.failure ?? "")
            }
    }

    /// Ends the selection and runs the bulk action off the main thread (one write per task, which a sync holding the
    /// database would otherwise stall the window on). Then offers Undo for what changed (one step for the whole
    /// action) and reports any task that did not save; `onAllSaved` runs when every task saved.
    private func perform(
        _ work: @escaping @Sendable (CriaStore, [String]) -> BulkResult, onAllSaved: @escaping @MainActor () -> Void = {}
    ) {
        let store = store
        let ids = ids
        selection.stop()
        Task {
            let result = await Task.detached(priority: .userInitiated) { work(store, ids) }.value
            undo.record(result.undo)
            if result.failures.isEmpty {
                onAllSaved()
            } else {
                selection.failure = result.failures.joined(separator: "\n")
            }
        }
    }

    /// One task goes through Undo like a swipe delete. Several have no single Undo, so they ask first.
    private func delete() {
        guard ids.count == 1, let undo, let id = ids.first, let task = try? store.task(localId: id) else {
            confirmingDelete = true
            return
        }
        do {
            try undo.deleteTask(localId: id, title: task.title)
            selection.stop()
        } catch {
            selection.failure = String(describing: error)
            selection.stop()
        }
    }
}
