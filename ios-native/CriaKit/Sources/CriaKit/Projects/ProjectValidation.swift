import Foundation
import GRDB

/// Why a project edit was refused before it was queued. Each one mirrors a check the Vikunja server makes, so the
/// user hears about it now instead of from a push that fails later.
public enum ProjectValidationError: Error, Equatable, CustomStringConvertible, Sendable {
    case identifierTooLong
    case identifierNotUnique(String)
    case parentIsSelf
    case parentIsDescendant
    case parentArchived

    public var description: String {
        switch self {
        case .identifierTooLong:
            return "The identifier can be at most \(ProjectIdentifier.maxLength) characters."
        case .identifierNotUnique(let identifier):
            return "Another project already uses the identifier \(identifier). Identifiers must be unique."
        case .parentIsSelf:
            return "A project cannot be its own parent."
        case .parentIsDescendant:
            return "A project cannot be placed under one of its own sub-projects."
        case .parentArchived:
            return "An archived project cannot be a parent. Unarchive it first."
        }
    }
}

/// The short code that prefixes task identifiers (`PROJ-12`). Upstream (`pkg/models/project.go`) allows at most
/// 10 characters, stores it uppercase and requires it to be unique across projects; empty means none.
public enum ProjectIdentifier {
    public static let maxLength = 10

    /// Trimmed and uppercased, as the server stores it; nil for an empty one.
    public static func normalised(_ raw: String?) -> String? {
        let text = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        return text.isEmpty ? nil : text
    }

    /// The first problem with `raw`, or nil when it is fine (or empty). `projects` is every known project; the one
    /// being edited is passed as `localId` so it does not clash with itself.
    public static func problem(_ raw: String?, among projects: [ProjectRecord], excluding localId: String?) -> ProjectValidationError? {
        guard let identifier = normalised(raw) else { return nil }
        // The server counts runes, not bytes.
        if identifier.unicodeScalars.count > maxLength { return .identifierTooLong }
        let taken = projects.contains { $0.localId != localId && normalised($0.identifier) == identifier }
        return taken ? .identifierNotUnique(identifier) : nil
    }
}

extension ProjectTree {
    /// Projects that may become the parent of `localId` (nil for a project not created yet): not itself, not anything
    /// beneath it (that would be a cycle), and not archived, which the server refuses. `keeping` stays in the list so
    /// a project already under an archived parent still shows its current one.
    public static func validParents(
        for localId: String?, in projects: [ProjectRecord], keeping current: String? = nil
    ) -> [ProjectRecord] {
        let banned = localId.map { descendantIds(of: $0, in: projects).union([$0]) } ?? []
        return projects.filter { project in
            if project.localId == current { return !banned.contains(project.localId) }
            return !banned.contains(project.localId) && !project.isArchived
        }
    }
}

extension CriaStore {
    /// Checks a create (`existing` nil) or an edit before it is written. A parent only has to be unarchived when it
    /// changes or the project itself is being unarchived, as on the server; an untouched archived parent is left.
    static func validateProject(
        _ connection: Database, existing: ProjectRecord?, identifier: FieldChange<String>,
        parent: FieldChange<String>, unarchiving: Bool
    ) throws {
        let all = try Row.fetchAll(
            connection, sql: "SELECT \(projectColumns) FROM projects WHERE deleted = 0"
        ).map(ProjectRecord.init(row:))
        if case .set(let raw) = identifier, let problem = ProjectIdentifier.problem(raw, among: all, excluding: existing?.localId) {
            throw problem
        }
        let target: String?
        if case .set(let newParent) = parent { target = newParent } else { target = existing?.parentLocalId }
        guard let target else { return }
        if let existing, case .set = parent {
            if target == existing.localId { throw ProjectValidationError.parentIsSelf }
            if ProjectTree.descendantIds(of: existing.localId, in: all).contains(target) {
                throw ProjectValidationError.parentIsDescendant
            }
        }
        let changed = target != existing?.parentLocalId
        if changed || unarchiving, all.first(where: { $0.localId == target })?.isArchived == true {
            throw ProjectValidationError.parentArchived
        }
    }
}
