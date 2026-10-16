import CriaKit
import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

extension Color {
    /// A colour that follows the system light or dark appearance, from a ported `globals.css` token.
    init(_ token: ThemeToken) {
        self = Self.themed(token)
    }

    /// One `Color` per token: building a dynamic colour for every use, in every row of every render, was a visible
    /// share of the main thread's time.
    private nonisolated(unsafe) static var themedColours: [ThemeToken: Color] = [:]
    private static let themedLock = NSLock()

    private static func themed(_ token: ThemeToken) -> Color {
        themedLock.lock()
        defer { themedLock.unlock() }
        if let cached = themedColours[token] { return cached }
        let colour = makeThemed(token)
        themedColours[token] = colour
        return colour
    }

    private static func makeThemed(_ token: ThemeToken) -> Color {
        let pair = token.pair
        #if canImport(UIKit)
        return Color(uiColor: UIColor { traits in
            let rgb = (traits.userInterfaceStyle == .dark ? pair.dark : pair.light).rgb
            return UIColor(red: rgb.red, green: rgb.green, blue: rgb.blue, alpha: 1)
        })
        #else
        return Color(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            let rgb = (isDark ? pair.dark : pair.light).rgb
            return NSColor(srgbRed: rgb.red, green: rgb.green, blue: rgb.blue, alpha: 1)
        })
        #endif
    }

    /// Parses a Vikunja hex colour (with or without `#`). Nil when it is not six hex digits.
    init?(hexString: String?) {
        guard let raw = hexString?.trimmingCharacters(in: CharacterSet(charactersIn: "# ")),
              raw.count == 6, let value = UInt32(raw, radix: 16) else { return nil }
        self.init(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
}

/// Native type: SF Pro through Dynamic Type text styles everywhere. Onest is used only for navigation large
/// titles (see `applyNavigationAppearance()`) and the login wordmark.
enum Theme {
    static let brandFont = "Onest-Bold"

    static let rowTitle = Font.body
    static let rowSubtitle = Font.subheadline
    static let headline = Font.headline
    static let title = Font.title2.weight(.semibold)
    static let chip = Font.caption.weight(.medium)
    static let caption = Font.footnote
    static let footnote = Font.caption2
    static let wordmark = Font.custom(brandFont, size: 34, relativeTo: .largeTitle)

    /// Custom cards only (Kanban); inset-grouped sections are drawn by the system.
    static let radius: CGFloat = 12
    static let cardRadius: CGFloat = 20
    static let chipHeight: CGFloat = 22
    #if os(macOS)
    /// The web's 18px check in a pointer-sized target; touch keeps the larger ring and the 44pt target.
    static let checkSize: CGFloat = 18
    static let checkTarget: CGFloat = 24
    #else
    static let checkSize: CGFloat = 24
    static let checkTarget: CGFloat = 44
    #endif

    /// Onest Bold for large titles; inline titles stay SF Pro semibold. Does nothing until `Onest-Bold.ttf` is
    /// bundled and listed under `UIAppFonts`, so the system font stands in.
    @MainActor
    static func applyNavigationAppearance() {
        #if canImport(UIKit)
        guard let onest = UIFont(name: brandFont, size: 34) else { return }
        let scaled = UIFontMetrics(forTextStyle: .largeTitle).scaledFont(for: onest)
        UINavigationBar.appearance().largeTitleTextAttributes = [.font: scaled, .kern: -0.6]
        #endif
    }
}
