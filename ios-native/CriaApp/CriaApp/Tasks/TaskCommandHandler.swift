import CriaKit
import SwiftUI

/// Carries out `TaskCommand`s posted for this task, and hosts the pickers that need no screen of their own. The
/// `TaskShortcut`s (assign, colour, the copy keys) are handled here in full.
struct TaskCommandHandler: ViewModifier {
    let taskLocalId: String
    @Binding var choosingPriority: Bool
    @Binding var choosingMove: Bool
    let projects: [ProjectRecord]
    let perform: (TaskCommand) -> Void
    let task: TaskRecord?
    let services: AppServices
    let sheets: TaskDetailPresentation
    let onPriority: (Int) -> Void
    let onMove: (String) -> Void
    @State private var choosingColour = false
    /// A share link has no account to assign.
    @AppStorage(LinkShareSessionFlag.key) private var isLinkShare = false

    func body(content: Content) -> some View {
        content
            .onReceive(NotificationCenter.default.publisher(for: .criaTaskCommand)) { note in
                guard note.userInfo?["task"] as? String == taskLocalId, let raw = note.object as? String else { return }
                if let shortcut = TaskShortcut(rawValue: raw) {
                    run(shortcut)
                } else if let command = TaskCommand(rawValue: raw) {
                    perform(command)
                }
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
            .confirmationDialog("Colour", isPresented: $choosingColour) {
                ForEach(taskColours.indices, id: \.self) { index in
                    Button(taskColourNames[index]) { setColour(taskColours[index]) }
                }
                Button("None") { setColour("") }
            }
    }

    private func run(_ shortcut: TaskShortcut) {
        guard let task else { return }
        switch shortcut {
        case .assign:
            if !isLinkShare { sheets.assigning = true }
        case .colour:
            choosingColour = true
        case .copyIdentifier, .copyIdentifierTitle, .copyIdentifierTitleLink:
            guard let text = shortcut.copiedText(task, link: services.taskWebURL(task)) else { return }
            sheets.copyText(text, notice: "Copied")
        }
    }

    /// An empty string clears the colour, as the colour row's None does.
    private func setColour(_ hex: String) {
        var patch = TaskPatch()
        patch.hexColor = hex
        sheets.attempt { _ = try services.store.updateTask(localId: taskLocalId, patch: patch) }
    }
}
