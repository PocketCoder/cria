import CriaKit
import Foundation

/// Server timestamps in Settings screens, shown in the user's chosen date and time style (`\.dateDisplay`).
enum SettingsDate {
    /// "11 Oct 2026 14:30" for an ISO timestamp; the raw text when it does not parse.
    static func label(_ stamp: String, display: DateDisplay) -> String {
        SessionDates.parse(stamp).map { DueDates.fullLabel($0, display: display) } ?? stamp
    }
}
