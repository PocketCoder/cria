import CriaKit
import Foundation
import UserNotifications

/// Hands upcoming reminders to the OS so they fire with the app closed. Reconciles against the pending list on every
/// task change, so edits, completions and server pulls are all picked up. Authorisation is requested on first run.
enum ReminderScheduler {
    static func run(store: CriaStore) async {
        let center = UNUserNotificationCenter.current()
        _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
        for await upcoming in observeStore(store, kinds: [.tasks], read: { reading in
            try reading.upcomingReminders(after: Date(), limit: ReminderSchedule.osLimit)
        }) {
            await sync(upcoming, center: center)
        }
    }

    private static func sync(_ upcoming: [UpcomingReminder], center: UNUserNotificationCenter) async {
        let pending = await center.pendingNotificationRequests().map(\.identifier)
        let change = ReminderSchedule.reconcile(wanted: ReminderSchedule.plan(upcoming), pendingIdentifiers: pending)
        center.removePendingNotificationRequests(withIdentifiers: change.removeIdentifiers)
        for item in change.add {
            let content = UNMutableNotificationContent()
            content.title = item.title
            content.sound = .default
            let parts = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: item.fireDate)
            let trigger = UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)
            try? await center.add(UNNotificationRequest(identifier: item.identifier, content: content, trigger: trigger))
        }
    }
}
