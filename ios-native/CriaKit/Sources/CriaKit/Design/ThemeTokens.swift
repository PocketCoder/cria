import Foundation

public struct RGBColor: Equatable, Sendable {
    public let red: Double
    public let green: Double
    public let blue: Double
}

/// A colour as written in `globals.css`: OKLCH (lightness in percent) or a hex literal.
public enum ColorSpec: Equatable, Sendable {
    case oklch(Double, Double, Double)
    case hex(UInt32)

    public var rgb: RGBColor {
        switch self {
        case .oklch(let lightness, let chroma, let hue):
            return oklchToSRGB(lightness: lightness / 100, chroma: chroma, hue: hue)
        case .hex(let value):
            return RGBColor(
                red: Double((value >> 16) & 0xFF) / 255,
                green: Double((value >> 8) & 0xFF) / 255,
                blue: Double(value & 0xFF) / 255
            )
        }
    }
}

/// OKLCH to gamma-encoded sRGB, clamped to the gamut. Lightness is 0...1, hue in degrees.
public func oklchToSRGB(lightness: Double, chroma: Double, hue: Double) -> RGBColor {
    let radians = hue * Double.pi / 180
    let axisA = chroma * cos(radians)
    let axisB = chroma * sin(radians)
    let long = pow(lightness + 0.3963377774 * axisA + 0.2158037573 * axisB, 3)
    let medium = pow(lightness - 0.1055613458 * axisA - 0.0638541728 * axisB, 3)
    let short = pow(lightness - 0.0894841775 * axisA - 1.2914855480 * axisB, 3)
    let red = 4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short
    let green = -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short
    let blue = -0.0041960863 * long - 0.7034186147 * medium + 1.7076147010 * short
    return RGBColor(red: encodeSRGB(red), green: encodeSRGB(green), blue: encodeSRGB(blue))
}

private func encodeSRGB(_ linear: Double) -> Double {
    let clamped = min(max(linear, 0), 1)
    let encoded = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * pow(clamped, 1 / 2.4) - 0.055
    return min(max(encoded, 0), 1)
}

public struct ThemePair: Equatable, Sendable {
    public let light: ColorSpec
    public let dark: ColorSpec
}

/// Semantic colours. Values are ported from `src/styles/globals.css` (light block and the dark block).
public enum ThemeToken: String, CaseIterable, Sendable {
    case background, card, foreground, muted, mutedForeground, border, input
    case primary, primaryForeground, primarySoft
    case destructive, success, warning, info, ring
    case destructiveForeground, successText, warningText, warningForeground
    case priorityLow, priorityMedium, priorityHigh, priorityUrgent, priorityCritical, priorityForeground
    /// Native iOS surfaces: the screen behind inset-grouped lists, and the row/card colour on top of it.
    case grouped, cell
    /// Supporting accents for Settings icon squares and swipe actions, plus text-safe chip shades.
    case sky500, sky700, coral500, meadow500, meadow700, marigold500, marigold700
    case llama500, llama800, plum500, fleece500, heather600

    public var pair: ThemePair { Self.table[self] ?? Self.fallback }

    private static let fallback = ThemePair(light: .hex(0), dark: .hex(0xFFFFFF))

