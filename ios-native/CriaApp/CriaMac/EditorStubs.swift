import CriaKit
import Observation
import SwiftUI

// Stand-ins for the iOS rich text editor and the iOS-only AI entry points, so the shared task detail and quick add
// compile on macOS. Phase 3 replaces the description ones with a real editor; Phase 6 the AI ones.

/// Keeps the task screen's description saving contract. Nothing is edited on the Mac yet, so nothing is saved.
@MainActor @Observable
final class DescriptionDraft {
    private(set) var baselineHTML = ""
    private let onSave: (String) -> Void

    init(onSave: @escaping (String) -> Void) {
        self.onSave = onSave
    }

    func save() {}

    func follow(_ html: String) {
        baselineHTML = html
    }

    func finishEditing() {}

    func close() {}

    func reopen() {}
}

/// Read-only description for now.
struct DescriptionField: View {
    let services: AppServices
    let taskLocalId: String
    let html: String
    let draft: DescriptionDraft
    let onExpand: () -> Void

    var body: some View {
        if html.isEmpty {
            Text("No description").foregroundStyle(Color(.mutedForeground))
        } else {
            RichTextView(html: html, services: services)
        }
    }
}

struct DescriptionEditorView: View {
    let services: AppServices
    let taskLocalId: String
    let initialHTML: String
    let onSave: (String) -> Void

    var body: some View {
        RichTextView(html: initialHTML, services: services).padding().navigationTitle("Description")
    }
}

struct ShoppingPhotoSheet: View {
    let services: AppServices

    var body: some View {
        ContentUnavailableView("Photo tidy is not on the Mac yet", systemImage: "camera")
    }
}

enum BackgroundRun {
    /// No background extension on the Mac: the work simply runs.
    static func run<T: Sendable>(title: String, work: @escaping @Sendable () async throws -> T) async throws -> T {
        try await work()
    }
}
