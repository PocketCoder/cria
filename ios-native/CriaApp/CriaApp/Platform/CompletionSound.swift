import AudioToolbox
import CriaKit
import SwiftUI

/// "Play sound when a task is completed" (Settings > Appearance). A system sound, so the silent switch mutes it.
/// The tone is chosen in Settings > Appearance.
enum CompletionSound {
    static func play(_ tone: CompletionTone = .tink) {
        AudioServicesPlaySystemSound(soundID(tone))
    }

    /// Built-in iOS alert sounds.
    private static func soundID(_ tone: CompletionTone) -> SystemSoundID {
        switch tone {
        case .tink: return 1057
        case .tweet: return 1016
        case .bloom: return 1021
        case .calypso: return 1022
        case .fanfare: return 1025
        case .spell: return 1031
        }
    }
}

private struct DateDisplayKey: EnvironmentKey {
    static let defaultValue = DateDisplay.standard
}

private struct CompletionSoundKey: EnvironmentKey {
    static let defaultValue = false
}

private struct PreferencesKey: EnvironmentKey {
    static let defaultValue = LocalPreferences.default
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

    /// Every preference, for screens that read one with no key of its own (the task screen's section order).
    var preferences: LocalPreferences {
        get { self[PreferencesKey.self] }
        set { self[PreferencesKey.self] = newValue }
    }
}
