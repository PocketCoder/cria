import CriaKit
import SwiftUI

/// Turn a spoken or typed ramble into tasks. The model writes quick-add lines in the user's Quick Add Magic mode;
/// the user reviews them, then each becomes a task through the usual quick-add parser.
struct RambleSheet: View {
    let services: AppServices
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var drafts: [RambleDraft] = []
    @State private var working = false
    @State private var errorMessage: String?

    private var mode: QuickAddMagicMode {
        QuickAddMagicMode(rawValue: UserDefaults.standard.string(forKey: QuickAddStorage.key) ?? "") ?? .default
    }

    private var chosen: [RambleDraft] { Ramble.chosen(drafts, mode: mode) }

    var body: some View {
        NavigationStack {
            Form {
                if drafts.isEmpty {
                    inputSection
                } else {
                    reviewSection
                }
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(Color(.destructive)) }
                }
            }
            .criaSurface()
            .navigationTitle("Ramble")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                if !drafts.isEmpty {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Add \(Ramble.taskCount(chosen.count))") { save() }.disabled(chosen.isEmpty)
                    }
                }
            }
        }
    }

    private var inputSection: some View {
        Section {
            TextEditor(text: $text).frame(minHeight: 160)
            Button(working ? "Organising…" : "Make a task list") { Task { await generate() } }
                .disabled(working || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        } footer: {
            Text("Type or dictate everything on your mind. Dates stay in words and are resolved when the tasks are added.")
        }
    }

    private var reviewSection: some View {
        Section("Review") {
            ForEach($drafts) { $draft in
                VStack(alignment: .leading, spacing: 4) {
                    Toggle(isOn: $draft.include) {
                        TextField("Task", text: $draft.line)
                    }
                    if let notes = draft.notes {
                        Text(notes).font(Theme.caption).foregroundStyle(Color(.mutedForeground))
                    }
                    if let suggestion = draft.suggestion {
                        Text("Suggested: \(suggestion)").font(Theme.caption).foregroundStyle(Color(.mutedForeground))
                    }
                }
            }
            Button("Start over", role: .destructive) { drafts = [] }
        }
    }

    private func generate() async {
        working = true
        defer { working = false }
        do {
            let store = services.store
            let projects = try store.projects().map(\.title)
            let labels = try store.labels().map(\.title)
            let context = AIPrompts.RambleContext(projects: projects, labels: labels, mode: mode)
            drafts = try await AIStatus.shared.features.ramble(text, context: context)
            errorMessage = drafts.isEmpty ? "The model found no tasks in that." : nil
        } catch {
            errorMessage = AIPrompts.errorMessage(String(describing: error))
        }
    }

    private func save() {
        do {
            let store = services.store
            let projects = try store.projects()
            guard let fallback = projects.first?.localId else {
                errorMessage = "Create a project first."
                return
            }
            for draft in chosen {
                try store.createFromQuickAdd(
                    line: draft.line, projects: projects, fallbackProjectId: fallback, mode: mode, notes: draft.notes
                )
            }
            dismiss()
        } catch {
            errorMessage = String(describing: error)
        }
    }
}
