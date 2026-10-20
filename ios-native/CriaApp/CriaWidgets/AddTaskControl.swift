import AppIntents
import CriaKit
import SwiftUI
import WidgetKit

/// Opens the app's quick add (`cria://add`), which reaches `onOpenURL` like a widget link.
@available(iOS 18.0, *)
struct OpenQuickAddIntent: AppIntent {
    static let title: LocalizedStringResource = "Add task"
    static let description = IntentDescription("Opens quick add in Cria.")
    static let isDiscoverable = false

    func perform() async throws -> some IntentResult & OpensIntent {
        guard let url = DeepLink.addURL else { return .result() }
        return .result(opensIntent: OpenURLIntent(url))
    }
}

/// Control Centre and Lock Screen button for quick add (iOS 18 and later; the app's minimum is 17).
@available(iOS 18.0, *)
struct AddTaskControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "io.cria.control.add") {
            ControlWidgetButton(action: OpenQuickAddIntent()) {
                Label("Add task", systemImage: "plus.circle.fill")
            }
        }
        .displayName("Add task")
        .description("Opens quick add in Cria.")
    }
}
