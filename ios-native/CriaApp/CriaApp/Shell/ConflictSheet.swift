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

    /// Conflicts recorded by a pull are silent, so this also rereads after task changes (a pull's end announces them).
    func run(store: CriaStore) async {
        let stream = observeStore(store, kinds: [.conflicts, .tasks, .outbox]) { try $0.unresolvedConflicts() }
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

/// One section per conflict: the task, then each field as "Yours" and "Server", and a choice of one side.
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
    let onKeepMine: () -> Void
    let onUseTheirs: () -> Void

    var body: some View {
        Section {
            Text(intro)
                .font(Theme.rowSubtitle)
                .foregroundStyle(Color(.mutedForeground))
            ForEach(conflict.diff, id: \.field) { diff in
                VStack(alignment: .leading, spacing: 4) {
                    Text(diff.label).font(Theme.caption.weight(.semibold))
                    LabeledContent("Yours", value: diff.local)
                    LabeledContent("Server", value: diff.remote)
                }
                .lineLimit(3)
            }
            HStack {
                Button("Keep mine", action: onKeepMine)
                    .buttonStyle(.borderedProminent)
                Button("Use theirs", action: onUseTheirs)
                    .buttonStyle(.bordered)
            }
            .frame(maxWidth: .infinity)
        } header: {
            Text(title ?? "Task")
        } footer: {
            Text("Found \(found)")
        }
    }

    /// The task's title as it was on this device.
    private var title: String? {
        let object = try? JSONSerialization.jsonObject(with: Data(conflict.localSnapshot.utf8)) as? [String: Any]
        let text = (object?["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        return text?.isEmpty == false ? text : nil
    }

    private var intro: AttributedString {
        var name = AttributedString(title ?? "this task")
        if title != nil { name.font = Theme.rowSubtitle.weight(.semibold) }
        return AttributedString("You edited ") + name + AttributedString(" offline while the server also changed it. Keep one.")
    }

    private var found: String {
        guard let date = DueDates.parse(conflict.detectedAt) else { return conflict.detectedAt }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}
