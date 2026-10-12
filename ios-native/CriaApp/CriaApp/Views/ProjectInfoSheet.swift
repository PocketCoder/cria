import CriaKit
import SwiftUI

/// What the info page reads from the local copy.
struct ProjectInfoData: Equatable, Sendable {
    var project: ProjectRecord?
    var parentTitle: String?
    var counts = ProjectTaskCounts(open: 0, done: 0)
}

/// Why a duplicate failed, in words for an alert.
enum ProjectDuplicate {
    static func failureMessage(_ error: any Error) -> String {
        isOfflineError(error) ? "Duplicating a project needs a connection. Try again when you are online." : String(describing: error)
    }
}

/// A project's details: identifier, parent, task counts, owner and dates, with Duplicate. The owner and creation date
/// come from the server, so they are missing offline. Ported from `ProjectInfoModal.tsx`.
struct ProjectInfoSheet: View {
    let services: AppServices
    let projectLocalId: String
    @State private var live: LiveValue<ProjectInfoData>
    @State private var serverInfo: ProjectServerInfo?
    @State private var infoLoaded = false
    @State private var duplicating = false
    @State private var failure: String?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dateDisplay) private var dateDisplay

    init(services: AppServices, projectLocalId: String) {
        self.services = services
        self.projectLocalId = projectLocalId
        let store = services.store
        _live = State(initialValue: LiveValue(initial: ProjectInfoData()) {
            observeStore(store, kinds: [.projects, .tasks]) { reading in
                let project = try reading.project(localId: projectLocalId)
                return ProjectInfoData(
                    project: project,
                    parentTitle: try project?.parentLocalId.flatMap { try reading.project(localId: $0)?.title },
                    counts: try reading.taskCounts(forProject: projectLocalId)
                )
            }
        })
    }

    private var project: ProjectRecord? { live.value.project }

    var body: some View {
        NavigationStack {
            List {
                if let project {
                    descriptionSection(project)
                    detailsSection(project)
                    if let serverId = project.serverId, serverId > 0 { actionsSection }
                }
            }
            .criaSurface()
            .navigationTitle(project?.title ?? "Project")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .alert("Could not duplicate", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(failure ?? "")
            }
        }
        .presentationDetents([.medium, .large])
        .task { await live.run() }
        .task(id: project?.serverId) { await loadServerInfo() }
    }

    @ViewBuilder private func descriptionSection(_ project: ProjectRecord) -> some View {
        let text = project.description ?? ""
        let visible = text.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
        if !visible.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            Section { RichTextView(html: text, services: services) }
        }
    }

    private func detailsSection(_ project: ProjectRecord) -> some View {
        Section {
            if let identifier = project.identifier, !identifier.isEmpty { row("Identifier", identifier) }
            if let parent = live.value.parentTitle { row("Parent", parent) }
            row("Tasks", "\(live.value.counts.open) open, \(live.value.counts.done) done")
            if let owner = serverInfo?.ownerName { row("Owner", owner) }
            if let created = serverInfo?.created { row("Created", dateText(created)) }
            row("Updated", dateText(project.updatedAt))
            if project.isArchived { row("Status", "Archived") }
            if project.isFavorite { row("Favourite", "Yes") }
        } footer: {
            if infoLoaded && serverInfo == nil && (project.serverId ?? 0) > 0 {
                Text("Offline: the owner and creation date need a connection.")
            }
        }
    }

    private var actionsSection: some View {
        Section {
            Button {
                Task { await duplicate() }
            } label: {
                HStack {
                    Label("Duplicate project", systemImage: "plus.square.on.square")
                    if duplicating {
                        Spacer()
                        ProgressView()
                    }
                }
            }
            .disabled(duplicating)
        } footer: {
            Text("Copies the project with its tasks, views and labels. Needs a connection.")
        }
    }

    private func row(_ title: String, _ value: String) -> some View {
        LabeledContent(title) { Text(value).foregroundStyle(Color(.foreground)) }
            .accessibilityElement(children: .combine)
    }

    private func dateText(_ iso: String) -> String {
        let label = DueDates.label(iso, now: Date(), display: dateDisplay)
        return label.isEmpty ? iso : label
    }

    private func loadServerInfo() async {
        guard let serverId = project?.serverId, serverId > 0 else { return }
        serverInfo = await services.projectInfo(serverId: serverId)
        infoLoaded = true
    }

    private func duplicate() async {
        duplicating = true
        defer { duplicating = false }
        do {
            try await services.duplicateProject(localId: projectLocalId)
            dismiss()
        } catch {
            failure = ProjectDuplicate.failureMessage(error)
        }
    }
}
