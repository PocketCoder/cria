import Foundation

/// A tell-tale between processes that share the database. The share extension and App Intents write a task and post
/// this; the running app hears it and refreshes its screens and drains the outbox. (`ChangeBus` only works inside one
/// process, so without this the app would not notice the new row until the next sync.)
public final class CrossProcessSignal: @unchecked Sendable {
    public static let name = "io.cria.app.database-changed"

    private let handler: @Sendable () -> Void

    /// Starts listening. Keep the returned object alive for as long as the signal should be heard.
    public init(handler: @escaping @Sendable () -> Void) {
        self.handler = handler
        CFNotificationCenterAddObserver(
            CFNotificationCenterGetDarwinNotifyCenter(),
            Unmanaged.passUnretained(self).toOpaque(),
            { _, observer, _, _, _ in
                guard let observer else { return }
                Unmanaged<CrossProcessSignal>.fromOpaque(observer).takeUnretainedValue().handler()
            },
            Self.name as CFString,
            nil,
            .deliverImmediately
        )
    }

    deinit {
        CFNotificationCenterRemoveObserver(
            CFNotificationCenterGetDarwinNotifyCenter(),
            Unmanaged.passUnretained(self).toOpaque(),
            CFNotificationName(Self.name as CFString),
            nil
        )
    }

    /// Tells every other process (and this one) that the database changed.
    public static func post() {
        CFNotificationCenterPostNotification(
            CFNotificationCenterGetDarwinNotifyCenter(), CFNotificationName(name as CFString), nil, nil, true
        )
    }
}
