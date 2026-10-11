import AudioToolbox
import SwiftUI

/// "Play sound when a task is completed" (Settings > Appearance). A system sound, so the silent switch mutes it.
enum CompletionSound {
    private static let tink: SystemSoundID = 1057

    static func play() {
        AudioServicesPlaySystemSound(tink)
    }
}

private struct DateDisplayKey: EnvironmentKey {
    static let defaultValue = DateDisplay.standard
}

private struct CompletionSoundKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    /// Date and time style from Settings; read by task rows, Kanban cards, the table and reminders.
    var dateDisplay: DateDisplay {
        get { self[DateDisplayKey.self] }
        set { self[DateDisplayKey.self] = newValue }
    }

    /// Whether completing a task plays a sound; read by `PriorityCheck`.
    var playsCompletionSound: Bool {
        get { self[CompletionSoundKey.self] }
        set { self[CompletionSoundKey.self] = newValue }
    }
}
