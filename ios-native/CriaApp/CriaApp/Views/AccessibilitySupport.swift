import CriaKit
import Foundation
import SwiftUI

/// Keeps user-chosen colours (labels, projects) legible as text. A pale yellow label tints its chip text yellow,
/// which is unreadable on white; these helpers darken it in light mode and lighten it in dark mode until the text
/// reaches WCAG AA (4.5:1) against the cell behind it.
enum LegibleTint {
    private struct RGB {
        var red: Double
        var green: Double
        var blue: Double

        init?(hex: String?) {
            guard let raw = hex?.trimmingCharacters(in: CharacterSet(charactersIn: "# ")),
                  raw.count == 6, let value = UInt32(raw, radix: 16) else { return nil }
            red = Double((value >> 16) & 0xFF) / 255
            green = Double((value >> 8) & 0xFF) / 255
            blue = Double(value & 0xFF) / 255
        }

        init(red: Double, green: Double, blue: Double) {
            self.red = red
            self.green = green
            self.blue = blue
        }

        /// WCAG relative luminance.
        var luminance: Double {
            func linear(_ channel: Double) -> Double {
                channel <= 0.039_28 ? channel / 12.92 : pow((channel + 0.055) / 1.055, 2.4)
            }
            return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue)
        }

        func mixed(toward target: Double, by amount: Double) -> RGB {
            RGB(
                red: red + (target - red) * amount,
                green: green + (target - green) * amount,
                blue: blue + (target - blue) * amount
            )
        }

        var color: Color { Color(red: red, green: green, blue: blue) }
    }

    /// Luminance of the cell behind chips: white in light mode, near-black (#1C1C1E) in dark mode.
    private static func backgroundLuminance(_ scheme: ColorScheme) -> Double {
        scheme == .dark ? 0.012 : 1
    }

    private static func contrast(_ first: Double, _ second: Double) -> Double {
        (max(first, second) + 0.05) / (min(first, second) + 0.05)
    }

    /// Text tint for a chip of colour `hex`, or nil when the hex does not parse (callers keep their fallback).
    static func chip(_ hex: String?, scheme: ColorScheme) -> Color? {
        guard var rgb = RGB(hex: hex) else { return nil }
        let background = backgroundLuminance(scheme)
        let target: Double = scheme == .dark ? 1 : 0
        let original = rgb
        var step = 0.0
        while contrast(rgb.luminance, background) < 4.5 && step < 1 {
            step += 0.05
            rgb = original.mixed(toward: target, by: step)
        }
        return rgb.color
    }

    /// Black or white, whichever reads better on a solid fill of colour `hex` (white when it does not parse).
    static func onFill(_ hex: String?) -> Color {
        guard let rgb = RGB(hex: hex) else { return .white }
        return contrast(rgb.luminance, 1) >= contrast(rgb.luminance, 0) ? .white : .black
    }
}

/// Spoken forms of dates and counts, so VoiceOver does not read ISO stamps or arrows.
enum SpokenText {
    private static let utc: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        return calendar
    }()

    /// "3 to 7 June", "28 May to 3 June", or "3 June" for a single day. The year is added when either end is
    /// outside the current one. `start` and `end` are Gantt day numbers (days since 1970 in UTC).
    static func dayRange(start: Int, end: Int, now: Date = Date()) -> String {
        let first = Date(timeIntervalSince1970: Double(start) * 86_400)
        let last = Date(timeIntervalSince1970: Double(end) * 86_400)
        let thisYear = Calendar.cria.component(.year, from: now)
        let firstParts = utc.dateComponents([.year, .month, .day], from: first)
        let lastParts = utc.dateComponents([.year, .month, .day], from: last)
        let showYear = firstParts.year != thisYear || lastParts.year != thisYear
        func text(_ date: Date, month: Bool, year: Bool) -> String {
            var style = Date.FormatStyle(calendar: utc, timeZone: utc.timeZone).day()
            if month { style = style.month(.wide) }
            if year { style = style.year() }
            return date.formatted(style)
        }
        if start == end { return text(first, month: true, year: showYear) }
        let sameMonth = firstParts.month == lastParts.month && firstParts.year == lastParts.year
        let sameYear = firstParts.year == lastParts.year
        let from = text(first, month: !sameMonth, year: showYear && !sameYear)
        return "\(from) to \(text(last, month: true, year: showYear))"
    }

    /// "1 task", "4 tasks".
    static func tasks(_ count: Int) -> String {
        count == 1 ? "1 task" : "\(count) tasks"
    }
}
