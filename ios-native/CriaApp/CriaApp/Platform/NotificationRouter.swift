import CriaKit
import Foundation
import Observation
import UserNotifications

/// The notification centre's delegate: shows reminders while the app is open, and turns a tap into a `cria://` link
/// that `RootView` hands to the shell. Set in `CriaApp.init` so a tap that launches the app is not missed.
@MainActor @Observable
final class NotificationRouter: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationRouter()
    /// `userInfo` key on a reminder: the task to open.
    nonisolated static let taskKey = "taskLocalId"
    /// `userInfo` key on any other Cria notification: a `cria://` link to open.
    nonisolated static let linkKey = "link"
    /// `userInfo` key on the conflict notification: a tap opens the conflict sheet.
    nonisolated static let conflictsKey = "openConflicts"

    /// A link from a tapped notification, waiting for `RootView` to pass it on.
    var pendingURL: URL?
    /// Set by a tap on the conflict notification and cleared by whoever opens the sheet, so a tap that launched the
    /// app is not lost before the shell exists.
    private(set) var conflictSheetRequested = false

    /// True once per request.
    func takeConflictSheetRequest() -> Bool {
        defer { conflictSheetRequested = false }
        return conflictSheetRequested
    }

    /// Registers the actions on reminder notifications. Call once at launch.
    nonisolated static func registerCategories() {
        UNUserNotificationCenter.current().setNotificationCategories([ReminderActions.category])
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound, .list])
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let content = response.notification.request.content
        let action = response.actionIdentifier
        let title = content.title
        let taskId = content.userInfo[Self.taskKey] as? String
        // Complete and Snooze run without opening the app, so the handler stays until they have finished.
        if let taskId, ReminderActions.handles(action) {
            nonisolated(unsafe) let finish = completionHandler
            Task {
                await ReminderActions.perform(action, taskLocalId: taskId, title: title)
                finish()
            }
            return
        }
        let userInfo = content.userInfo
        let url = Self.link(from: userInfo)
        let opensConflicts = userInfo[Self.conflictsKey] != nil
        Task { @MainActor in
            if let url { NotificationRouter.shared.pendingURL = url }
            if opensConflicts { NotificationRouter.shared.requestConflictSheet() }
        }
        completionHandler()
    }

    private func requestConflictSheet() {
        conflictSheetRequested = true
        NotificationCenter.default.post(name: .criaOpenConflicts, object: nil)
    }

    nonisolated static func link(from userInfo: [AnyHashable: Any]) -> URL? {
        if let localId = userInfo[taskKey] as? String { return DeepLink.taskURL(localId: localId) }
        if let text = userInfo[linkKey] as? String { return URL(string: text) }
        return nil
    }
}

extension Notification.Name {
    /// Posted when the conflict notification is tapped; `ConflictPrompt` opens the sheet.
    static let criaOpenConflicts = Notification.Name("cria.openConflicts")
}
