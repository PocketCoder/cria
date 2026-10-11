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
        let store = CriaStore(database: try CriaPaths.openDatabase())
        let created = try store.captureTask(title: taskTitle.trimmingCharacters(in: .whitespacesAndNewlines))
        WidgetCenter.shared.reloadAllTimelines()
        if created == nil {
            return .result(dialog: "Open Cria and sign in first.")
        }
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
