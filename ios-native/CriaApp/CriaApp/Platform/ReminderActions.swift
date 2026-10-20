import CriaKit
import Foundation
import UserNotifications

/// The press-and-hold actions on a reminder notification: Complete and Snooze. Neither opens the app (no
/// `.foreground` option), so the work happens in whatever process the system wakes for the tap. Mirrors
/// `registerReminderActions` and `onNotificationAction` in `src/sync/useReminderScheduler.ts`.
enum ReminderActions {
    static let categoryIdentifier = "cria.reminder"
    static let completeIdentifier = "complete"
    static let snoozeIdentifier = "snooze"
    /// How long Snooze waits before the reminder comes back (10 minutes, as on desktop).
    static let snoozeInterval: TimeInterval = 10 * 60
    /// Snoozed copies have their own prefix, so the reminder reconcile (which owns `cria.reminder.`) leaves them be.
    static let snoozePrefix = "cria.snooze."

    static var category: UNNotificationCategory {
        UNNotificationCategory(
            identifier: categoryIdentifier,
            actions: [
                UNNotificationAction(identifier: completeIdentifier, title: "Complete", options: []),
                UNNotificationAction(identifier: snoozeIdentifier, title: "Snooze 10 minutes", options: [])
            ],
            intentIdentifiers: [],
            options: []
        )
    }

    static func handles(_ actionIdentifier: String) -> Bool {
        actionIdentifier == completeIdentifier || actionIdentifier == snoozeIdentifier
    }

    static func perform(_ actionIdentifier: String, taskLocalId: String, title: String) async {
        switch actionIdentifier {
        case completeIdentifier: await complete(taskLocalId: taskLocalId)
        case snoozeIdentifier: await snooze(taskLocalId: taskLocalId, title: title)
        default: break
        }
    }

    /// Marks the task done through its own short-lived store on the shared database, as the Siri intent does, then
    /// tells the running app (if there is one) to refresh. The outbox row is pushed the next time the app syncs.
    private static func complete(taskLocalId: String) async {
        guard SignedInFlag.isSignedIn(),
              let store = try? CriaStore(database: CriaPaths.openDatabase()) else { return }
        guard let step = try? store.updateTaskUndoable(localId: taskLocalId, patch: TaskPatch(done: true)) else { return }
        // No toast here: the app shows Undo when it next opens or comes forward.
        PendingUndo.save(step)
        NotificationCenter.default.post(name: .criaPendingUndo, object: nil)
        CrossProcessSignal.post()
        // A snoozed copy of this reminder has nothing left to say.
        let center = UNUserNotificationCenter.current()
        let prefix = "\(snoozePrefix)\(taskLocalId)."
        let stale = await center.pendingNotificationRequests().map(\.identifier).filter { $0.hasPrefix(prefix) }
        center.removePendingNotificationRequests(withIdentifiers: stale)
    }

    /// A one-off notification 10 minutes on, carrying the same actions so it can be snoozed again.
    private static func snooze(taskLocalId: String, title: String) async {
        guard PreferencesStore().load().notificationsEnabled, SignedInFlag.isSignedIn() else { return }
        let content = UNMutableNotificationContent()
        content.title = title
        content.sound = .default
        content.categoryIdentifier = categoryIdentifier
        content.userInfo = [NotificationRouter.taskKey: taskLocalId]
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: snoozeInterval, repeats: false)
        let identifier = "\(snoozePrefix)\(taskLocalId).\(Int(Date().timeIntervalSince1970))"
        try? await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: identifier, content: content, trigger: trigger))
    }
}

/// An immediate local notification from the app itself (conflicts, a finished Ramble). Honours the Notifications
/// master switch and never asks for permission: if it has not been given, the notice is dropped.
enum LocalNotice {
    static func post(identifier: String, title: String, body: String, userInfo: [String: String] = [:]) async {
        guard PreferencesStore().load().notificationsEnabled, SignedInFlag.isSignedIn() else { return }
        let center = UNUserNotificationCenter.current()
        let status = await center.notificationSettings().authorizationStatus
        guard status.allowsDelivery else { return }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.userInfo = userInfo
        try? await center.add(UNNotificationRequest(identifier: identifier, content: content, trigger: nil))
    }

    static func clear(identifier: String) {
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [identifier])
    }
}
