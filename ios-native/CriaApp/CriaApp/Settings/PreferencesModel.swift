import CriaKit
import Foundation
import SwiftUI

/// The device-local preferences behind Settings. Every change is saved and announced, so the root view (colour scheme,
/// date style, completion sound), the reminder scheduler and the summary scheduler pick it up at once.
@MainActor
final class PreferencesModel: ObservableObject {
    @Published var value: LocalPreferences {
        didSet {
            guard value != oldValue else { return }
            store.save(value)
            NotificationCenter.default.post(name: .criaPreferencesChanged, object: nil)
        }
    }

    private let store = PreferencesStore()

    init() {
        value = store.load()
    }
}

/// "HH:mm" text and `Date` conversions for time pickers.
enum ClockTime {
    static func date(_ text: String, calendar: Calendar = .cria) -> Date {
        let parts = text.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2 else { return Date() }
        return calendar.date(bySettingHour: parts[0], minute: parts[1], second: 0, of: Date()) ?? Date()
    }

    static func text(_ date: Date, calendar: Calendar = .cria) -> String {
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
    }
}

/// Day names in Vikunja's order: 0 = Sunday.
enum Weekdays {
    static let names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

    static func name(_ index: Int) -> String {
        names.indices.contains(index) ? names[index] : ""
    }
}
