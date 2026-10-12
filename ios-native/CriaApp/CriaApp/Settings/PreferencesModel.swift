import CriaKit
import Foundation
import SwiftUI

/// The device-local preferences behind Settings. Every change is saved and announced, so the root view (colour scheme,
/// date style, completion sound), the reminder scheduler and the summary scheduler pick it up at once. The display
/// prefs that follow the account (colour scheme, date and time format, completion sound) are also pushed to the server,
/// and a change applied from the server while Settings is open shows here at once.
@MainActor
final class PreferencesModel: ObservableObject {
    @Published var value: LocalPreferences {
        didSet {
            guard value != oldValue, !isApplyingRemote else { return }
            store.save(value)
            NotificationCenter.default.post(name: .criaPreferencesChanged, object: self)
            if let services {
                let old = oldValue
                let new = value
                Task { await services.pushSyncedPreferences(from: old, to: new) }
            }
        }
    }

    private let store = PreferencesStore()
    private let services: AppServices?
    /// Set while a server change is copied in, so it is not saved, announced or pushed back.
    private var isApplyingRemote = false
    nonisolated(unsafe) private var observer: NSObjectProtocol?

    init(services: AppServices? = nil) {
        self.services = services
        value = store.load()
        // Same name as `.criaPreferencesChanged`: this model's own posts carry `self` and are skipped.
        observer = NotificationCenter.default.addObserver(
            forName: .criaSyncedPreferencesApplied, object: nil, queue: .main
        ) { [weak self] note in
            guard let self else { return }
            let sender = (note.object as AnyObject?).map(ObjectIdentifier.init)
            MainActor.assumeIsolated { self.reload(unlessFrom: sender) }
        }
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }

    private func reload(unlessFrom sender: ObjectIdentifier?) {
        guard sender != ObjectIdentifier(self) else { return }
        let stored = store.load()
        guard stored != value else { return }
        isApplyingRemote = true
        value = stored
        isApplyingRemote = false
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
