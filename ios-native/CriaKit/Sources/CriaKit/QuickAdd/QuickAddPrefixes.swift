import Foundation

/// Quick Add Magic prefix modes, mirroring Vikunja-web's `PrefixMode`. Ported from `src/lib/quickAddPrefixes.ts`.
/// The mode is stored in `settings.frontend_settings.quick_add_magic_mode`.
public enum QuickAddMagicMode: String, CaseIterable, Sendable {
    case disabled, vikunja, todoist

    /// Vikunja-web's default.
    public static let `default` = QuickAddMagicMode.vikunja

    /// Nil for `disabled`: no symbol parsing at all.
    public var prefixes: QuickAddPrefixes? {
        switch self {
        case .disabled: return nil
        case .vikunja: return QuickAddPrefixes(label: "*", project: "+", assignee: "@", priority: "!")
        case .todoist: return QuickAddPrefixes(label: "@", project: "#", assignee: "+", priority: "!")
        }
    }
}

public struct QuickAddPrefixes: Equatable, Sendable {
    public let label: String
    public let project: String
    public let assignee: String
    public let priority: String
}
