import CriaKit
import Observation
import SwiftUI

/// "Deleted · Undo" after a task delete, as the desktop app does. The delete op waits out `window` in the outbox, so
/// Undo takes it back before it reaches the server. One offer at a time; a newer delete replaces the toast (the
/// older delete still goes ahead).
@MainActor @Observable
final class UndoCenter {
    struct Offer: Identifiable, Equatable {
        let id = UUID()
        let taskLocalId: String
        let title: String
    }

    /// Seconds the toast stays up. The outbox waits a little longer so Undo never races the push.
    static let visible: Double = 5
    static let window: TimeInterval = 7

    private(set) var offer: Offer?
    private(set) var failure: String?
    /// Counts task deletes and successful undos, for the toast's haptics (one change per action, so a bulk delete
    /// that lands in one update plays one).
    private(set) var deletions = 0
    private(set) var restores = 0
    private var services: AppServices?
    private var dismissTask: Task<Void, Never>?

    func attach(_ services: AppServices) {
        self.services = services
    }

    /// Deletes the task with an undo window and shows the toast. Throws when the store write fails.
    func deleteTask(localId: String, title: String) throws {
        guard let services else { return }
        try services.store.deleteTask(localId: localId, undoWindow: Self.window)
        deletions += 1
        let next = Offer(taskLocalId: localId, title: title)
        offer = next
        failure = nil
        dismissTask?.cancel()
        dismissTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(Self.visible))
            guard !Task.isCancelled, self?.offer == next else { return }
            self?.offer = nil
        }
    }

    func undo() {
        guard let offer, let services else { return }
        self.offer = nil
        dismissTask?.cancel()
        do {
            if try services.store.undoDeleteTask(localId: offer.taskLocalId) {
                restores += 1
            } else {
                failure = "Too late to undo: the delete was already sent."
            }
        } catch {
            failure = String(describing: error)
        }
    }

    func dismiss() {
        offer = nil
        failure = nil
        dismissTask?.cancel()
    }
}

/// The toast, shown above the tab bar.
struct UndoToast: View {
    let center: UndoCenter

    var body: some View {
        Group {
            if let offer = center.offer {
                HStack(spacing: 12) {
                    Image(systemName: "trash").foregroundStyle(.secondary)
                    Text("Deleted ‘\(offer.title)’").lineLimit(1).truncationMode(.middle)
                    Spacer(minLength: 8)
                    Button("Undo") { center.undo() }.fontWeight(.semibold)
                }
                .accessibilityElement(children: .combine)
                .accessibilityAction(named: "Undo") { center.undo() }
                .modifier(ToastChrome())
            } else if let failure = center.failure {
                HStack(spacing: 12) {
                    Text(failure).lineLimit(2)
                    Spacer(minLength: 8)
                    Button("OK") { center.dismiss() }
                }
                .modifier(ToastChrome())
            }
        }
        .sensoryFeedback(.warning, trigger: center.deletions)
        .sensoryFeedback(.success, trigger: center.restores)
        .animation(.snappy, value: center.offer)
        .animation(.snappy, value: center.failure)
    }
}

private struct ToastChrome: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(.subheadline)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(.regularMaterial, in: Capsule())
            .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
            .padding(.horizontal, 16)
            .padding(.bottom, 72)
            .transition(.move(edge: .bottom).combined(with: .opacity))
    }
}
