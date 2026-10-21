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

    func show(services: AppServices, contextProjectId: String?, initialLine: String, screen: QuickAddPanelScreen = .add) {
        // Read before the panel takes key: opened from the app (⌘N), it sits over that window; from another app (the
        // global shortcut), over the screen.
        let anchor = NSApp.keyWindow ?? NSApp.mainWindow
        close()
        let sheet = QuickAddPanelRoot(
            services: services, contextProjectId: contextProjectId, initialLine: initialLine,
            onClose: { [weak self] in self?.close() }, screen: screen
        )
        let root = sheet
            .frame(width: Self.width)
            .fixedSize(horizontal: false, vertical: true)
            // Opaque: a material let the desktop and the window's edge show through as a streak across the panel.
            .background(Color(nsColor: .windowBackgroundColor), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
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
        place(panel, over: anchor)
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
    }

    func close() {
        panel?.orderOut(nil)
        panel = nil
    }

    /// Centred over the app's window when it was opened from there (120pt below its top), else on the screen with the
    /// mouse, 190pt below the top of the visible area. The hosting view grows the panel downwards as chips come and go.
    private func place(_ panel: NSPanel, over anchor: NSWindow?) {
        if let anchor, anchor.isVisible, anchor !== panel {
            let frame = anchor.frame
            let left = frame.midX - panel.frame.width / 2
            panel.setFrameTopLeftPoint(NSPoint(x: left, y: frame.maxY - 120))
            return
        }
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

/// The panel's three screens.
enum QuickAddPanelScreen { case add, ramble, photo }

/// What the panel shows: quick add, or the Ramble or From photo screen it swaps to. Back on either returns to quick
/// add; adding their tasks also returns, so the panel stays the one place new tasks come from.
private struct QuickAddPanelRoot: View {

    let services: AppServices
    let contextProjectId: String?
    let initialLine: String
    let onClose: () -> Void
    @State var screen: QuickAddPanelScreen

    var body: some View {
        switch screen {
        case .add:
            QuickAddSheet(
                services: services, contextProjectId: contextProjectId, initialLine: initialLine,
                onRamble: { screen = .ramble }, onPhoto: { screen = .photo }, onClose: onClose
            )
        case .ramble:
            RambleSheet(services: services, onClose: { screen = .add })
        case .photo:
            ShoppingPhotoSheet(services: services, onClose: { screen = .add })
        }
    }
}
