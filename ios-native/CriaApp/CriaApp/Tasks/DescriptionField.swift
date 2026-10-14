import CriaKit
import Observation
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// The task screen's inline description: the editor's controller and what was last saved. TaskDetailView owns it, so
/// it outlives the lazily created Form row. Saves when editing ends, when a task checkbox is toggled outside editing,
/// and when the host calls `save()` (leaving the screen, going to the background, expanding).
@MainActor @Observable
final class DescriptionDraft {
    let controller = EditorController()
    /// Drives the "Add description" placeholder.
    private(set) var isEmpty = true
    /// The stored description the editor last showed or saved, handed to the full-screen editor.
    @ObservationIgnored private(set) var baselineHTML = ""
    @ObservationIgnored private var baseline = RichDocument(html: "")
    /// The user changed the text since the last save.
    @ObservationIgnored private var dirty = false
    /// The task is being deleted: nothing may be saved onto it.
    @ObservationIgnored private var closed = false
    private let onSave: (String) -> Void

    /// One line while empty, like a placeholder; three as soon as there is text, then it grows with the text.
    nonisolated static func minHeight(empty: Bool) -> CGFloat {
        ceil(PlatformFont.bodyLineHeight * (empty ? 1 : 3)) + 12
    }

    init(onSave: @escaping (String) -> Void) {
        self.onSave = onSave
        controller.onChange = { [weak self] in self?.edited() }
        controller.onEndEditing = { [weak self] in self?.save() }
    }

    private func edited() {
        dirty = true
        let empty = (controller.textView?.storage.length ?? 0) == 0
        if empty != isEmpty { isEmpty = empty }
        // A checkbox tapped while not editing ends no editing session, so save now.
        if !controller.isEditing { save() }
    }

    func save() {
        // No document means the text view is gone without a capture: leave the stored description alone.
        guard dirty, !closed, let document = controller.currentDocument() else { return }
        dirty = false
        guard document != baseline else { return }
        let html = document.blocks.isEmpty ? "" : document.html()
        baseline = document
        baselineHTML = html
        onSave(html)
    }

    /// The stored description changed (a pull, another device, the full-screen editor). Show it, unless the user has
    /// unsaved changes here, which win and are saved when editing ends.
    func follow(_ html: String) {
        let incoming = RichDocument(html: html)
        guard !dirty, incoming != baseline else { return }
        baseline = incoming
        baselineHTML = html
        isEmpty = incoming.blocks.isEmpty
        // A no-op while the row is off screen; its next text view loads the stored description.
        controller.load(html)
    }

    /// Ends editing and saves, before the full-screen editor opens on the same text.
    func finishEditing() {
        controller.textView?.unfocus()
        save()
    }

    func close() {
        closed = true
        dirty = false
    }

    /// The delete failed: the task stays, and so does saving.
    func reopen() {
        closed = false
    }
}

/// The description row: the rich text editor, editable in place, sized to its text (at least three lines), with an
/// Expand button for the full-screen editor. Links open on tap while not editing.
struct DescriptionField: View {
    let services: AppServices
    let taskLocalId: String
    let html: String
    let draft: DescriptionDraft
    let onExpand: () -> Void
    /// What the text needs at the current width, as the editor last reported it.
    @State private var measured: CGFloat = 0
    private var height: CGFloat { max(measured, DescriptionDraft.minHeight(empty: draft.isEmpty)) }

    /// Down from the top of the editor to its text: the Mac's formatting bar sits above it.
    private static var placeholderInset: CGFloat {
        #if os(macOS)
        36
        #else
        6
        #endif
    }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            EditorHost(
                services: services, taskLocalId: taskLocalId, initialHTML: html, controller: draft.controller,
                inlineHeight: height, onHeightChange: { measured = $0 }
            )
            .overlay(alignment: .topLeading) {
                if draft.isEmpty {
                    Text("Add description")
                        .foregroundStyle(Color(.mutedForeground))
                        .padding(.top, Self.placeholderInset)
                        .allowsHitTesting(false)
                }
            }
            // Beside the text rather than on a row of its own, so an empty description is one line tall.
            Button(action: onExpand) {
                Image(systemName: "arrow.up.left.and.arrow.down.right")
                    .font(Theme.caption)
                    .frame(width: 32, height: 32)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Expand description")
        }
    }
}
