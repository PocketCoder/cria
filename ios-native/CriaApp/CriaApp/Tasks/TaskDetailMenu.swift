import CriaKit
import SwiftUI

/// The task screen's ••• menu beside the star: duplicate, and the task's address on Vikunja-web to copy or share.
/// On the Mac it is the full task menu (`TaskMacMenuItems`) without Open.
struct TaskDetailMenu: View {
    let services: AppServices
    let task: TaskRecord
    let state: TaskDetailPresentation
    let onDuplicate: () -> Void
    #if os(macOS)
    var macMenu: TaskDetailMacMenuActions?
    #endif

    var body: some View {
        Menu {
            items
        } label: {
            #if os(macOS)
            Label("More", systemImage: "ellipsis")
            #else
            Label("More", systemImage: "ellipsis.circle")
            #endif
        }
    }

    @ViewBuilder private var items: some View {
        #if os(macOS)
        if let macMenu {
            TaskMacMenuItems(
                services: services, task: task, labels: macMenu.labels, onOpen: nil,
                onToggleDone: macMenu.onToggleDone, onPickDate: macMenu.onPickDate, onDuplicate: { onDuplicate() },
                onCopyLink: { if let url = services.taskWebURL(task) { state.copyLink(url) } },
                onDelete: macMenu.onDelete, onFailure: { state.failure = $0 }
            )
        } else {
            commonItems
        }
        #else
        commonItems
        #endif
    }

    @ViewBuilder private var commonItems: some View {
        Button("Duplicate", systemImage: "plus.square.on.square", action: onDuplicate)
        if let url = services.taskWebURL(task) {
            Button("Copy link", systemImage: "link") { state.copyLink(url) }
            ShareLink(item: url) { Label("Share link", systemImage: "square.and.arrow.up") }
        } else {
            // A task made on this phone has no address until its create has been pushed.
            Button("Copy link", systemImage: "link") {}
                .disabled(true)
        }
    }
}

#if os(macOS)
/// What the inspector's ⋯ menu needs beyond the iOS menu: the task's labels, and done, date and delete as the
/// detail runs them (Delete goes through its Undo).
struct TaskDetailMacMenuActions {
    let labels: [LabelRecord]
    let onToggleDone: @MainActor () -> Void
    let onPickDate: @MainActor () -> Void
    let onDelete: @MainActor () -> Void
}
#endif
