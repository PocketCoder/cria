import Foundation
#if os(iOS)
import BackgroundTasks
import UIKit
import UserNotifications
#endif

/// Runs `work` so it survives the user leaving the app.
///
/// iOS 26+: wraps it in a `BGContinuedProcessingTask`, which keeps the app
/// alive in the background and shows a system Live Activity with progress
/// and a cancel button (no widget extension needed). Finishing while not in
/// the foreground posts a local notification, because the webview's JS is
/// suspended then and can't do it itself.
///
/// macOS: apps aren't suspended, so this just runs `work`; the TS wrapper
/// (src/tauri/ai.ts) notifies when the window isn't focused.
func withBackgroundProgress(
    title: String,
    work: @escaping @Sendable (@escaping @Sendable () -> Void) async -> [String: String]
) async -> [String: String] {
    #if os(iOS) && canImport(FoundationModels) // canImport = built with the iOS 26 SDK
    if #available(iOS 26, *) {
        return await ContinuedTask.run(title: title, work: work)
    }
    #endif
    return await work {}
}

#if os(iOS) && canImport(FoundationModels)
@available(iOS 26, *)
private final class ContinuedTask: @unchecked Sendable {
    private let lock = NSLock()
    private var bgTask: BGContinuedProcessingTask?
    private var finished: Bool?
    private var expired = false
    private var workTask: Task<[String: String], Never>?

    static func run(
        title: String,
        work: @escaping @Sendable (@escaping @Sendable () -> Void) async -> [String: String]
    ) async -> [String: String] {
        let state = ContinuedTask()
        // Info.plist permits "$(PRODUCT_BUNDLE_IDENTIFIER).ai.*" (src-tauri/Info.ios.plist).
        let id = "\(Bundle.main.bundleIdentifier ?? "io.cria.app").ai.\(UUID().uuidString)"
        let registered = BGTaskScheduler.shared.register(forTaskWithIdentifier: id, using: nil) { task in
            state.attach(task as! BGContinuedProcessingTask)
        }
        if registered {
            let request = BGContinuedProcessingTaskRequest(identifier: id, title: title, subtitle: "Working on it…")
            // Can't start right now → just run in the foreground, no Live Activity.
            request.strategy = .fail
            try? BGTaskScheduler.shared.submit(request)
        }

        // `work` runs in its own Task so the expiration handler has a handle to cancel.
        let task = Task { await work { state.tick() } }
        state.setWork(task)
        var result = await task.value
        // Cancelled streams can end quietly with partial text; never report that as success.
        if state.isExpired { result = ["error": "cancelled"] }
        state.finish(success: result["error"] == nil)
        // The user asked to stop (Live Activity cancel) or the system did; no "Failed" banner.
        if result["error"] != "cancelled" { await notifyIfBackgrounded(title: title, result: result) }
        return result
    }

    private func setWork(_ task: Task<[String: String], Never>) {
        // The system can expire us before the task exists; cancel straight away then.
        if lock.withLock({ () -> Bool in workTask = task; return expired }) { task.cancel() }
    }

    private var isExpired: Bool { lock.withLock { expired } }

    /// Cancel the work and close the Live Activity now, so the system doesn't
    /// kill the app for overrunning an expired task.
    private func expire() {
        let task = lock.withLock { () -> Task<[String: String], Never>? in
            expired = true
            bgTask?.setTaskCompleted(success: false)
            bgTask = nil
            return workTask
        }
        task?.cancel()
    }

    private func attach(_ task: BGContinuedProcessingTask) {
        lock.lock(); defer { lock.unlock() }
        task.progress.totalUnitCount = 100
        task.expirationHandler = { [weak self] in self?.expire() }
        if let finished {
            // Work beat the launch handler; close the Live Activity straight away.
            task.progress.completedUnitCount = 100
            task.setTaskCompleted(success: finished)
        } else {
            bgTask = task
        }
    }

    /// Indeterminate work: creep towards 95% so the system sees progress.
    private func tick() {
        lock.withLock {
            guard let p = bgTask?.progress else { return }
            p.completedUnitCount = min(95, p.completedUnitCount + 5)
        }
    }

    private func finish(success: Bool) {
        lock.withLock {
            finished = success
            bgTask?.progress.completedUnitCount = 100
            bgTask?.setTaskCompleted(success: success)
            bgTask = nil
        }
    }
}

@available(iOS 26, *)
private func notifyIfBackgrounded(title: String, result: [String: String]) async {
    let active = await MainActor.run { UIApplication.shared.applicationState == .active }
    guard !active else { return }
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = result["error"].map { "Failed: \($0)" } ?? "Ready to review."
    let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
    try? await UNUserNotificationCenter.current().add(request)
}
#endif
