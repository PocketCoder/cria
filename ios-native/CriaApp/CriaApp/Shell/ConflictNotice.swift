import Foundation

/// The "Conflicts detected" notification and the hand-off from a tap on it to `ConflictPrompt`. Mirrors
/// `useConflictNotification` in `src/features/shell/useShellEffects.ts`.
enum ConflictNotice {
    private static let identifier = "cria.conflicts"

    static func post(count: Int) async {
        let body = count == 1 ? "1 conflict needs your attention" : "\(count) conflicts need your attention"
        await LocalNotice.post(
            identifier: identifier, title: "Conflicts detected", body: body,
            userInfo: [NotificationRouter.conflictsKey: "1"]
        )
    }

    /// Takes the notification away once the sheet is up.
    static func clear() {
        LocalNotice.clear(identifier: identifier)
    }

    /// Yields when the notification is tapped while the app is running.
    static func openRequests() -> AsyncStream<Void> {
        AsyncStream { continuation in
            nonisolated(unsafe) let token = NotificationCenter.default.addObserver(
                forName: .criaOpenConflicts, object: nil, queue: nil
            ) { _ in continuation.yield() }
            continuation.onTermination = { _ in NotificationCenter.default.removeObserver(token) }
        }
    }
}
