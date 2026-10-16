import CriaKit
import SwiftUI

/// The menu bar extra: today's open tasks with checkboxes, New Task, Open Cria and Quit.
struct MacMenuBarContent: View {
    let model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let services = model.services {
                MacTodayList(services: services)
            } else {
                Text("Sign in to see today's tasks.").foregroundStyle(Color(.mutedForeground))
            }
            Divider()
            Button("New Task…") { MacWindows.requestQuickAdd() }
                .disabled(model.services == nil)
            Button("Open Cria") { MacWindows.showMain() }
            Button("Quit Cria") { NSApplication.shared.terminate(nil) }
        }
        .padding(12)
        .frame(width: 300)
    }
}

private struct MacTodayList: View {
    let services: AppServices
    @State private var live: LiveValue<[TaskListItem]>
    @State private var failure: String?
    @Environment(\.playsCompletionSound) private var playsSound
    @Environment(\.preferences) private var preferences

    init(services: AppServices) {
        self.services = services
        let store = services.store
        _live = State(initialValue: LiveValue(initial: []) {
            observeStore(store, kinds: [.tasks]) { (reading: CriaStore) throws -> [TaskListItem] in
                Array(try reading.smartGroups(.today).flatMap(\.items).filter { !$0.task.done }.prefix(12))
            }
        })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Today").font(Theme.headline)
            if live.value.isEmpty {
                Text("Nothing due.").foregroundStyle(Color(.mutedForeground))
            }
            ForEach(live.value, id: \.task.localId) { item in
                Button {
                    complete(item.task)
                } label: {
                    Label(item.task.title, systemImage: "circle").lineLimit(1)
                }
                .buttonStyle(.plain)
            }
            if let failure {
                Text(failure).font(Theme.caption).foregroundStyle(Color(.destructive))
            }
        }
        .task { await live.run() }
    }

    private func complete(_ task: TaskRecord) {
        do {
            _ = try services.store.updateTask(localId: task.localId, patch: TaskPatch(done: true))
            failure = nil
            if playsSound { CompletionSound.play(preferences.custom.completionTone) }
        } catch {
            failure = "Could not complete \u{201C}\(task.title)\u{201D}: \(error)"
        }
    }
}
