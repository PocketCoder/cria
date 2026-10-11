import CriaKit
import Foundation
import UserNotifications

/// Keeps the morning summary and weekly round-up scheduled with the OS. One request each, at the next fire time, with
/// the content as it will read then; recounted whenever tasks, preferences or the week start change, and on foreground.
enum SummaryScheduler {
    static func run(store: CriaStore) async {
        let (changes, continuation) = AsyncStream<Void>.makeStream()
        let feeders = [
            Task { for await _ in observeStore(store, kinds: [.tasks], read: { _ in () }) { continuation.yield() } },
            Task { for await _ in PreferenceChanges.stream() { continuation.yield() } }
        ]
        defer { feeders.forEach { $0.cancel() } }
        for await _ in changes {
            if Task.isCancelled { break }
            await reconcile(store: store)
        }
    }

    /// The Vikunja week start, as the Settings screen keeps it for the Upcoming strip.
    static var weekStart: Int {
        UserDefaults.standard.object(forKey: GeneralSettings.weekStartDefaultsKey) as? Int ?? GeneralSettings.defaultWeekStart
    }

    private static func reconcile(store: CriaStore) async {
        let center = UNUserNotificationCenter.current()
        let status = await center.notificationSettings().authorizationStatus
        let allowed = [UNAuthorizationStatus.authorized, .provisional, .ephemeral].contains(status)
        let config = SummaryConfig(preferences: PreferencesStore().load(), weekStart: weekStart)
        let tasks = (try? store.tasks(matching: TaskQuery()))?.map {
            SummaryTask(title: $0.title, dueDate: $0.dueDate, done: $0.done, doneAt: $0.doneAt)
        } ?? []
        let planned = allowed ? Summaries.plan(config, tasks: tasks, now: Date()) : []
        center.removePendingNotificationRequests(withIdentifiers: Summaries.identifiers)
        for item in planned {
            let content = UNMutableNotificationContent()
            content.title = item.message.title
            content.body = item.message.body
            content.sound = .default
            let parts = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: item.fireDate)
            let trigger = UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)
            try? await center.add(UNNotificationRequest(identifier: item.identifier, content: content, trigger: trigger))
        }
    }
}
