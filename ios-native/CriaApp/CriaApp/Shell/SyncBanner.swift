import CriaKit
import Network
import SwiftUI

/// Thin status strip: a slow sync step, being offline, the errors from the last finished cycle (tap to retry), and
/// notices for conflicts to resolve and changes that could not sync. Errors stay until the next cycle ends, and a
/// step shows only once it has run for a second, so the strip does not jump on every quick sync.
struct SyncBanner: View {
    let services: AppServices
    let conflicts: ConflictPrompt
    @State private var step: String?
    @State private var showStep = false
    @State private var errors: [SyncStatus.StepError] = []
    @State private var settledAt: Date?
    @State private var isOnline = true
    @State private var failed: LiveValue<Int>
    @State private var showingOutbox = false

    init(services: AppServices, conflicts: ConflictPrompt) {
        self.services = services
        self.conflicts = conflicts
        let store = services.store
        _failed = State(initialValue: LiveValue(initial: 0) {
            observeStore(store, kinds: [.outbox]) { try $0.deadLetters().count }
        })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            statusLine
            if !conflicts.conflicts.isEmpty && !conflicts.isShowing {
                notice(Self.count(conflicts.conflicts.count, "conflict") + " to resolve", systemImage: "arrow.triangle.branch") {
                    conflicts.open()
                }
            }
            if failed.value > 0 {
                notice(Self.count(failed.value, "change") + " could not sync", systemImage: "exclamationmark.icloud") {
                    showingOutbox = true
                }
            }
        }
        .font(Theme.caption)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal)
        .animation(.easeInOut(duration: 0.2), value: layoutKey)
        .task { await followStatus() }
        .task {
            for await online in NetworkPath.updates() { isOnline = online }
        }
        .task { await failed.run() }
        .sheet(isPresented: $showingOutbox) {
            NavigationStack {
                OutboxView(services: services)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { showingOutbox = false }
                        }
                    }
            }
        }
    }

    @ViewBuilder private var statusLine: some View {
        if isOffline {
            Button(action: retry) {
                Label("Offline. Changes will sync when you're back online.", systemImage: "wifi.slash")
                    .foregroundStyle(Color(.mutedForeground))
            }
            .buttonStyle(.plain)
            .accessibilityHint("Tries to sync now")
        } else if showStep, let step {
            Label(step, systemImage: "arrow.triangle.2.circlepath")
                .lineLimit(1)
        } else if let error = errors.first {
            Button(action: retry) {
                Label("\(error.step): \(error.message)", systemImage: "exclamationmark.triangle")
                    .foregroundStyle(Color(.warningText))
                    .lineLimit(2)
            }
            .buttonStyle(.plain)
            .accessibilityHint("Tries to sync again")
        }
    }

    private func notice(_ text: String, systemImage: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(text, systemImage: systemImage)
                .foregroundStyle(Color(.warningText))
                .lineLimit(1)
        }
        .buttonStyle(.plain)
    }

    /// Offline when the device has no network, or every error of the last cycle was a network failure.
    private var isOffline: Bool {
        !isOnline || (!errors.isEmpty && errors.allSatisfy { isOfflineError(StepFailure(message: $0.message)) })
    }

    private var layoutKey: [Bool] {
        [isOffline, showStep && step != nil, !errors.isEmpty, !conflicts.conflicts.isEmpty && !conflicts.isShowing, failed.value > 0]
    }

    private func retry() {
        Task { await services.refresh() }
    }

    private func followStatus() async {
        var reveal: Task<Void, Never>?
        for await next in services.coordinator.status.subscribe() {
            step = next.step
            // A finished cycle stamps `lastSyncAt`; only then are its errors complete.
            if next.lastSyncAt != settledAt {
                settledAt = next.lastSyncAt
                errors = next.errors
            }
            if next.step == nil {
                reveal?.cancel()
                reveal = nil
                showStep = false
            } else if reveal == nil {
                reveal = Task {
                    try? await Task.sleep(for: .seconds(1))
                    if !Task.isCancelled { showStep = true }
                }
            }
        }
        reveal?.cancel()
    }

    private static func count(_ value: Int, _ noun: String) -> String {
        "\(value) \(noun)\(value == 1 ? "" : "s")"
    }
}

/// A sync step's error text, so `isOfflineError` can check it.
private struct StepFailure: Error, CustomStringConvertible {
    let message: String
    var description: String { message }
}

/// Whether the device has a usable network path.
private enum NetworkPath {
    static func updates() -> AsyncStream<Bool> {
        AsyncStream { continuation in
            let monitor = NWPathMonitor()
            monitor.pathUpdateHandler = { path in continuation.yield(path.status == .satisfied) }
            continuation.onTermination = { _ in monitor.cancel() }
            monitor.start(queue: DispatchQueue(label: "io.cria.network-path"))
        }
    }
}
