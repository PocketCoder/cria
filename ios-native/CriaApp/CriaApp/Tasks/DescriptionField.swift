import CriaKit
import Observation
import SwiftUI
import UIKit

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

    /// About three lines of body text plus the editor's insets.
    nonisolated static var minHeight: CGFloat { ceil(UIFont.preferredFont(forTextStyle: .body).lineHeight * 3) + 12 }

    init(onSave: @escaping (String) -> Void) {
        self.onSave = onSave
        controller.onChange = { [weak self] in self?.edited() }
        controller.onEndEditing = { [weak self] in self?.save() }
    }

    private func edited() {
        dirty = true
        let empty = (controller.textView?.textStorage.length ?? 0) == 0
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
        controller.textView?.resignFirstResponder()
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
    @State private var height = DescriptionDraft.minHeight

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            EditorHost(
                services: services, taskLocalId: taskLocalId, initialHTML: html, controller: draft.controller,
                inlineHeight: height, onHeightChange: { height = max($0, DescriptionDraft.minHeight) }
            )
            .overlay(alignment: .topLeading) {
                if draft.isEmpty {
                    Text("Add description")
                        .foregroundStyle(Color(.mutedForeground))
                        .padding(.top, 6)
                        .allowsHitTesting(false)
                }
            }
            HStack {
                Spacer()
                Button("Expand", systemImage: "arrow.up.left.and.arrow.down.right", action: onExpand)
                    .font(Theme.caption)
                    .buttonStyle(.borderless)
            }
        }
    }
}