    private static let table: [ThemeToken: ThemePair] = [
        .background: ThemePair(light: .oklch(99.3, 0.004, 95), dark: .oklch(15, 0.012, 285)),
        .card: ThemePair(light: .oklch(100, 0, 0), dark: .oklch(19, 0.012, 285)),
        .foreground: ThemePair(light: .oklch(24, 0.015, 285), dark: .oklch(95, 0.005, 285)),
        .muted: ThemePair(light: .oklch(97, 0.005, 95), dark: .oklch(23, 0.012, 285)),
        .mutedForeground: ThemePair(light: .oklch(50, 0.015, 285), dark: .oklch(66, 0.015, 285)),
        .border: ThemePair(light: .oklch(93, 0.004, 95), dark: .oklch(28, 0.012, 285)),
        .input: ThemePair(light: .oklch(97, 0.005, 95), dark: .oklch(24, 0.012, 285)),
        .primary: ThemePair(light: .hex(0x643B9F), dark: .oklch(67, 0.14, 300)),
        .primaryForeground: ThemePair(light: .oklch(99, 0, 0), dark: .oklch(17, 0.045, 300)),
        .primarySoft: ThemePair(light: .oklch(97.6, 0.014, 300), dark: .oklch(30, 0.07, 300)),
        .destructive: ThemePair(light: .oklch(55, 0.22, 27), dark: .oklch(70, 0.16, 25)),
        .destructiveForeground: ThemePair(light: .oklch(99, 0, 0), dark: .oklch(17, 0.045, 300)),
        .successText: ThemePair(light: .oklch(50, 0.14, 150), dark: .oklch(72, 0.13, 150)),
        .warningText: ThemePair(light: .oklch(50, 0.11, 70), dark: .oklch(80, 0.12, 85)),
        .warningForeground: ThemePair(light: .oklch(24, 0.015, 285), dark: .oklch(17, 0.045, 300)),
        .success: ThemePair(light: .oklch(62, 0.16, 150), dark: .oklch(72, 0.13, 150)),
        .warning: ThemePair(light: .oklch(75, 0.16, 80), dark: .oklch(80, 0.12, 85)),
        .info: ThemePair(light: .oklch(62, 0.12, 240), dark: .oklch(62, 0.12, 240)),
        .ring: ThemePair(light: .oklch(55, 0.16, 300), dark: .oklch(67, 0.14, 300)),
        .priorityLow: ThemePair(light: .oklch(62, 0.12, 240), dark: .oklch(62, 0.12, 240)),
        .priorityMedium: ThemePair(light: .oklch(68, 0.14, 150), dark: .oklch(68, 0.14, 150)),
        .priorityHigh: ThemePair(light: .oklch(76, 0.15, 75), dark: .oklch(80, 0.12, 85)),
        .priorityUrgent: ThemePair(light: .oklch(68, 0.19, 45), dark: .oklch(72, 0.16, 45)),
        .priorityCritical: ThemePair(light: .oklch(58, 0.22, 27), dark: .oklch(66, 0.19, 25)),
        .priorityForeground: ThemePair(light: .oklch(17, 0.045, 300), dark: .oklch(17, 0.045, 300)),
        .grouped: ThemePair(light: .oklch(96.4, 0.006, 95), dark: .oklch(11, 0.01, 285)),
        .cell: ThemePair(light: .oklch(100, 0, 0), dark: .oklch(19.5, 0.012, 285)),
        .sky500: ThemePair(light: .oklch(62, 0.12, 240), dark: .oklch(62, 0.12, 240)),
        .sky700: ThemePair(light: .oklch(47, 0.12, 240), dark: .oklch(47, 0.12, 240)),
        .coral500: ThemePair(light: .oklch(58, 0.22, 27), dark: .oklch(58, 0.22, 27)),
        .meadow500: ThemePair(light: .oklch(62, 0.16, 150), dark: .oklch(62, 0.16, 150)),
        .meadow700: ThemePair(light: .oklch(46, 0.13, 150), dark: .oklch(46, 0.13, 150)),
        .marigold500: ThemePair(light: .oklch(75, 0.16, 80), dark: .oklch(75, 0.16, 80)),
        .marigold700: ThemePair(light: .oklch(55, 0.13, 70), dark: .oklch(55, 0.13, 70)),
        .llama500: ThemePair(light: .oklch(55, 0.16, 300), dark: .oklch(55, 0.16, 300)),
        .llama800: ThemePair(light: .oklch(31, 0.1, 300), dark: .oklch(31, 0.1, 300)),
        .plum500: ThemePair(light: .oklch(58, 0.19, 345), dark: .oklch(58, 0.19, 345)),
        .fleece500: ThemePair(light: .oklch(50, 0.015, 285), dark: .oklch(50, 0.015, 285)),
        .heather600: ThemePair(light: .oklch(55, 0.15, 320), dark: .oklch(55, 0.15, 320))
    ]

    /// The priority colour for Vikunja's 1...5 scale. 0 (unset) has none.
    public static func priority(_ level: Int) -> ThemeToken? {
        switch level {
        case 1: return .priorityLow
        case 2: return .priorityMedium
        case 3: return .priorityHigh
        case 4: return .priorityUrgent
        case 5: return .priorityCritical
        default: return nil
        }
    }
}
