import CriaKit
import SwiftUI

/// Carries out `TaskCommand`s posted for this task, and hosts the two pickers that need no screen of their own.
struct TaskCommandHandler: ViewModifier {
    let taskLocalId: String
    @Binding var choosingPriority: Bool
    @Binding var choosingMove: Bool
    let projects: [ProjectRecord]
    let perform: (TaskCommand) -> Void
    let onPriority: (Int) -> Void
    let onMove: (String) -> Void

    func body(content: Content) -> some View {
        content
            .onReceive(NotificationCenter.default.publisher(for: .criaTaskCommand)) { note in
                guard note.userInfo?["task"] as? String == taskLocalId,
                      let raw = note.object as? String, let command = TaskCommand(rawValue: raw) else { return }
                perform(command)
            }
            .confirmationDialog("Priority", isPresented: $choosingPriority) {
                ForEach(Array(TableCells.priorityNames.enumerated()), id: \.offset) { index, name in
                    Button(name) { onPriority(index) }
                }
            }
            .confirmationDialog("Move to project", isPresented: $choosingMove) {
                ForEach(projects, id: \.localId) { project in
                    Button(project.title) { onMove(project.localId) }
                }
            }
    }
}
