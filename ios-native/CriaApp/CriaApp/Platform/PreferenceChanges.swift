import Foundation

extension Notification.Name {
    /// Posted when the app comes to the foreground so schedulers recount (sync pulls do not notify the store bus).
    static let criaRefreshSchedules = Notification.Name("cria.refreshSchedules")
}

/// A stream that yields whenever the local preferences change or the schedulers should recount.
enum PreferenceChanges {
    static func stream() -> AsyncStream<Void> {
        AsyncStream { continuation in
            let names: [Notification.Name] = [.criaPreferencesChanged, .criaRefreshSchedules]
            nonisolated(unsafe) let tokens = names.map { name in
                NotificationCenter.default.addObserver(forName: name, object: nil, queue: nil) { _ in continuation.yield() }
            }
            continuation.onTermination = { _ in
                for token in tokens { NotificationCenter.default.removeObserver(token) }
            }
        }
    }
}
