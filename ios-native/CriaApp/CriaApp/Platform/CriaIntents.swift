import AppIntents
import CriaKit
import WidgetKit

// Siri, Shortcuts and Spotlight actions. Shared by iOS and macOS: App Intents run in the app's own process on both.
// The widget extension has its own tick intent (`CriaWidgets/WidgetIntents.swift`), which is not part of this target.

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
        guard SignedInFlag.isSignedIn() else { return .result(dialog: "Sign in to Cria first.") }
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

/// An open task, for pickers in Shortcuts and for "Complete task". Read from the local database, so it works offline.
struct TaskEntity: AppEntity {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Task")
    static let defaultQuery = TaskEntityQuery()

    let id: String
    let title: String

    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(title)") }

    init(_ entry: IntentEntry) {
        id = entry.localId
        title = entry.title
    }
}

struct TaskEntityQuery: EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [TaskEntity] {
        guard SignedInFlag.isSignedIn() else { return [] }
        let store = CriaStore(database: try CriaPaths.openDatabase(readOnly: true))
        return try store.taskEntries(localIds: identifiers).map(TaskEntity.init)
    }

    func entities(matching string: String) async throws -> [TaskEntity] {
        guard SignedInFlag.isSignedIn() else { return [] }
        let store = CriaStore(database: try CriaPaths.openDatabase(readOnly: true))
        return try store.openTaskEntries(matching: string).map(TaskEntity.init)
    }

    func suggestedEntities() async throws -> [TaskEntity] {
        try await entities(matching: "")
    }
}

/// A project, for "Open project".
struct ProjectEntity: AppEntity {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Project")
    static let defaultQuery = ProjectEntityQuery()

    let id: String
    let title: String

    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(title)") }

    init(_ entry: IntentEntry) {
        id = entry.localId
        title = entry.title
    }
}

struct ProjectEntityQuery: EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [ProjectEntity] {
        guard SignedInFlag.isSignedIn() else { return [] }
        let store = CriaStore(database: try CriaPaths.openDatabase(readOnly: true))
        return try store.projectEntries(localIds: identifiers).map(ProjectEntity.init)
    }

    func entities(matching string: String) async throws -> [ProjectEntity] {
        guard SignedInFlag.isSignedIn() else { return [] }
        let store = CriaStore(database: try CriaPaths.openDatabase(readOnly: true))
        return try store.projectEntries(matching: string).map(ProjectEntity.init)
    }

    func suggestedEntities() async throws -> [ProjectEntity] {
        try await entities(matching: "")
    }
}

/// Marks a task done through the same user write as the app's own tick (dirty row plus outbox op), so a repeating
/// task advances on the server when the app next syncs.
struct CompleteTaskByNameIntent: AppIntent {
    static let title: LocalizedStringResource = "Complete task"
    static let description = IntentDescription("Marks a task done in Cria.")

    @Parameter(title: "Task", requestValueDialog: "Which task?")
    var task: TaskEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Complete \(\.$task) in Cria")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard SignedInFlag.isSignedIn() else { return .result(dialog: "Sign in to Cria first.") }
        let store = CriaStore(database: try CriaPaths.openDatabase())
        guard try store.completeTaskFromWidget(localId: task.id) else {
            return .result(dialog: "That task is already done or gone.")
        }
        CrossProcessSignal.post()
        WidgetCenter.shared.reloadAllTimelines()
        return .result(dialog: "Done.")
    }
}

/// The views Siri and Shortcuts can open.
enum CriaViewChoice: String, AppEnum {
    case today
    case upcoming
    case inbox

    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "View")
    static let caseDisplayRepresentations: [CriaViewChoice: DisplayRepresentation] = [
        .today: "Today",
        .upcoming: "Upcoming",
        .inbox: "Inbox"
    ]
}

/// Brings Cria forward on one of its views. The link goes through the same mailbox a tapped notification uses, which
/// the root view hands to the shell.
struct OpenViewIntent: AppIntent {
    static let title: LocalizedStringResource = "Open view"
    static let description = IntentDescription("Opens Today, Upcoming or Inbox in Cria.")
    static let openAppWhenRun = true

    @Parameter(title: "View")
    var view: CriaViewChoice

    static var parameterSummary: some ParameterSummary {
        Summary("Open \(\.$view) in Cria")
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        let name = view.rawValue
        NotificationRouter.shared.pendingURL = URL(string: "\(DeepLink.scheme)://\(name)")
        return .result()
    }
}

struct OpenProjectIntent: AppIntent {
    static let title: LocalizedStringResource = "Open project"
    static let description = IntentDescription("Opens a project in Cria.")
    static let openAppWhenRun = true

    @Parameter(title: "Project")
    var project: ProjectEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Open \(\.$project) in Cria")
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        NotificationRouter.shared.pendingURL = DeepLink.projectURL(localId: project.id)
        return .result()
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
        AppShortcut(
            intent: CompleteTaskByNameIntent(),
            phrases: ["Complete a task in \(.applicationName)", "Finish a task in \(.applicationName)"],
            shortTitle: "Complete task",
            systemImageName: "checkmark.circle"
        )
        AppShortcut(
            intent: OpenViewIntent(),
            phrases: ["Open \(\.$view) in \(.applicationName)", "Show \(\.$view) in \(.applicationName)"],
            shortTitle: "Open view",
            systemImageName: "calendar"
        )
        AppShortcut(
            intent: OpenProjectIntent(),
            phrases: ["Open project \(\.$project) in \(.applicationName)"],
            shortTitle: "Open project",
            systemImageName: "folder"
        )
    }
}
