import CriaKit
import SwiftUI

/// "Suggest subtasks": the on-device model breaks a task into steps, read from its title and notes, and the user
/// edits and ticks the ones to keep. Add creates each ticked line as a subtask through the same store call as
/// "Add subtask". Suggestions that repeat the task or one of its subtasks are left out.
struct SubtaskSuggestionsSheet: View {
    let services: AppServices
    let taskLocalId: String
    /// Titles of the current subtasks, skipped from the suggestions.
    let existing: [String]
    @Environment(\.dismiss) private var dismiss
    @State private var suggestions: [Suggestion] = []
    /// True from the start: the sheet asks the model as it opens, so it shows progress rather than "Try again".
    @State private var working = true
    @State private var errorMessage: String?

    struct Suggestion: Identifiable {
        let id = UUID()
        var title: String
        var include = true
    }

    private var chosen: [Suggestion] {
        suggestions.filter { $0.include && !$0.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    var body: some View { sheetContent.macSheetFrame() }

    @ViewBuilder private var sheetContent: some View {
        NavigationStack {
            List {
                if suggestions.isEmpty {
                    placeholder
                } else {
                    suggestionRows
                }
            }
            .criaSurface()
            .navigationTitle("Suggested subtasks")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbar }
            .task { if suggestions.isEmpty { await suggest() } }
        }
        .presentationDetents([.medium, .large])
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel", systemImage: "xmark") { dismiss() } }
        if !suggestions.isEmpty {
            ToolbarItem(placement: .confirmationAction) {
                Button("Add \(chosen.count)", systemImage: "checkmark") { add() }
                    .disabled(working || chosen.isEmpty)
                    .modifier(CriaProminentToolbarButton())
            }
        }
    }

    @ViewBuilder private var placeholder: some View {
        Section {
            if working {
                HStack(spacing: 12) {
                    ProgressView()
                    Text("Thinking…").foregroundStyle(Color(.mutedForeground))
                }
            } else {
                if let errorMessage {
                    Text(errorMessage).foregroundStyle(Color(.destructive))
                }
                Button("Try again", systemImage: "sparkles") { Task { await suggest() } }
            }
        }
    }

    private var suggestionRows: some View {
        Section {
            ForEach($suggestions) { $suggestion in
                HStack(spacing: 12) {
                    Button {
                        suggestion.include.toggle()
                    } label: {
                        Image(systemName: suggestion.include ? "checkmark.circle.fill" : "circle")
                            .font(.system(size: 22))
                            .foregroundStyle(suggestion.include ? Color(.primary) : Color(.mutedForeground))
                            .frame(minWidth: 28, minHeight: 28)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(suggestion.include ? "Included" : "Excluded")
                    TextField("Subtask", text: $suggestion.title)
                        .strikethrough(!suggestion.include)
                        .opacity(suggestion.include ? 1 : 0.5)
                }
            }
            .onDelete { suggestions.remove(atOffsets: $0) }
        } header: {
            Text("Tick the ones to keep · tap one to edit")
        } footer: {
            if let errorMessage {
                Text(errorMessage).foregroundStyle(Color(.destructive))
            }
        }
    }

    private func suggest() async {
        working = true
        errorMessage = nil
        defer { working = false }
        do {
            guard let task = try services.store.task(localId: taskLocalId) else {
                errorMessage = "This task no longer exists."
                return
            }
            let lines = try await AIStatus.shared.features.subtasks(
                title: task.title, descriptionHtml: task.description, existing: existing
            )
            suggestions = lines.map { Suggestion(title: $0) }
            if lines.isEmpty { errorMessage = "No subtasks suggested. Try adding some notes first." }
        } catch {
            errorMessage = AIPrompts.errorMessage(String(describing: error))
        }
    }

    /// Creates the ticked lines in order. Each one is dropped from the list once it exists, so after a failure the
    /// list holds only what is left and Add can be pressed again without making duplicates.
    private func add() {
        let batch = chosen
        var added = 0
        for suggestion in batch {
            do {
                try services.store.createSubtask(parentLocalId: taskLocalId, title: suggestion.title)
                suggestions.removeAll { $0.id == suggestion.id }
                added += 1
            } catch {
                let done = added > 0 ? "Added \(added) of \(batch.count). " : ""
                errorMessage = done + "Could not add the subtask: \(error)"
                return
            }
        }
        dismiss()
    }
}
