import AppKit
import CriaKit
import SwiftUI

/// Quick add as a floating panel, as Spotlight is: 640pt wide, centred 190pt from the top of the screen, above every
/// app. ⌘N and the global hotkey both open it through `MacActions.addRequest`; it hosts the shared `QuickAddSheet`
/// in its Mac layout. Esc or adding the task closes it.
@MainActor
final class QuickAddPanel {
    static let shared = QuickAddPanel()
    private var panel: NSPanel?

    private static let width: CGFloat = 640
    private static let topInset: CGFloat = 190

    func show(services: AppServices, contextProjectId: String?, initialLine: String) {
        close()
        let sheet = QuickAddSheet(
            services: services, contextProjectId: contextProjectId, initialLine: initialLine,
            onClose: { [weak self] in self?.close() }
        )
        let root = sheet
            .frame(width: Self.width)
            .fixedSize(horizontal: false, vertical: true)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .strokeBorder(Color.primary.opacity(0.1), lineWidth: 0.5)
            )
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .tint(Color(.primary))
            .modifier(MacPreferenceEnvironment())
        let host = NSHostingView(rootView: root)
        host.sizingOptions = [.preferredContentSize]

        let panel = QuickAddWindow(
            contentRect: NSRect(x: 0, y: 0, width: Self.width, height: 220),
            styleMask: [.borderless, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        panel.onCancel = { [weak self] in self?.close() }
        panel.contentView = host
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.isMovableByWindowBackground = true
        panel.isReleasedWhenClosed = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        self.panel = panel
        // Fitted before placing, so the top edge lands 190pt down rather than moving when the content sizes itself.
        panel.setContentSize(host.fittingSize)
        place(panel)
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
    }

    func close() {
        panel?.orderOut(nil)
        panel = nil
    }

    /// Centred on the screen with the mouse (or the main screen), its top 190pt below the top of the visible area.
    /// The hosting view grows the panel downwards as chips and the queue come and go.
    private func place(_ panel: NSPanel) {
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { $0.frame.contains(mouse) } ?? NSScreen.main
        guard let visible = screen?.visibleFrame else {
            panel.center()
            return
        }
        let left = visible.midX - panel.frame.width / 2
        panel.setFrameTopLeftPoint(NSPoint(x: left, y: visible.maxY - Self.topInset))
    }
}

/// A borderless panel that can still take typing, and closes on Esc.
private final class QuickAddWindow: NSPanel {
    var onCancel: (() -> Void)?

    override var canBecomeKey: Bool { true }

    override func cancelOperation(_ sender: Any?) {
        onCancel?()
    }
}
