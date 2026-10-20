#if os(macOS)
import AppKit
import CriaKit
import SwiftUI

extension Notification.Name {
    /// The inspector's breadcrumb was clicked: the Mac shell shows the project whose local id is the object.
    static let criaOpenProject = Notification.Name("io.cria.openProject")
}

/// The Mac task menu from the design handoff (§13): Mark as Done (T), Open (↩), the Due Date, Priority, Labels and
/// Move to submenus, Add to Favourites (S), Copy Link (⌘.), Duplicate and Delete (⌫). The row's context menu and the
/// inspector's ⋯ menu (which leaves Open out) both build it. The submenus read `TaskMenuChoices`, never the database.
struct TaskMacMenuItems: View {
    let services: AppServices
    let task: TaskRecord
    let labels: [LabelRecord]
    /// Nil leaves Open out.
    let onOpen: (@MainActor () -> Void)?
    let onToggleDone: @MainActor () -> Void
    let onPickDate: @MainActor () -> Void
    let onDuplicate: @MainActor () -> Void
    let onCopyLink: @MainActor () -> Void
    let onDelete: @MainActor () -> Void
    let onFailure: (String) -> Void
    /// Nil leaves Subscribe out (the row's context menu has no room for a network call's failure).
    var onToggleSubscription: (@MainActor () -> Void)?
    @Environment(UndoCenter.self) private var undo: UndoCenter?

    var body: some View {
        Button(task.done ? "Mark as Not Done" : "Mark as Done", systemImage: "checkmark.circle", action: onToggleDone)
            .keyboardShortcut("t", modifiers: [])
        if let onOpen {
            Button("Open", systemImage: "arrow.up.forward.square", action: onOpen)
                .keyboardShortcut(.return, modifiers: [])
        }
        Divider()
        Menu("Due Date", systemImage: "calendar") {
            ForEach(QuickAddDatePreset.allCases, id: \.self) { preset in
                Button(preset.title) { write(TaskPatch(dueDate: preset.iso(now: Date()))) }
            }
            Divider()
            Button("Pick a date…", action: onPickDate)
            // An empty value clears the date, as the detail's date rows do.
            Button("No date") { write(TaskPatch(dueDate: "")) }.disabled(task.dueDate == nil)
        }
        Menu("Priority", systemImage: "flag") {
            // Do now first, None last, each with its colour.
            ForEach(TableCells.priorityNames.indices.reversed(), id: \.self) { level in
                Toggle(isOn: Binding(get: { task.priority == level }, set: { if $0 { write(TaskPatch(priority: level)) } })) {
                    Label {
                        Text(TableCells.priorityNames[level])
                    } icon: {
                        Image(nsImage: PriorityDot.image(level))
                    }
                }
            }
        }
        Menu("Labels", systemImage: "tag") {
            TaskRowLabelChoices(services: services, taskLocalId: task.localId, labels: labels, onFailure: onFailure)
        }
        Menu("Move to", systemImage: "folder") {
            TaskRowProjectChoices(services: services, task: task, onFailure: onFailure)
        }
        Divider()
        Button(task.isFavorite ? "Remove from Favourites" : "Add to Favourites", systemImage: "star") {
            write(TaskPatch(isFavorite: !task.isFavorite))
        }
        .keyboardShortcut("s", modifiers: [])
        // A task that has not synced has no web address yet.
        Button("Copy Link", systemImage: "link", action: onCopyLink)
            .keyboardShortcut(".", modifiers: .command)
            .disabled(services.taskWebURL(task) == nil)
        Button("Duplicate", systemImage: "plus.square.on.square", action: onDuplicate)
        if let onToggleSubscription {
            Button(
                task.isSubscribed ? "Unsubscribe" : "Subscribe", systemImage: task.isSubscribed ? "bell.slash" : "bell",
                action: onToggleSubscription
            )
        }
        Divider()
        Button("Delete", systemImage: "trash", role: .destructive, action: onDelete)
            .keyboardShortcut(.delete, modifiers: [])
    }

    private func write(_ patch: TaskPatch) {
        do {
            try undo.updateTask(services, localId: task.localId, patch: patch)
        } catch {
            onFailure(String(describing: error))
        }
    }
}

/// The priority submenu's coloured dots. A menu draws a SwiftUI symbol as a template (tinted like the text), so each
/// dot is a drawn, non-template image.
@MainActor
enum PriorityDot {
    private static var cache: [Int: NSImage] = [:]

    static func image(_ level: Int) -> NSImage {
        if let cached = cache[level] { return cached }
        let color = NSColor(ThemeToken.priority(level).map { Color($0) } ?? Color(.mutedForeground))
        let image = NSImage(size: NSSize(width: 10, height: 10))
        image.lockFocus()
        color.setFill()
        NSBezierPath(ovalIn: NSRect(x: 1, y: 1, width: 8, height: 8)).fill()
        image.unlockFocus()
        image.isTemplate = false
        cache[level] = image
        return image
    }
}

/// The inspector's entrance: it slides in 24pt from the right with a fade, over 220ms.
struct InspectorEntrance: ViewModifier {
    @State private var shown = false

    func body(content: Content) -> some View {
        content
            .offset(x: shown ? 0 : 24)
            .opacity(shown ? 1 : 0)
            .onAppear {
                withAnimation(.smooth(duration: 0.22)) { shown = true }
            }
    }
}
#endif
