import CriaKit
import Foundation
import UserNotifications

/// Hands upcoming reminders to the OS so they fire with the app closed. Reconciles against the pending list on every
/// task change, so edits, completions and server pulls are all picked up. Authorisation is requested on first run
/// (unless the Notifications master switch in Settings is off, which also clears every pending reminder).
enum ReminderScheduler {
    static func run(store: CriaStore) async {
        if PreferencesStore().load().notificationsEnabled {
            _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
        }
        let preferenceTask = Task {
            for await _ in PreferenceChanges.stream() {
                if let upcoming = try? store.upcomingReminders(after: Date(), limit: ReminderSchedule.osLimit) {
                    await sync(upcoming)
                }
            }
        }
        defer { preferenceTask.cancel() }
        for await upcoming in observeStore(store, kinds: [.tasks], read: { reading in
            try reading.upcomingReminders(after: Date(), limit: ReminderSchedule.osLimit)
        }) {
            await sync(upcoming)
        }
    }

    private static func sync(_ upcoming: [UpcomingReminder]) async {
        let center = UNUserNotificationCenter.current()
        let enabled = PreferencesStore().load().notificationsEnabled
        let pending = await center.pendingNotificationRequests().map(\.identifier)
        let wanted = enabled ? ReminderSchedule.plan(upcoming) : []
        let change = ReminderSchedule.reconcile(wanted: wanted, pendingIdentifiers: pending)
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
