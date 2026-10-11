import CriaKit
import SwiftUI
import UIKit

extension Color {
    /// A colour that follows the system light or dark appearance, from a ported `globals.css` token.
    init(_ token: ThemeToken) {
        let pair = token.pair
        self.init(uiColor: UIColor { traits in
            let rgb = (traits.userInterfaceStyle == .dark ? pair.dark : pair.light).rgb
            return UIColor(red: rgb.red, green: rgb.green, blue: rgb.blue, alpha: 1)
        })
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

/// Type scale from `globals.css`. Onest is requested by name; until the font files are bundled and listed in
/// `UIAppFonts`, SwiftUI falls back to the system font.
enum Theme {
    static let fontName = "Onest"
    static let rowTitle = Font.custom(fontName, size: 15, relativeTo: .body)
    static let headline = Font.custom(fontName, size: 17, relativeTo: .headline).weight(.semibold)
    static let title = Font.custom(fontName, size: 20, relativeTo: .title3).weight(.semibold)
    static let largeTitle = Font.custom(fontName, size: 34, relativeTo: .largeTitle).weight(.bold)
    static let caption = Font.custom(fontName, size: 11, relativeTo: .caption)
    static let footnote = Font.custom(fontName, size: 10, relativeTo: .caption2)
    static let radius: CGFloat = 10
}
