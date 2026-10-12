import CriaKit
import Observation
import SwiftUI

/// Unresolved conflicts and whether the sheet is up. An unresolved conflict holds that task's pushes, so the sheet
/// opens by itself when one appears; once the user closes it with conflicts left, it stays closed for the session
/// and `SyncBanner` offers to reopen it. Mirrors `ConflictModal.tsx`.
@MainActor @Observable
final class ConflictPrompt {
    private(set) var conflicts: [ConflictRecord] = []
    var isPresented = false
    /// True while the sheet is on screen. `isPresented` can be true without it when another sheet was up.
    private(set) var isShowing = false
    private var dismissedThisSession = false

    /// Conflicts recorded by a pull are silent, so this also rereads after task, project and label changes (a pull's
    /// end announces them).
    func run(store: CriaStore) async {
        let stream = observeStore(store, kinds: [.conflicts, .tasks, .projects, .labels, .outbox]) { try $0.unresolvedConflicts() }
        for await list in stream {
            conflicts = list
            if !list.isEmpty, !dismissedThisSession, !isPresented { isPresented = true }
        }
    }

    func sheetAppeared() {
        isShowing = true
    }

    func sheetDismissed() {
        isShowing = false
        isPresented = false
        if !conflicts.isEmpty { dismissedThisSession = true }
    }

    /// From the banner. A presentation that never showed (another sheet was up) is reset first.
    func open() {
        guard !isShowing else { return }
        guard isPresented else {
            isPresented = true
            return
        }
        isPresented = false
        Task { @MainActor in self.isPresented = true }
    }
}

/// One section per conflict: the whole task side by side, "Yours" (as on this device now) and "Server", with the rows
/// that differ highlighted, and a choice of one side. Projects and labels list the fields that differ.
struct ConflictSheet: View {
    let services: AppServices
    let prompt: ConflictPrompt
    @Environment(\.dismiss) private var dismiss
    @State private var failure: String?

    var body: some View {
        NavigationStack {
            List {
                ForEach(prompt.conflicts, id: \.id) { conflict in
                    ConflictSection(
                        conflict: conflict,
                        current: currentTask(conflict),
                        diff: (try? services.store.conflictDiff(conflict)) ?? conflict.diff,
                        currentName: currentName(conflict),
                        onKeepMine: { resolve { try services.store.resolveConflictKeepMine(id: conflict.id) } },
                        onUseTheirs: { resolve { try services.store.resolveConflictUseTheirs(id: conflict.id) } }
                    )
                }
            }
            .overlay {
                if prompt.conflicts.isEmpty {
                    ContentUnavailableView("Nothing to resolve", systemImage: "checkmark.circle",
                                           description: Text("Your local edits are in sync."))
                }
            }
            .navigationTitle("Changed in two places")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Later") { dismiss() }
                }
            }
            .alert("Could not resolve the conflict", isPresented: Binding(
                get: { failure != nil },
                set: { if !$0 { failure = nil } }
            )) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(failure ?? "")
            }
        }
        .onAppear { prompt.sheetAppeared() }
        .onChange(of: prompt.conflicts.isEmpty) { _, isEmpty in
            if isEmpty { dismiss() }
        }
    }

    private func currentTask(_ conflict: ConflictRecord) -> TaskRecord? {
        guard conflict.entityType == "task" else { return nil }
        return try? services.store.task(localId: conflict.entityLocalId)
    }

    /// A project's or label's name as it is on this device (the snapshot holds the last-synced one).
    private func currentName(_ conflict: ConflictRecord) -> String? {
        switch conflict.entityType {
        case "project": (try? services.store.project(localId: conflict.entityLocalId))?.title
        case "label": (try? services.store.labels())?.first { $0.localId == conflict.entityLocalId }?.title
        default: nil
        }
    }

    private func resolve(_ action: () throws -> Void) {
        do {
            try action()
        } catch {
            failure = String(describing: error)
        }
    }
}

