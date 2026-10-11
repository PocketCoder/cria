import AppIntents
import CriaKit
import WidgetKit

/// "Add task" for Siri, Shortcuts and the Action button. Files the task in the capture project of the shared
/// database; the outbox pushes it the next time the app syncs.
struct AddTaskIntent: AppIntent {
    static let title: LocalizedStringResource = "Add task"
    static let description = IntentDescription("Adds a task to Cria.")

    @Parameter(title: "Title", requestValueDialog: "What is the task?")
    var taskTitle: String

    static var parameterSummary: some ParameterSummary {
        Summary("Add \(\.$taskTitle) to Cria")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let title = String(taskTitle.trimmingCharacters(in: .whitespacesAndNewlines).prefix(250))
        if title.isEmpty { return .result(dialog: "A task needs a title.") }
        let store = CriaStore(database: try CriaPaths.openDatabase())
        guard try store.captureTask(title: title) != nil else {
            return .result(dialog: "Open Cria and sign in first.")
        }
        // The running app hears this and pushes the task; the widget shows it at once.
        CrossProcessSignal.post()
        WidgetCenter.shared.reloadAllTimelines()
        return .result(dialog: "Added.")
    }
}

struct CriaShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AddTaskIntent(),
            phrases: ["Add a task in \(.applicationName)", "New \(.applicationName) task"],
            shortTitle: "Add task",
            systemImageName: "plus.circle"
        )
    }
}
