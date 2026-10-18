import AppKit
import SwiftUI

/// The Mac surfaces and text shades from the macOS design handoff (its tokens table). The brand colours stay in
/// `ThemeToken`; these are only the window-level greys the iOS palette has
/// no name for. Light and dark follow the window's appearance.
enum MacTheme {
    /// The content column behind lists.
    static let window = dynamic(light: 0xFDFCFA, dark: 0x0F0F14)
    /// The inspector.
    static let inspector = dynamic(light: 0xF9F8F5, dark: 0x14141A)
    /// Field boxes and project info cards.
    static let cell = dynamic(light: 0xF5F4F0, dark: 0x1A1A20)
    /// Kanban cards.
    static let card = dynamic(light: 0xFFFFFF, dark: 0x212128)
    /// Secondary and tertiary text.
    static let label2 = dynamic(light: 0x5C5D66, dark: 0xA3A4AD)
    static let label3 = dynamic(light: 0x919199, dark: 0x6D6E77)
    /// The New Task circle's icon on the solid purple: white in light, `#130A20` on the lighter dark-mode purple.
    static let onPrimary = dynamic(light: 0xFFFFFF, dark: 0x130A20)
    /// Hover fill.
    static let fill = Color.primary.opacity(0.055)
    /// The selected row: primary at 13% in light, 22% in dark.
    static let selection = Color(nsColor: NSColor(name: nil) { appearance in
        let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        return isDark
            ? NSColor(srgbRed: 0xA3 / 255, green: 0x7F / 255, blue: 0xDE / 255, alpha: 0.22)
            : NSColor(srgbRed: 0x64 / 255, green: 0x3B / 255, blue: 0x9F / 255, alpha: 0.13)
    })
    /// Overdue dates and destructive items.
    static let coral = Color(red: 0xA9 / 255, green: 0x15 / 255, blue: 0x18 / 255)
    /// The favourite star.
    static let marigold = Color(red: 0xE2 / 255, green: 0xA0 / 255, blue: 0)

    /// Onest Bold large titles: 28pt on screens, tracking -0.02em.
    static let largeTitle = Font.custom(Theme.brandFont, size: 28)
    static let largeTitleTracking: CGFloat = -0.56

    private static func dynamic(light: UInt32, dark: UInt32) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            let value = isDark ? dark : light
            return NSColor(
                srgbRed: CGFloat((value >> 16) & 0xFF) / 255,
                green: CGFloat((value >> 8) & 0xFF) / 255,
                blue: CGFloat(value & 0xFF) / 255,
                alpha: 1
            )
        })
    }
}
