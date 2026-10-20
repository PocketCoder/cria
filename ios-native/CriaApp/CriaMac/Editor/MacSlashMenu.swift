import AppKit
import CriaKit
import SwiftUI

/// The slash menu's list on the Mac: the commands that match, the highlighted one, a click to choose. Reads
/// `SlashMenuState`, so it follows the typing and the arrow keys without being rebuilt.
struct MacSlashMenuList: View {
    static let width: CGFloat = 252
    private static let rowHeight: CGFloat = 40

    let state: SlashMenuState
    let onPick: (SlashCommand) -> Void

    /// Tall enough for every match, up to about five and a half rows (the rest scrolls).
    static func height(count: Int) -> CGFloat {
        min(CGFloat(max(count, 1)) * rowHeight + 8, 228)
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 0) {
                    ForEach(Array(state.commands.enumerated()), id: \.element) { index, command in
                        row(command, isSelected: index == state.selected)
                    }
                }
                .padding(4)
            }
            .onChange(of: state.selected) { _, selected in
                guard state.commands.indices.contains(selected) else { return }
                proxy.scrollTo(state.commands[selected])
            }
        }
        .frame(width: Self.width, height: Self.height(count: state.commands.count))
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Color.primary.opacity(0.1)))
    }

    private func row(_ command: SlashCommand, isSelected: Bool) -> some View {
        HStack(spacing: 10) {
            Image(systemName: command.symbol)
                .frame(width: 20)
                .foregroundStyle(isSelected ? Color.primary : MacTheme.label2)
            VStack(alignment: .leading, spacing: 1) {
                Text(command.title).font(.system(size: 12, weight: .medium))
                Text(command.summary).font(.system(size: 10)).foregroundStyle(MacTheme.label2).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 8)
        .frame(height: Self.rowHeight)
        .background(isSelected ? MacTheme.selection : Color.clear, in: RoundedRectangle(cornerRadius: 6))
        .contentShape(Rectangle())
        .onTapGesture { onPick(command) }
        .id(command)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }
}

/// A panel that never takes the keyboard: the text view keeps typing while the menu is open.
private final class SlashPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

/// Shows the slash menu as a floating panel under the caret, and moves, resizes or hides it as the menu changes. A
/// child window of the editor's window, so it follows the window and goes with it.
@MainActor
final class MacSlashMenuPresenter {
    private var panel: NSPanel?

    func sync(controller: EditorController, view: MacEditorTextView) {
        let state = controller.slash
        guard state.isVisible, let window = view.window, let caret = view.caretScreenRect() else {
            hide()
            return
        }
        let panel = panel ?? makePanel(controller: controller)
        let size = NSSize(width: MacSlashMenuList.width, height: MacSlashMenuList.height(count: state.commands.count))
        // Under the caret's line, or above it when the screen ends first.
        var origin = NSPoint(x: caret.minX, y: caret.minY - size.height - 4)
        if let visible = (window.screen ?? NSScreen.main)?.visibleFrame {
            if origin.y < visible.minY { origin.y = caret.maxY + 4 }
            origin.x = min(max(origin.x, visible.minX), max(visible.maxX - size.width, visible.minX))
        }
        panel.setFrame(NSRect(origin: origin, size: size), display: true)
        if panel.parent == nil { window.addChildWindow(panel, ordered: .above) }
    }

    func hide() {
        guard let panel else { return }
        panel.parent?.removeChildWindow(panel)
        panel.orderOut(nil)
    }

    private func makePanel(controller: EditorController) -> NSPanel {
        let panel = SlashPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.isReleasedWhenClosed = false
        let list = MacSlashMenuList(state: controller.slash) { [weak controller] command in
            controller?.runSlash(command)
        }
        panel.contentView = NSHostingView(rootView: list)
        self.panel = panel
        return panel
    }
}
