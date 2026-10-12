import CriaKit
import Foundation
import UserNotifications

/// Hands upcoming reminders to the OS so they fire with the app closed. Reconciles against the pending list on every
/// task change, so edits, completions and server pulls are all picked up. Triggers run one pass at a time, each
/// reading the reminders afresh, so two passes cannot interleave and re-add a reminder another pass removed.
/// Permission is asked for only when there is a reminder to schedule (and the Notifications master switch in
/// Settings is on; turning it off clears every pending reminder).
enum ReminderScheduler {
    static func run(store: CriaStore) async {
        // Newest-one buffering: a burst of triggers during a pass collapses into one more pass.
        let (triggers, continuation) = AsyncStream<Void>.makeStream(bufferingPolicy: .bufferingNewest(1))
        let feeders = [
            Task { for await _ in observeStore(store, kinds: [.tasks], read: { _ in () }) { continuation.yield() } },
            Task { for await _ in PreferenceChanges.stream() { continuation.yield() } }
        ]
        defer {
            feeders.forEach { $0.cancel() }
            continuation.finish()
        }
        for await _ in triggers {
            if Task.isCancelled { break }
            let upcoming = (try? store.upcomingReminders(after: Date(), limit: ReminderSchedule.osLimit)) ?? []
            await sync(upcoming)
        }
    }

    private static func sync(_ upcoming: [UpcomingReminder]) async {
        let center = UNUserNotificationCenter.current()
        // Signed out (or signing out): schedule nothing for an account that has gone.
        let enabled = PreferencesStore().load().notificationsEnabled && SignedInFlag.isSignedIn()
        let pending = await center.pendingNotificationRequests().map(\.identifier)
        let wanted = enabled ? ReminderSchedule.plan(upcoming) : []
        let change = ReminderSchedule.reconcile(wanted: wanted, pendingIdentifiers: pending)
        center.removePendingNotificationRequests(withIdentifiers: change.removeIdentifiers)
        guard !change.add.isEmpty, await isAuthorised(center) else { return }
        let owners = taskOwners(upcoming)
        for item in change.add {
            if Task.isCancelled { return }
            let content = UNMutableNotificationContent()
            content.title = item.title
            content.sound = .default
            if let localId = owners[item.identifier] { content.userInfo = [NotificationRouter.taskKey: localId] }
            let parts = Calendar.cria.dateComponents([.year, .month, .day, .hour, .minute, .second], from: item.fireDate)
            let trigger = UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)
            try? await center.add(UNNotificationRequest(identifier: item.identifier, content: content, trigger: trigger))
        }
    }

    /// Asks the first time there is something to schedule; afterwards the answer stands.
    private static func isAuthorised(_ center: UNUserNotificationCenter) async -> Bool {
        switch await center.notificationSettings().authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            return true
        case .notDetermined:
            let granted = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
            // The summary notifications wait for permission too; let them recount now it is known.
            if granted { NotificationCenter.default.post(name: .criaRefreshSchedules, object: nil) }
            return granted
        default:
            return false
        }
    }

    /// The task behind each planned identifier, so a tapped reminder can open it.
    private static func taskOwners(_ upcoming: [UpcomingReminder]) -> [String: String] {
        var owners: [String: String] = [:]
        for reminder in upcoming {
            if let identifier = ReminderSchedule.plan([reminder]).first?.identifier { owners[identifier] = reminder.taskLocalId }
        }
        return owners
    }
}
