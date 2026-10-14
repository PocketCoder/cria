import Foundation

/// A time of day after "at" or "before": "9", "9am", "9:30 pm", "17:45".
private let timeOfDay = #"\d{1,2}(?::\d{2})?\s?(?:am|pm)?"#

/// "remind day before", "remind me the day before at 9am", "remind 2 days before 8pm", "remind 1 hour before",
/// "remind at 5pm". Capture group 1 is the whole phrase.
let reminderPhrasePattern = #"(?:^|\s)(remind(?:\s+me)?\s+(?:(?:(?:the|a|an|\d{1,3})\s+)?"#
    + #"(?:min(?:ute)?s?|hours?|days?|weeks?)\s+before(?:\s+(?:at\s+)?"# + timeOfDay + #")?"#
    + #"|at\s+"# + timeOfDay + #"))(?=\s|$)"#

/// The reminder a matched phrase asks for, or nil when its numbers make no sense ("at 25", "0 days before").
/// Day and week spans fire at a time of day (the one given, else Settings' day reminder time); minute and hour spans
/// are a plain offset from the due time.
func parseReminderPhrase(_ phrase: String) -> QuickAddReminder? {
    let text = phrase.lowercased()
    let parts = text.components(separatedBy: "before")
    let timeText = parts.count > 1 ? parts[1] : text.components(separatedBy: " at ").last ?? ""
    let minute = parseTimeOfDay(timeText)
    guard parts.count > 1 else { return minute.map { .atTimeOfDay(minute: $0) } }
    if !parts[1].trimmingCharacters(in: .whitespaces).isEmpty && minute == nil { return nil }
    let words = parts[0].split(whereSeparator: \.isWhitespace).map(String.init).filter { $0 != "remind" && $0 != "me" }
    guard let unit = words.last else { return nil }
    let amount = words.count > 1 ? Int(words[words.count - 2]) ?? 1 : 1
    guard amount > 0 else { return nil }
    switch unit.hasSuffix("s") ? String(unit.dropLast()) : unit {
    case "min", "minute": return .beforeDue(seconds: amount * 60)
    case "hour": return .beforeDue(seconds: amount * 3_600)
    case "day": return .daysBeforeDue(days: amount, minute: minute)
    case "week": return .daysBeforeDue(days: amount * 7, minute: minute)
    default: return nil
    }
}

/// Minutes after midnight for "9", "9am", "12am", "9:30 pm" or "17:45" (with or without a leading "at").
func parseTimeOfDay(_ raw: String) -> Int? {
    let text = raw.lowercased().replacingOccurrences(of: "at", with: "").trimmingCharacters(in: .whitespaces)
    guard let regex = RegexCache.regex(#"^(\d{1,2})(?::(\d{2}))?\s?(am|pm)?$"#),
          let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
          let hourRange = Range(match.range(at: 1), in: text), var hour = Int(text[hourRange]) else { return nil }
    let minute = Range(match.range(at: 2), in: text).flatMap { Int(text[$0]) } ?? 0
    guard minute < 60 else { return nil }
    if let suffixRange = Range(match.range(at: 3), in: text) {
        guard (1...12).contains(hour) else { return nil }
        hour = hour % 12 + (text[suffixRange] == "pm" ? 12 : 0)
    }
    guard hour < 24 else { return nil }
    return hour * 60 + minute
}
