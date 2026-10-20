import AppKit
import CriaKit
import SwiftUI

/// The mention picker on the Mac: a popover at the caret instead of the sheet iOS uses. Search users, Return picks the
/// first match, a click picks any, Escape or a click elsewhere closes it.
struct MacMentionPopoverView: View {
    let services: AppServices
    let onPick: (String) -> Void
    @State private var query = ""
    @State private var results: [UserResponse] = []
    @FocusState private var searchFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            TextField("Mention someone", text: $query)
                .textFieldStyle(.plain)
                .focused($searchFocused)
                .onSubmit { if let first = results.first { onPick(first.username) } }
                .padding(10)
            Divider()
            List(results, id: \.id) { user in
                Button { onPick(user.username) } label: {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(user.name?.isEmpty == false ? (user.name ?? user.username) : user.username)
                        Text("@\(user.username)").font(Theme.caption).foregroundStyle(MacTheme.label2)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            .listStyle(.plain)
        }
        .frame(width: 280, height: 300)
        .task { searchFocused = true }
        .task(id: query) {
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            results = await services.searchUsers(query)
        }
    }
}

/// Shows `MacMentionPopoverView` under the caret of a Mac editor and reports when it has closed.
@MainActor
final class MacMentionPopover: NSObject, NSPopoverDelegate {
    private var popover: NSPopover?
    private var onClose: (() -> Void)?

    /// `onPick` runs before the popover closes; `onClose` runs once, after it has, whichever way it closed.
    func show(from view: MacEditorTextView, services: AppServices, onPick: @escaping (String) -> Void, onClose: @escaping () -> Void) {
        guard let window = view.window, let screenRect = view.caretScreenRect() else {
            onClose()
            return
        }
        popover?.close()
        self.onClose = onClose
        let local = view.convert(window.convertFromScreen(screenRect), from: nil)
        let anchor = NSRect(x: local.minX, y: local.minY, width: max(local.width, 1), height: local.height)
        let popover = NSPopover()
        popover.behavior = .transient
        popover.delegate = self
        popover.contentViewController = NSHostingController(rootView: MacMentionPopoverView(services: services) { [weak self] username in
            onPick(username)
            self?.popover?.close()
        })
        self.popover = popover
        popover.show(relativeTo: anchor, of: view, preferredEdge: .maxY)
    }

    func popoverDidClose(_ notification: Notification) {
        popover = nil
        let done = onClose
        onClose = nil
        done?()
    }
}
