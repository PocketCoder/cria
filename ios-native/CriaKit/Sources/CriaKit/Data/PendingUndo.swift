import Foundation

/// Undo steps for actions taken where there is no toast to show them: the menu bar extra, and a notification action
/// that ran while the app was in the background. The action saves its step here; the shell picks it up (when it
/// next appears or becomes active) and shows the usual Undo toast. A step older than `lifetime` is dropped, since
/// by then Undo would surprise more than help.
public enum PendingUndo {
    public static let lifetime: TimeInterval = 120
    static let key = "cria.pendingUndo"

    private struct Stored: Codable {
        var step: TaskUndoStep
        var savedAt: Date
    }

    public static func save(_ step: TaskUndoStep, defaults: UserDefaults = .standard, now: Date = Date()) {
        guard !step.isEmpty else { return }
        var all = load(defaults).filter { now.timeIntervalSince($0.savedAt) <= lifetime }
        all.append(Stored(step: step, savedAt: now))
        if let data = try? JSONEncoder().encode(all) { defaults.set(data, forKey: key) }
    }

    /// The saved steps that have not expired, oldest first. They are cleared.
    public static func take(defaults: UserDefaults = .standard, now: Date = Date()) -> [TaskUndoStep] {
        let all = load(defaults)
        defaults.removeObject(forKey: key)
        return all.filter { now.timeIntervalSince($0.savedAt) <= lifetime }.map(\.step)
    }

    private static func load(_ defaults: UserDefaults) -> [Stored] {
        guard let data = defaults.data(forKey: key) else { return [] }
        return (try? JSONDecoder().decode([Stored].self, from: data)) ?? []
    }
}
