import AppKit
import SwiftUI

/// Edit > Undo (⌘Z): a focused text view keeps its own undo; otherwise the last task action is taken back.
@MainActor
enum MacUndoRouting {
    static func undo(_ actions: MacActions?) {
        if NSApp.keyWindow?.firstResponder is NSText {
            NSApp.sendAction(Selector(("undo:")), to: nil, from: nil)
        } else {
            actions?.undo?.undo()
        }
    }
}

/// The menu bar, item for item as the macOS design lists it. Every item reaches the window through `MacActions`;
/// with no window focused they are disabled. About, Settings, Hide, Quit, Close Window, Edit (bar Undo and Redo) and
/// Window are the system's.
struct MacCommands: Commands {
    @FocusedValue(\.macActions) private var actions

    var body: some Commands {
        CommandGroup(after: .appInfo) {
            CheckForUpdatesCommand(updater: .shared)
        }
        // Undo and Redo stay the responder chain's while a text field or the editor has focus; with none, ⌘Z takes
        // back the last task action (the toast's Undo).
        CommandGroup(replacing: .undoRedo) {
            Button("Undo") { MacUndoRouting.undo(actions) }
                .keyboardShortcut("z")
            Button("Redo") { NSApp.sendAction(Selector(("redo:")), to: nil, from: nil) }
                .keyboardShortcut("z", modifiers: [.command, .shift])
        }
        CommandGroup(replacing: .newItem) {
            Button("New Task") { actions?.newTask() }
                .keyboardShortcut("n")
                .disabled(actions == nil)
            Button("New Project") { actions?.creatingProject = true }
                .keyboardShortcut("n", modifiers: [.command, .shift])
                .disabled(actions == nil)
            Button("New Saved Filter…") { actions?.sidebar.newFilter() }
                .disabled(actions == nil)
            Divider()
            Button("Ramble to Tasks…") { actions?.showingRamble = true }
                .disabled(actions == nil || !AIStatus.shared.isOfferable)
            Button("List from Photo…") { actions?.showingPhoto = true }
                .disabled(actions == nil)
            Divider()
        }
        CommandGroup(after: .sidebar) {
            Button(actions?.columns == .detailOnly ? "Show Sidebar" : "Hide Sidebar") { actions?.toggleSidebar() }
                .keyboardShortcut("e")
                .disabled(actions == nil)
            Divider()
            viewItem("List", kind: "list")
            viewItem("Kanban", kind: "kanban")
            viewItem("Table", kind: "table")
            viewItem("Gantt", kind: "gantt")
            Button("Show Project Info") { actions?.toggleProjectInfo() }
                .keyboardShortcut("i", modifiers: [.command, .option])
                .disabled(actions?.projectOnScreen == nil)
        }
        CommandMenu("Go") {
            Button("Today") { actions?.go(.today) }.keyboardShortcut("1").disabled(actions == nil)
            Button("Upcoming") { actions?.go(.upcoming) }.keyboardShortcut("2").disabled(actions == nil)
            Button("Inbox") { actions?.go(.inbox) }.keyboardShortcut("3").disabled(actions == nil)
            Button("Favourites") { actions?.go(.favorites) }.keyboardShortcut("4").disabled(actions == nil)
            Button("Search") { actions?.go(.search) }.keyboardShortcut("f").disabled(actions == nil)
            Divider()
            Button("Labels…") { actions?.sidebar.showingLabels = true }.disabled(actions == nil)
            Button("Teams…") { actions?.sidebar.showingTeams = true }.disabled(actions == nil)
            Divider()
            Button("Command Palette…") { actions?.showingPalette = true }.keyboardShortcut("k").disabled(actions == nil)
            // Not in the design's menu, kept so a manual sync still has a home and a key.
            Divider()
            Button("Sync Now") { actions?.syncNow() }.keyboardShortcut("r").disabled(actions == nil)
            Button("Full Sync") { actions?.fullSync() }.keyboardShortcut("r", modifiers: [.command, .shift]).disabled(actions == nil)
        }
        CommandMenu("Task") {
            if actions?.hasCommandTarget != true {
                Button("Select a task to see its commands") {}.disabled(true)
            } else {
                taskItems
            }
        }
        CommandGroup(replacing: .help) {
            // `?` works outside text fields (`KeySequencer`); as a menu key equivalent it would swallow it while typing.
            Button("Keyboard Shortcuts") { actions?.showingShortcuts = true }.disabled(actions == nil)
        }
    }

    /// A project view: checkmarked when it is the one on screen, enabled only on a project. Its `g` sequence has no
    /// menu key equivalent, as one cannot be two keys.
    private func viewItem(_ title: String, kind: String) -> some View {
        let project = actions?.projectOnScreen
        let isOn = project.flatMap { actions?.projectViews[$0] } == kind
        return Toggle(title, isOn: Binding(get: { isOn }, set: { _ in actions?.projectView(kind) }))
            .disabled(project == nil)
    }

    /// The task's commands, as its context menu.
    @ViewBuilder private var taskItems: some View {
        Group {
            Button("Mark as Done") { actions?.task(.done) }
            Button("Open") { if let id = actions?.commandTarget { actions?.openTask(id) } }
            Divider()
            Button("Due Date…") { actions?.task(.due) }
            Button("Priority…") { actions?.task(.priority) }
            Button("Labels…") { actions?.task(.labels) }
            Button("Move to…") { actions?.task(.move) }
            Divider()
            Button("Add to Favourites") { actions?.task(.favourite) }
            Button("Copy Link") { actions?.task(.copyLink) }.keyboardShortcut(".")
            Button("Subscribe or Unsubscribe") { actions?.task(.subscribe) }
            Button("Duplicate") { actions?.duplicateTarget() }
            Divider()
            // No key equivalent: ⌘⌫ there fired while editing the title or description. Plain ⌫ outside a text field
            // still deletes (`KeySequencer`).
            Button("Delete", role: .destructive) { actions?.task(.delete) }
        }
    }
}
