import CriaKit
import SwiftUI

enum ProjectEditorTarget: Identifiable {
    case create
    case edit(ProjectRecord)

    var id: String {
        switch self {
        case .create: return "create"
        case .edit(let project): return project.localId
        }
    }
}

/// The colours offered by the project editor (`PROJECT_COLORS` in `sidebarLogic.ts`).
private let projectColours = [
    "ef4444", "f97316", "eab308", "22c55e", "06b6d4", "3b82f6", "8b5cf6", "ec4899", "78716c", "000000"
]

struct ProjectEditorSheet: View {
    let services: AppServices
    let target: ProjectEditorTarget
    let projects: [ProjectRecord]
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var details = ""
    @State private var colour: String?
    @State private var parent: String?
    @State private var isArchived = false
    @State private var errorMessage: String?

    private var editing: ProjectRecord? {
        if case .edit(let project) = target { return project }
        return nil
    }

    /// Parents offered: not the project itself or anything beneath it.
    private var parentChoices: [ProjectRecord] {
        guard let editing else { return projects }
        let banned = ProjectTree.descendantIds(of: editing.localId, in: projects).union([editing.localId])
        return projects.filter { !banned.contains($0.localId) }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Title", text: $title)
                    TextField("Description", text: $details, axis: .vertical)
                }
                Section("Colour") {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack {
                            swatch(nil)
                            ForEach(projectColours, id: \.self) { swatch($0) }
                        }
                    }
                }
                Section("Parent project") {
                    Picker("Parent", selection: $parent) {
                        Text("None").tag(String?.none)
                        ForEach(parentChoices, id: \.localId) { project in
                            Text(project.title).tag(Optional(project.localId))
                        }
                    }
                }
                if editing != nil {
                    Section { Toggle("Archived", isOn: $isArchived) }
                }
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(Color(.destructive)) }
                }
            }
            .navigationTitle(editing == nil ? "New project" : "Edit project")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: save)
                        .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .onAppear(perform: load)
        }
    }

    private func swatch(_ hex: String?) -> some View {
        Button {
            colour = hex
        } label: {
            Circle()
                .fill(Color(hexString: hex) ?? Color(.muted))
                .frame(width: 28, height: 28)
                .overlay(Circle().stroke(Color(.primary), lineWidth: colour == hex ? 3 : 0))
                .overlay { if hex == nil { Image(systemName: "slash.circle").font(.caption) } }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(hex ?? "No colour")
    }

    private func load() {
        guard let editing else { return }
        title = editing.title
        details = editing.description ?? ""
        colour = editing.hexColor
        parent = editing.parentLocalId
        isArchived = editing.isArchived
    }

    private func save() {
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let note = details.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            if let editing {
                var patch = ProjectPatch(title: name, isArchived: isArchived)
                patch.description = .set(note.isEmpty ? nil : note)
                patch.hexColor = .set(colour)
                patch.parentLocalId = .set(parent)
                try services.store.updateProject(localId: editing.localId, patch: patch)
            } else {
                try services.store.createProject(ProjectInput(
                    title: name, description: note.isEmpty ? nil : note, parentLocalId: parent, hexColor: colour
                ))
            }
            dismiss()
        } catch {
            errorMessage = String(describing: error)
        }
    }
}