private struct ConflictSection: View {
    let conflict: ConflictRecord
    /// The task as it is on this device now (`localSnapshot` is the last-synced server copy, not the edit).
    let current: TaskRecord?
    /// Per-field rows for projects and labels, with "Yours" as on this device now (`CriaStore.conflictDiff`).
    let diff: [ConflictFieldDiff]
    let currentName: String?
    let onKeepMine: () -> Void
    let onUseTheirs: () -> Void
    @Environment(\.dateDisplay) private var dateDisplay
    @ScaledMetric(relativeTo: .footnote) private var labelWidth: CGFloat = 76

    /// Projects and labels keep the per-field diff; only tasks are shown whole.
    private var yours: ConflictTaskSide? {
        guard conflict.entityType == "task" else { return nil }
        return current.map(ConflictTaskSide.init(task:)) ?? ConflictTaskSide(json: conflict.localSnapshot)
    }

    private var server: ConflictTaskSide? {
        conflict.entityType == "task" ? ConflictTaskSide(json: conflict.remoteSnapshot) : nil
    }

    var body: some View {
        Section {
            Text(intro)
                .font(Theme.rowSubtitle)
                .foregroundStyle(Color(.mutedForeground))
            if let yours = yours, let server = server {
                columns(label: "", yours: Text("Yours"), server: Text("Server"))
                    .font(Theme.caption.weight(.semibold))
                    .foregroundStyle(Color(.mutedForeground))
                ForEach(ConflictField.allCases) { field in
                    fieldRow(field, yours: yours, server: server)
                }
            } else {
                ForEach(diff, id: \.field) { diff in
                    columns(label: diff.label, yours: Text(diff.local), server: Text(diff.remote))
                }
            }
            HStack {
                Button("Keep mine", action: onKeepMine)
                    .buttonStyle(.borderedProminent)
                Button("Use theirs", action: onUseTheirs)
                    .buttonStyle(.bordered)
            }
            .frame(maxWidth: .infinity)
        } header: {
            Text(title ?? noun.capitalized)
        } footer: {
            Text("Highlighted rows differ. Found \(found).")
        }
    }

    private func fieldRow(_ field: ConflictField, yours: ConflictTaskSide, server: ConflictTaskSide) -> some View {
        let differs = !yours.matches(server, on: field)
        let mine = yours.text(field, display: dateDisplay)
        let theirs = server.text(field, display: dateDisplay)
        return columns(
            label: field.label,
            yours: value(mine, swatch: field == .colour ? yours.swatch : nil),
            server: value(theirs, swatch: field == .colour ? server.swatch : nil)
        )
        .fontWeight(differs ? .semibold : .regular)
        .listRowBackground(differs ? Color(.warning).opacity(0.16) : nil)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(field.label): yours \(mine), server \(theirs)\(differs ? ", differs" : "")")
    }

    private func value(_ text: String, swatch: Color?) -> Text {
        guard let swatch else { return Text(text) }
        return Text(Image(systemName: "circle.fill")).foregroundStyle(swatch) + Text(" " + text)
    }

    private func columns(label: String, yours: Text, server: Text) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(label)
                .font(Theme.caption)
                .foregroundStyle(Color(.mutedForeground))
                .frame(width: labelWidth, alignment: .leading)
            yours.frame(maxWidth: .infinity, alignment: .leading)
            server.frame(maxWidth: .infinity, alignment: .leading)
        }
        .font(Theme.rowSubtitle)
        .lineLimit(4)
    }

    /// The title as it is on this device.
    private var title: String? {
        let object = try? JSONSerialization.jsonObject(with: Data(conflict.localSnapshot.utf8)) as? [String: Any]
        let text = (yours?.title ?? currentName ?? (object?["title"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? nil : text
    }

    private var intro: AttributedString {
        var name = AttributedString(title ?? "this \(noun)")
        if title != nil { name.font = Theme.rowSubtitle.weight(.semibold) }
        return AttributedString("You edited ") + name + AttributedString(" offline while the server also changed it. Keep one.")
    }

    /// "task", "project" or "label", for the header and intro.
    private var noun: String {
        switch conflict.entityType {
        case "project", "label": conflict.entityType
        default: "task"
        }
    }

    private var found: String {
        guard let date = DueDates.parse(conflict.detectedAt) else { return conflict.detectedAt }
        return DueDates.fullLabel(date, display: dateDisplay)
    }
}
