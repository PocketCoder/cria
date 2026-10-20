import CriaKit
import Observation
import SwiftUI

/// "Task completed · Undo" after a task action, as the desktop app does for deletes. Every undoable action (delete,
/// complete, reschedule, move, priority, and the same from the multi-select bar) hands the centre a `TaskUndoStep`.
/// Undo writes the step's inverse through `updateTask`, so it syncs like any edit; a delete additionally waits out
/// `window` in the outbox, so Undo takes it back before it reaches the server. The toast shows the newest action;
/// the last few steps stay on a short stack, so Undo (and ⌘Z on the Mac) walks back through them after it fades.
@MainActor @Observable
final class UndoCenter {
    struct Offer: Identifiable, Equatable {
        let id = UUID()
        let step: TaskUndoStep
        /// Toast text, and the VoiceOver label.
        var message: String { step.message }
        var isDelete: Bool { !step.deletedLocalIds.isEmpty }
    }

    /// Seconds the toast stays up (3.2 on the Mac, from its design). The outbox waits longer so Undo never races
    /// the push.
    #if os(macOS)
    static let visible: Double = 3.2
    #else
    static let visible: Double = 5
    #endif
    static let window: TimeInterval = 7

    /// Steps kept for Undo and ⌘Z, newest last.
    static let depth = 10

    /// The step the toast is offering; nil once it fades.
    private(set) var offer: Offer?
    private(set) var failure: String?
    /// Counts task deletes and successful undos, for the toast's haptics (one change per action, so a bulk delete
    /// that lands in one update plays one).
    private(set) var deletions = 0
    private(set) var restores = 0
    private var services: AppServices?
    private var dismissTask: Task<Void, Never>?
    private var history: [Offer] = []

    /// Whether there is anything for ⌘Z to take back.
    var canUndo: Bool { !history.isEmpty }

    func attach(_ services: AppServices) {
        self.services = services
    }

    /// Deletes the task with an undo window and shows the toast. Throws when the store write fails.
    func deleteTask(localId: String, title: String) throws {
        guard let services else { return }
        try services.store.deleteTask(localId: localId, undoWindow: Self.window)
        deletions += 1
        #if os(macOS)
        let message = "Task deleted"
        #else
        let message = "Deleted ‘\(title)’"
        #endif
        record(TaskUndoStep(message: message, deletedLocalIds: [localId]))
    }

    /// `updateTask` with an undo step recorded. Throws when the store write fails, like `updateTask`.
    func update(_ store: CriaStore, localId: String, patch: TaskPatch, message: String? = nil) throws {
        record(try store.updateTaskUndoable(localId: localId, patch: patch, message: message))
    }

