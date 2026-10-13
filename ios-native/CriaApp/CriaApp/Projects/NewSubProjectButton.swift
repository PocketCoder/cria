import CriaKit
import SwiftUI

/// A "New sub-project" row for a project's options: opens the project editor with this project already chosen as the
/// parent. Reads the project list when tapped, so it needs nothing from the screen it sits on.
struct NewSubProjectButton: View {
    let services: AppServices
    let parentLocalId: String
    @State private var target: ProjectEditorTarget?
    @State private var projects: [ProjectRecord] = []

    var body: some View {
        Button {
            projects = ProjectTree.visible((try? services.store.projects()) ?? [])
            target = .createChild(parent: parentLocalId)
        } label: {
            Label("New sub-project", systemImage: "folder.badge.plus")
        }
        .sheet(item: $target) { target in
            ProjectEditorSheet(services: services, target: target, projects: projects)
        }
    }
}
