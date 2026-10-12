import CriaKit
import SwiftUI

/// What the sync queue shows for a waiting or a failed change. Wording follows `src/lib/outboxFormat.ts`.
struct OutboxRowSummary {
    let id: Int
    let entity: String
    let op: String
    let attempts: Int
    let error: String?
    /// When the next attempt is due (waiting) or when it gave up (failed).
    let when: String?
    let payload: String
    private let failedAt: String?

    init(_ row: OutboxRow) {
        id = row.id
        entity = row.entityType
        op = row.op
        attempts = row.attempts
        error = row.lastError
        payload = row.payload
        failedAt = nil
        let next = row.nextAttemptAt.flatMap(DueDates.parse)
        when = next.flatMap { $0 > Date() ? "Next attempt \($0.formatted(.relative(presentation: .named)))" : nil }
    }

    init(_ row: DeadLetterRow) {
        id = row.id
        entity = row.entityType
        op = row.op
        attempts = row.attempts
        error = row.lastError
        payload = row.payload
        failedAt = row.failedAt
        when = DueDates.parse(row.failedAt).map { "Failed \($0.formatted(date: .abbreviated, time: .shortened))" }
    }

    var meta: String {
        "#\(id) · \(attempts) attempt\(attempts == 1 ? "" : "s")"
    }

    /// A plain-text block for the clipboard, as `rowToText` writes it.
    var text: String {
        let failed = failedAt.map { " failed=\($0)" } ?? ""
        return [
            "#\(id) \(entity)·\(op) attempts=\(attempts)\(failed)",
            "  error: \(error ?? "(none)")",
            "  payload: \(payload)"
        ].joined(separator: "\n")
    }
}

struct OutboxRowView: View {
    let row: OutboxRowSummary
    /// The queue's head, or a failed change: its error is the one that matters.
    let highlight: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text("\(row.entity) · \(row.op)")
                    .font(Theme.caption.monospaced().weight(.medium))
                Spacer(minLength: 8)
                Text(row.meta)
                    .font(Theme.footnote)
                    .foregroundStyle(Color(.mutedForeground))
            }
            if let error = row.error, !error.isEmpty {
                Text(error)
                    .font(Theme.caption)
                    .foregroundStyle(highlight ? Color(.warningText) : Color(.foreground))
                    .lineLimit(4)
            } else {
                Text("No error reported yet.")
                    .font(Theme.caption)
                    .foregroundStyle(Color(.mutedForeground))
            }
            if let when = row.when {
                Text(when)
                    .font(Theme.footnote)
                    .foregroundStyle(Color(.mutedForeground))
            }
        }
        .padding(.vertical, 2)
    }
}
