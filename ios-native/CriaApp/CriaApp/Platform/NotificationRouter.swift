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

    /// A link from a tapped notification, waiting for `RootView` to pass it on.
    var pendingURL: URL?

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
        let url = Self.link(from: response.notification.request.content.userInfo)
        if let url {
            Task { @MainActor in NotificationRouter.shared.pendingURL = url }
        }
        completionHandler()
    }

    nonisolated static func link(from userInfo: [AnyHashable: Any]) -> URL? {
        if let localId = userInfo[taskKey] as? String { return DeepLink.taskURL(localId: localId) }
        if let text = userInfo[linkKey] as? String { return URL(string: text) }
        return nil
    }
}
