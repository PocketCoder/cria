import AppIntents
import CriaKit
import WidgetKit

/// The tick button on a widget row. Runs in the widget extension, which cannot drain the outbox: it only writes the
/// dirty row and the outbox op through CriaKit (as the app's own tick does), tells the running app, and refreshes the
/// widget. The app pushes the change the next time it syncs; a repeating task advances on the server when it does.
struct CompleteTaskIntent: AppIntent {
    static let title: LocalizedStringResource = "Complete task"
    static let description = IntentDescription("Marks a task done in Cria.")
    static let isDiscoverable = false

    @Parameter(title: "Task")
    var taskLocalId: String

    init() {}

    init(taskLocalId: String) {
        self.taskLocalId = taskLocalId
    }

    func perform() async throws -> some IntentResult {
        guard SignedInFlag.isSignedIn() else { return .result() }
        let store = CriaStore(database: try CriaPaths.openDatabase())
        if try store.completeTaskFromWidget(localId: taskLocalId) {
            CrossProcessSignal.post()
        }
        WidgetCenter.shared.reloadTimelines(ofKind: TodayWidgetKind.id)
        return .result()
    }
}
