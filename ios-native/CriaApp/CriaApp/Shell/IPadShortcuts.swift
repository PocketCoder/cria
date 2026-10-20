#if os(iOS)
import CriaKit
import SwiftUI

/// Hardware-keyboard shortcuts for the iPad shell, as on the Mac: ⌘K opens the command palette, ⌘N a new task, ⌘F
/// Search, ⌘1, ⌘2 and ⌘3 Today, Upcoming and Inbox. The iPhone gets none of them. The buttons are invisible and carry
/// the key equivalents, which also lists them in the overlay iPadOS shows when ⌘ is held.
struct IPadShortcuts: ViewModifier {
    let onPalette: () -> Void
    let onNewTask: () -> Void
    let onGo: (AppTab) -> Void

    func body(content: Content) -> some View {
        if UIDevice.current.userInterfaceIdiom == .pad {
            content.background { keys }
        } else {
            content
        }
    }

    private var keys: some View {
        Group {
            Button("Command Palette", action: onPalette).keyboardShortcut("k", modifiers: .command)
            Button("New Task", action: onNewTask).keyboardShortcut("n", modifiers: .command)
            Button("Search") { onGo(.search) }.keyboardShortcut("f", modifiers: .command)
            Button("Today") { onGo(.today) }.keyboardShortcut("1", modifiers: .command)
            Button("Upcoming") { onGo(.upcoming) }.keyboardShortcut("2", modifiers: .command)
            Button("Inbox") { onGo(.inbox) }.keyboardShortcut("3", modifiers: .command)
        }
        .opacity(0)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
#endif
