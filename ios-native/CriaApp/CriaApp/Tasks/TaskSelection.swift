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

    private var ids: [String] { selection.ids.sorted() }
    private var store: CriaStore { services.store }

    func body(content: Content) -> some View {
        content
            .environment(selection)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if selection.isActive {
                    SelectionBar(
                        count: selection.count,
                        onComplete: { finish(store.bulkComplete(ids)) },
                        onSchedule: { scheduling = true },
                        onDefer: { preset in finish(store.bulkDefer(ids, preset: preset)) },
                        onMove: { moving = true },
                        onPriority: { priority in finish(store.bulkSetPriority(ids, priority: priority)) },
                        onDelete: delete
                    )
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .animation(.snappy, value: selection.isActive)
            .sheet(isPresented: $scheduling) {
                DateSheet(title: "Schedule", iso: nil) { iso, _ in finish(store.bulkSchedule(ids, dueDate: iso)) }
            }
            .sheet(isPresented: $moving) {
                BulkMoveSheet(services: services) { projectId in finish(store.bulkMove(ids, toProject: projectId)) }
            }
            .confirmationDialog(
                "Delete \(selection.count) tasks?", isPresented: $confirmingDelete, titleVisibility: .visible
            ) {
                Button("Delete \(selection.count) tasks", role: .destructive) { finish(store.bulkDelete(ids)) }
            }
            .alert("Could not update every task", isPresented: Binding(
                get: { selection.failure != nil }, set: { if !$0 { selection.failure = nil } }
            )) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(selection.failure ?? "")
            }
    }

    /// Ends the selection and reports any task that did not save.
    private func finish(_ result: BulkResult) {
        if !result.failures.isEmpty { selection.failure = result.failures.joined(separator: "\n") }
        selection.stop()
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
