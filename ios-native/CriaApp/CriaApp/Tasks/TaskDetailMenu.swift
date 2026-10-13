import CriaKit
import SwiftUI

/// The task screen's ••• menu beside the star: duplicate, and the task's address on Vikunja-web to copy or share.
struct TaskDetailMenu: View {
    let services: AppServices
    let task: TaskRecord
    let state: TaskDetailPresentation
    let onDuplicate: () -> Void

    var body: some View {
        Menu {
            Button("Duplicate", systemImage: "plus.square.on.square", action: onDuplicate)
            if let url = services.taskWebURL(task) {
                Button("Copy link", systemImage: "link") { state.copyLink(url) }
                ShareLink(item: url) { Label("Share link", systemImage: "square.and.arrow.up") }
            } else {
                // A task made on this phone has no address until its create has been pushed.
                Button("Copy link", systemImage: "link") {}
                    .disabled(true)
            }
        } label: {
            Label("More", systemImage: "ellipsis.circle")
        }
    }
}
