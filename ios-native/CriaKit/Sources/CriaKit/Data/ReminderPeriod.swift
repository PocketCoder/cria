import Foundation

/// The unit of a relative reminder's offset, as the editor offers it. The raw value is its length in seconds.
public enum ReminderUnit: Int, CaseIterable, Sendable {
    case minutes = 60, hours = 3_600, days = 86_400, weeks = 604_800
}

/// A relative reminder's offset as the editor shows it (an amount, a unit and a direction) and as Vikunja stores it
/// (signed seconds, negative before the date). Reading picks the largest unit that divides the offset evenly, so
/// 172800 s opens as "2 days" and 5400 s as "90 minutes".
public struct ReminderPeriod: Equatable, Sendable {
    public var amount: Int
    public var unit: ReminderUnit
    public var before: Bool

    public init(amount: Int, unit: ReminderUnit, before: Bool) {
        self.amount = amount
        self.unit = unit
        self.before = before
    }

    /// An offset that is not a whole number of minutes is rounded to the nearest minute, the smallest unit offered.
    public init(seconds: Int) {
        let total = abs(seconds)
        let unit = ReminderUnit.allCases.reversed().first { total >= $0.rawValue && total % $0.rawValue == 0 } ?? .minutes
        self.init(amount: Int((Double(total) / Double(unit.rawValue)).rounded()), unit: unit, before: seconds <= 0)
    }

    /// Signed seconds from the date, negative before it. The amount is clamped so a long run of digits cannot overflow.
    public var seconds: Int {
        (before ? -1 : 1) * min(max(amount, 0), 100_000) * unit.rawValue
    }
}
