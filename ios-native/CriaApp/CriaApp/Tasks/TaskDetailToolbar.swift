import CriaKit
import SwiftUI

extension TaskDetailView {
    #if os(macOS)
    /// The same three items, with fixed ids, whichever task is open: a new task then updates them in place instead of
    /// the window toolbar rebuilding and re-tiling its items on every click.
    @ToolbarContentBuilder var macToolbar: some CustomizableToolbarContent {
        ToolbarItem(id: "cria.task.close", placement: .primaryAction) {
            Button("Close", systemImage: "xmark") { closeTask?() }.help("Close (Esc)")
        }
        ToolbarItem(id: "cria.task.menu", placement: .primaryAction) {
            if let task = live.value.task {
                TaskDetailMenu(services: services, task: task, state: sheets, onDuplicate: duplicateTask)
            }
        }
        ToolbarItem(id: "cria.task.star", placement: .primaryAction) {
            let starred = live.value.task?.isFavorite == true
            Button(starred ? "Unstar" : "Star", systemImage: starred ? "star.fill" : "star") {
                _ = apply(TaskPatch(isFavorite: !starred))
            }
            .tint(starred ? Color(.warning) : nil)
            .disabled(live.value.task == nil)
        }
    }
    #else
    @ToolbarContentBuilder var phoneToolbar: some ToolbarContent {
        if let task = live.value.task {
            ToolbarItemGroup(placement: .topBarTrailing) {
                TaskDetailMenu(services: services, task: task, state: sheets, onDuplicate: duplicateTask)
                Button(task.isFavorite ? "Unstar" : "Star", systemImage: task.isFavorite ? "star.fill" : "star") {
                    _ = apply(TaskPatch(isFavorite: !task.isFavorite))
                }
                .tint(task.isFavorite ? Color(.warning) : nil)
            }
        }
    }
    #endif
}