    /// Offers a step that has already been applied (a bulk action, a card move). Nil and empty steps are ignored.
    func record(_ step: TaskUndoStep?) {
        guard let step, !step.isEmpty else { return }
        if !step.deletedLocalIds.isEmpty { deletions += 1 }
        let next = Offer(step: step)
        offer = next
        failure = nil
        history.append(next)
        if history.count > Self.depth { history.removeFirst(history.count - Self.depth) }
        dismissTask?.cancel()
        dismissTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(Self.visible))
            guard !Task.isCancelled, self?.offer == next else { return }
            self?.offer = nil
        }
    }

    /// Takes back the newest step (the toast's, or the one before when it has already faded).
    func undo() {
        guard let services, let last = history.popLast() else { return }
        offer = nil
        dismissTask?.cancel()
        do {
            if try services.store.undo(last.step) {
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

extension Optional where Wrapped == UndoCenter {
    /// Updates a task with an undo toast when the shell provides one (a row in a sheet may have none).
    @MainActor
    func updateTask(_ services: AppServices, localId: String, patch: TaskPatch, message: String? = nil) throws {
        if let center = self {
            try center.update(services.store, localId: localId, patch: patch, message: message)
        } else {
            _ = try services.store.updateTask(localId: localId, patch: patch)
        }
    }

    /// Sets a Gantt bar's dates with an undo toast when there is a centre.
    @MainActor
    func setGanttDates(_ services: AppServices, taskLocalId: String, start: Int, end: Int) throws {
        if let center = self {
            center.record(try services.store.setGanttDatesUndoable(taskLocalId: taskLocalId, start: start, end: end))
        } else {
            try services.store.setGanttDates(taskLocalId: taskLocalId, start: start, end: end)
        }
    }

    /// Adds or removes a label from the quick menu, with an undo toast when there is a centre.
    @MainActor
    func toggleLabel(_ services: AppServices, taskLocalId: String, labelLocalId: String) throws {
        if let center = self {
            center.record(try services.store.toggleTaskLabelUndoable(taskLocalId: taskLocalId, labelLocalId: labelLocalId))
        } else {
            try services.store.toggleTaskLabel(taskLocalId: taskLocalId, labelLocalId: labelLocalId)
        }
    }

    /// Updates several tasks as one undo step (a reschedule of the overdue group, say). A task that fails is reported
    /// as "title: error" and the rest still go ahead.
    @MainActor
    func updateTasks(
        _ services: AppServices, _ changes: [(localId: String, title: String, patch: TaskPatch)], message: String? = nil
    ) -> [String] {
        var steps: [TaskUndoStep] = []
        var failures: [String] = []
        for change in changes {
            do {
                steps.append(try services.store.updateTaskUndoable(localId: change.localId, patch: change.patch))
            } catch {
                failures.append("\(change.title): \(error)")
            }
        }
        let sample = changes.first?.patch ?? TaskPatch()
        let text = message ?? TaskUndoStep.message(for: sample, count: steps.count)
        self?.record(TaskUndoStep.combined(steps, message: text))
        return failures
    }

    /// Offers undo for a bulk or other step already applied; nothing when there is no centre.
    @MainActor
    func record(_ step: TaskUndoStep?) {
        self?.record(step)
    }
}

/// The toast, shown above the tab bar.
struct UndoToast: View {
    let center: UndoCenter

    var body: some View {
        Group {
            if let offer = center.offer {
                HStack(spacing: 12) {
                    #if os(macOS)
                    // The Mac pill: the message alone, then Undo.
                    Text(offer.message).lineLimit(1)
                    Button("Undo") { center.undo() }.buttonStyle(MacUndoButtonStyle())
                    #else
                    Image(systemName: offer.isDelete ? "trash" : "arrow.uturn.backward").foregroundStyle(.secondary)
                    Text(offer.message).lineLimit(1).truncationMode(.middle)
                    Spacer(minLength: 8)
                    Button("Undo") { center.undo() }.fontWeight(.semibold)
                    #endif
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
        #if os(macOS)
        // The Mac pill: 36pt of glass, 20pt above the bottom of the content column.
        content
            .font(.system(size: 13, weight: .medium))
            .padding(.leading, 16)
            .padding(.trailing, 5)
            .frame(height: 36)
            .fixedSize()
            .modifier(MacGlassPill())
            .padding(.bottom, 20)
            .transition(.move(edge: .bottom).combined(with: .opacity))
        #else
        content
            .font(.subheadline)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(.regularMaterial, in: Capsule())
            .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
            .padding(.horizontal, 16)
            .padding(.bottom, 72)
            .transition(.move(edge: .bottom).combined(with: .opacity))
        #endif
    }
}

#if os(macOS)
/// System glass on macOS 26; before it, a material capsule with a hairline and soft shadow.
private struct MacGlassPill: ViewModifier {
    func body(content: Content) -> some View {
        if #available(macOS 26, *) {
            content.glassEffect(.regular, in: Capsule())
        } else {
            content
                .background(.regularMaterial, in: Capsule())
                .overlay(Capsule().strokeBorder(Color.primary.opacity(0.1), lineWidth: 0.5))
                .shadow(color: .black.opacity(0.1), radius: 8, y: 4)
        }
    }
}

/// The toast's Undo: a 26pt capsule, primary at 13% with Semibold primary text.
private struct MacUndoButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(Color(.primary))
            .padding(.horizontal, 12)
            .frame(height: 26)
            .background(Color(.primary).opacity(configuration.isPressed ? 0.22 : 0.13), in: Capsule())
            .contentShape(Capsule())
            .scaleEffect(configuration.isPressed ? 0.94 : 1)
            .animation(.timingCurve(0.34, 1.56, 0.64, 1, duration: 0.18), value: configuration.isPressed)
    }
}
#endif
