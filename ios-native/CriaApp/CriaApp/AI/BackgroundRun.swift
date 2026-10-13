import CriaKit
import Foundation
import UIKit
#if canImport(FoundationModels) // The iOS 26 SDK, which also brings continued processing tasks.
import BackgroundTasks
#endif

/// Runs `work` so it survives the user switching to another app. Used for the on-device model, which can take a
/// while on a long ramble.
///
/// iOS 26 and later: a `BGContinuedProcessingTask` keeps the app running and shows a system Live Activity with
/// progress and a cancel button (the same approach as the Tauri build, `src-tauri/swift/CriaAI/.../Background.swift`).
/// Earlier systems get the usual grace period from `beginBackgroundTask`, about thirty seconds.
/// Cancelling the calling task cancels `work`.
enum BackgroundRun {
    static func run<T: Sendable>(title: String, work: @escaping @Sendable () async throws -> T) async throws -> T {
        #if canImport(FoundationModels)
        if #available(iOS 26, *) {
            return try await ContinuedTask.run(title: title, work: work)
        }
        #endif
        return try await GraceTask.run(work: work)
    }
}

/// Pre-iOS 26: ask for extra time while the app is in the background.
@MainActor
private final class GraceTask {
    private var identifier = UIBackgroundTaskIdentifier.invalid

    static func run<T: Sendable>(work: @escaping @Sendable () async throws -> T) async throws -> T {
        let grace = GraceTask()
        let task = Task { try await work() }
        grace.identifier = UIApplication.shared.beginBackgroundTask(withName: "Cria Ramble") {
            // Out of time: stop the work and hand the time back before the system ends the app.
            task.cancel()
            Task { @MainActor in grace.end() }
        }
        defer { grace.end() }
        return try await withTaskCancellationHandler { try await task.value } onCancel: { task.cancel() }
    }

    private func end() {
        guard identifier != .invalid else { return }
        UIApplication.shared.endBackgroundTask(identifier)
        identifier = .invalid
    }
}

#if canImport(FoundationModels)
/// iOS 26+: the work runs inside a continued processing task. Its identifier must match
/// `BGTaskSchedulerPermittedIdentifiers` in project.yml (`$(PRODUCT_BUNDLE_IDENTIFIER).ai.*`).
@available(iOS 26, *)
private final class ContinuedTask: @unchecked Sendable {
    private let lock = NSLock()
    private var bgTask: BGContinuedProcessingTask?
    /// Set when the work ended before the system's launch handler ran, so the handler can close the task at once.
    private var finished: Bool?
    private var expired = false
    private var cancelWork: (@Sendable () -> Void)?

    static func run<T: Sendable>(title: String, work: @escaping @Sendable () async throws -> T) async throws -> T {
        let state = ContinuedTask()
        let identifier = "\(Bundle.main.bundleIdentifier ?? "io.cria.app.swift").ai.\(UUID().uuidString)"
        let registered = BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: nil) { task in
            if let task = task as? BGContinuedProcessingTask { state.attach(task) }
        }
        if registered {
            let request = BGContinuedProcessingTaskRequest(identifier: identifier, title: title, subtitle: "Working on it…")
            // Cannot start right now: just run in the foreground, with no Live Activity.
            request.strategy = .fail
            try? BGTaskScheduler.shared.submit(request)
        }
        let task = Task { try await work() }
        state.setCancel { task.cancel() }
        // The model reports no progress, so creep towards 95% to show the system it is alive.
        let ticker = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(2))
                state.tick()
            }
        }
        defer { ticker.cancel() }
        do {
            let value = try await withTaskCancellationHandler { try await task.value } onCancel: { task.cancel() }
            state.finish(success: true)
            return value
        } catch {
            state.finish(success: false)
            // The Live Activity's cancel button, or the system running out of patience.
            if state.isExpired { throw AIModelError(message: "cancelled") }
            throw error
        }
    }

    private var isExpired: Bool { lock.withLock { expired } }

    private func setCancel(_ cancel: @escaping @Sendable () -> Void) {
        // The system can expire us before the work exists; cancel straight away then.
        let alreadyExpired = lock.withLock { () -> Bool in
            cancelWork = cancel
            return expired
        }
        if alreadyExpired { cancel() }
    }

    /// Cancels the work and closes the Live Activity now, so the system does not kill the app for overrunning.
    private func expire() {
        let cancel = lock.withLock { () -> (@Sendable () -> Void)? in
            expired = true
            bgTask?.setTaskCompleted(success: false)
            bgTask = nil
            return cancelWork
        }
        cancel?()
    }

    private func attach(_ task: BGContinuedProcessingTask) {
        lock.lock()
        defer { lock.unlock() }
        task.progress.totalUnitCount = 100
        task.expirationHandler = { [weak self] in self?.expire() }
        if let finished {
            task.progress.completedUnitCount = 100
            task.setTaskCompleted(success: finished)
        } else {
            bgTask = task
        }
    }

    private func tick() {
        lock.withLock {
            guard let progress = bgTask?.progress else { return }
            progress.completedUnitCount = min(95, progress.completedUnitCount + 5)
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
#endif

/// "Ready to review" when a ramble finishes while the app is not on screen. Tapping it just brings the app back:
/// the Ramble sheet is still up with its rows, because switching apps never closes a sheet.
enum RambleNotice {
    static let identifier = "cria.ramble.ready"

    @MainActor
    static func postIfBackgrounded(count: Int) async {
        guard UIApplication.shared.applicationState != .active else { return }
        await LocalNotice.post(
            identifier: identifier, title: "Ready to review",
            body: "\(Ramble.taskCount(count)) from your ramble, waiting for your review."
        )
    }

    static func clear() {
        LocalNotice.clear(identifier: identifier)
    }
}
