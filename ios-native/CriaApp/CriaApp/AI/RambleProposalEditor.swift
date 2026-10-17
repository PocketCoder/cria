import CriaKit
import SwiftUI

/// Edits one Ramble proposal before it is added: title, due date, project, priority, labels and notes. Nothing is
/// saved to the database here; Done hands the edited proposal back to the review list.
struct RambleProposalEditor: View {
    let projects: [ProjectRecord]
    let mode: QuickAddMagicMode
    let onSave: (RambleProposal) -> Void
    @State private var proposal: RambleProposal
    @Environment(\.dismiss) private var dismiss

    init(proposal: RambleProposal, projects: [ProjectRecord], mode: QuickAddMagicMode,
         onSave: @escaping (RambleProposal) -> Void) {
        _proposal = State(initialValue: proposal)
        self.projects = projects
        self.mode = mode
        self.onSave = onSave
    }

    private var hasTitle: Bool { !proposal.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    CriaTextField("Title", text: $proposal.title, axis: .vertical)
                }
                Section {
                    DateFieldRow(title: "Due", iso: proposal.dueDate) { proposal.dueDate = $0.isEmpty ? nil : $0 }
                    Picker(selection: $proposal.projectLocalId) {
                        Text("Default project").tag(String?.none)
                        ForEach(projects, id: \.localId) { Text($0.title).tag(Optional($0.localId)) }
                    } label: {
                        Label("Project", systemImage: "folder")
                    }
                    Picker(selection: $proposal.priority) {
                        ForEach(RambleProposal.priorityNames.indices, id: \.self) { Text(RambleProposal.priorityNames[$0]).tag($0) }
                    } label: {
                        Label("Priority", systemImage: "flag")
                    }
                }
                labelSection
                Section("Notes") {
                    CriaTextField("Notes", text: notes, axis: .vertical)
                }
            }
            .criaSurface()
            .navigationTitle("Edit task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", systemImage: "xmark") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", systemImage: "checkmark") {
                        onSave(proposal)
                        dismiss()
                    }
                    .disabled(!hasTitle)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    /// Labels the model added, removable by swipe; a suggestion it only proposed can be applied here.
    @ViewBuilder private var labelSection: some View {
        if !proposal.labelTitles.isEmpty || proposal.suggestion != nil {
            Section("Labels") {
                ForEach(proposal.labelTitles, id: \.self) { title in
                    Label(title, systemImage: "tag")
                }
                .onDelete { proposal.labelTitles.remove(atOffsets: $0) }
                if let suggestion = proposal.suggestion {
                    Button("Use suggestion: \(suggestion)", systemImage: "sparkles") {
                        proposal = Ramble.applyingSuggestion(to: proposal, projects: projects, mode: mode)
                    }
                }
            }
        }
    }

    private var notes: Binding<String> {
        Binding(
            get: { proposal.notes ?? "" },
            set: { proposal.notes = $0.isEmpty ? nil : $0 }
        )
    }
}
