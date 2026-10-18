import SwiftUI

/// The menu bar. Every item reaches the window through `MacActions`; with no window focused they are disabled.
struct MacCommands: Commands {
    @FocusedValue(\.macActions) private var actions

    var body: some Commands {
        CommandGroup(after: .appInfo) {
            CheckForUpdatesCommand(updater: .shared)
        }
        CommandGroup(replacing: .newItem) {
            Button("New Task") { actions?.newTask() }
                .keyboardShortcut("n")
                .disabled(actions == nil)
            Button("New Project") { actions?.creatingProject = true }
                .keyboardShortcut("n", modifiers: [.command, .shift])
                .disabled(actions == nil)
            Button("New Saved Filter…") { actions?.sidebar.newFilter() }
                .keyboardShortcut("n", modifiers: [.command, .option])
                .disabled(actions == nil)
        }
        CommandGroup(after: .sidebar) {
            Button(actions?.columns == .detailOnly ? "Show Sidebar" : "Hide Sidebar") { actions?.toggleSidebar() }
                .keyboardShortcut("e")
                .disabled(actions == nil)
            Divider()
            Button("List") { actions?.projectView("list") }.disabled(actions == nil)
            Button("Kanban") { actions?.projectView("kanban") }.disabled(actions == nil)
            Button("Table") { actions?.projectView("table") }.disabled(actions == nil)
            Button("Gantt") { actions?.projectView("gantt") }.disabled(actions == nil)
            Divider()
            Button("Show Project Info") { actions?.toggleProjectInfo() }
                .keyboardShortcut("i", modifiers: [.command, .option])
                .disabled(actions == nil)
        }
        CommandMenu("Go") {
            Button("Today") { actions?.go(.today) }.keyboardShortcut("1").disabled(actions == nil)
            Button("Upcoming") { actions?.go(.upcoming) }.keyboardShortcut("2").disabled(actions == nil)
            Button("Inbox") { actions?.go(.inbox) }.keyboardShortcut("3").disabled(actions == nil)
            Button("Search") { actions?.go(.search) }.keyboardShortcut("f").disabled(actions == nil)
            Button("Labels…") { actions?.sidebar.showingLabels = true }.disabled(actions == nil)
            Button("Teams…") { actions?.sidebar.showingTeams = true }.disabled(actions == nil)
            Divider()
            Button("Command Palette") { actions?.showingPalette = true }.keyboardShortcut("k").disabled(actions == nil)
            Divider()
            Button("Sync Now") { actions?.syncNow() }.keyboardShortcut("r").disabled(actions == nil)
        }
        CommandMenu("Task") {
            if actions?.hasOpenTask != true {
                Button("Select a task to see its commands") {}.disabled(true)
            } else {
                taskItems
            }
        }
        CommandGroup(replacing: .help) {
            Button("Keyboard Shortcuts") { actions?.showingShortcuts = true }.disabled(actions == nil)
        }
    }

    /// The open task's commands, as its context menu.
    @ViewBuilder private var taskItems: some View {
        Group {
            Button("Toggle Done") { actions?.task(.done) }
            Button("Due Date…") { actions?.task(.due) }
            Button("Priority…") { actions?.task(.priority) }
            Button("Labels…") { actions?.task(.labels) }
            Button("Move to Project…") { actions?.task(.move) }
            Button("Assign…") { actions?.task(TaskShortcut.assign) }
            Button("Colour…") { actions?.task(TaskShortcut.colour) }
            Button("Favourite") { actions?.task(.favourite) }
            Divider()
            Button("Copy Identifier") { actions?.task(TaskShortcut.copyIdentifier) }
            Button("Copy Link") { actions?.task(.copyLink) }.keyboardShortcut(".")
            // No key equivalent: ⌘⌫ there fired while editing the title or description. Plain ⌫ outside a text field
            // still deletes (`KeySequencer`).
            Button("Delete") { actions?.task(.delete) }
        }
    }
}
