import CriaKit
import SwiftUI

enum ProjectEditorTarget: Identifiable {
    case create
    /// A new project with its parent already chosen (the parent's local id).
    case createChild(parent: String)
    case edit(ProjectRecord)

    var id: String {
        switch self {
        case .create: return "create"
        case .createChild(let parent): return "create-in-\(parent)"
        case .edit(let project): return project.localId
        }
    }
}

/// The colours offered by the project editor (`PROJECT_COLORS` in `sidebarLogic.ts`).
private let projectColours = [
    "ef4444", "f97316", "eab308", "22c55e", "06b6d4", "3b82f6", "8b5cf6", "ec4899", "78716c", "000000"
]

/// Spoken names for the swatches, in the same order, so VoiceOver does not read out raw hex.
private let projectColourNames = ["Red", "Orange", "Yellow", "Green", "Cyan", "Blue", "Purple", "Pink", "Grey", "Black"]

struct ProjectEditorSheet: View {
    let services: AppServices
    let target: ProjectEditorTarget
    let projects: [ProjectRecord]
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var details = ""
    @State private var colour: String?
    /// Counts swatch taps, for the selection haptic.
    @State private var swatchPicks = 0
    @State private var identifier = ""
    @State private var parent: String?
    @State private var isArchived = false
    @State private var errorMessage: String?

    private var editing: ProjectRecord? {
        if case .edit(let project) = target { return project }
        return nil
    }

    /// Parents offered: not the project itself or anything beneath it (a cycle), and not an archived project, which
    /// Vikunja refuses. A current parent stays listed so the picker can show it.
    private var parentChoices: [ProjectRecord] {
        ProjectTree.validParents(for: editing?.localId, in: projects, keeping: parent)
    }

    /// What is wrong with the identifier, if anything. One the project already has is not checked again, so an old
    /// value never blocks an unrelated edit.
    private var identifierProblem: ProjectValidationError? {
        identifierChanged ? ProjectIdentifier.problem(identifier, among: projects, excluding: editing?.localId) : nil
    }

    private var identifierChanged: Bool {
        guard let editing else { return true }
        return ProjectIdentifier.normalised(identifier) != ProjectIdentifier.normalised(editing.identifier)
    }

    private var navigationTitle: String {
        if editing != nil { return "Edit project" }
        if case .createChild = target { return "New sub-project" }
        return "New project"
    }

    var body: some View { sheetContent.macSheetFrame() }

    @ViewBuilder private var sheetContent: some View {
        NavigationStack {
            Form {
                Section {
                    CriaTextField("Title", text: $title)
                    CriaTextField("Description", text: $details, axis: .vertical)
                }
                identifierSection
                Section("Colour") {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack {
                            swatch(nil)
                            ForEach(projectColours, id: \.self) { swatch($0) }
                        }
                    }
                    .sensoryFeedback(.selection, trigger: swatchPicks)
                }
                Section("Parent project") {
                    Picker("Parent", selection: $parent) {
                        Text("None").tag(String?.none)
                        ForEach(parentChoices, id: \.localId) { project in
                            Text(project.title).tag(Optional(project.localId))
                        }
                    }
                }
                if let editing {
                    Section {
                        // Online and applied at once, unlike the fields above, which wait for Save.
                        NavigationLink {
                            ProjectBackgroundView(services: services, project: editing)
                        } label: {
                            Label("Background", systemImage: "photo")
                        }
                    }
                    Section { Toggle("Archived", isOn: $isArchived) }
                }
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(Color(.destructive)) }
                }
            }
                .criaSurface()
            .navigationTitle(navigationTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: save)
                        .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || identifierProblem != nil)
                }
            }
            .onAppear(perform: load)
        }
    }

    /// The task-number prefix (`PROJ-12`). Vikunja keeps it uppercase, at most 10 characters, unique across projects.
    private var identifierSection: some View {
        Section {
            CriaTextField("Identifier", text: $identifier)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .onChange(of: identifier) { _, new in
                    // Past the limit is cut off as it is typed; the server would refuse more.
                    if new.unicodeScalars.count > ProjectIdentifier.maxLength {
                        identifier = String(String.UnicodeScalarView(new.unicodeScalars.prefix(ProjectIdentifier.maxLength)))
                    }
                }
        } footer: {
            if let identifierProblem {
                Text(identifierProblem.description).foregroundStyle(Color(.destructive))
            } else {
                Text("Optional. Up to \(ProjectIdentifier.maxLength) characters, unique to this project. Tasks are numbered like PROJ-12.")
            }
        }
    }

    private func swatch(_ hex: String?) -> some View {
        Button {
            colour = hex
            swatchPicks += 1
        } label: {
            Circle()
                .fill(Color(hexString: hex) ?? Color(.muted))
                .frame(width: 28, height: 28)
                .overlay(Circle().stroke(Color(.primary), lineWidth: colour == hex ? 3 : 0))
                .overlay { if hex == nil { Image(systemName: "slash.circle").font(Theme.caption) } }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(hex.flatMap { projectColours.firstIndex(of: $0) }.map { projectColourNames[$0] } ?? hex ?? "No colour")
        .accessibilityAddTraits(colour == hex ? .isSelected : [])
    }

    private func load() {
        if case .createChild(let preset) = target { parent = preset }
        guard let editing else { return }
        title = editing.title
        details = editing.description ?? ""
        colour = editing.hexColor
        identifier = editing.identifier ?? ""
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
                if identifierChanged { patch.identifier = .set(identifier) }
                try services.store.updateProject(localId: editing.localId, patch: patch)
            } else {
                try services.store.createProject(ProjectInput(
                    title: name, description: note.isEmpty ? nil : note, parentLocalId: parent, hexColor: colour,
                    identifier: identifier
                ))
            }
            dismiss()
        } catch {
            errorMessage = String(describing: error)
        }
    }
}
