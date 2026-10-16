import AudioToolbox
import CriaKit
import SwiftUI
#if os(macOS)
import AppKit
#endif

/// "Play sound when a task is completed" (Settings > Appearance). A system sound, so the silent switch mutes it.
/// The tone is chosen in Settings > Appearance.
enum CompletionSound {
    static func play(_ tone: CompletionTone = .tink) {
        #if os(macOS)
        NSSound(named: macSoundName(tone))?.play()
        #else
        AudioServicesPlaySystemSound(soundID(tone))
        #endif
    }

    #if os(macOS)
    /// The iOS alert sound IDs do not exist on the Mac: the nearest of its built-in sounds for each tone.
    private static func macSoundName(_ tone: CompletionTone) -> NSSound.Name {
        switch tone {
        case .tink: return "Tink"
        case .tweet: return "Pop"
        case .bloom: return "Glass"
        case .calypso: return "Ping"
        case .fanfare: return "Hero"
        case .spell: return "Purr"
        }
    }
    #endif

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
