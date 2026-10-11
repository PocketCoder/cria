import CriaKit
import SwiftUI

/// Signed-in shell. S-40: an empty shell driven by database observation (project and task counts) plus the
/// sync banner. S-42 replaces the body with the tab bar.
struct ShellView: View {
    let services: AppServices
    let onSignOut: () -> Void

    @State private var counts: LiveValue<ShellCounts>

    init(services: AppServices, onSignOut: @escaping () -> Void) {
        self.services = services
        self.onSignOut = onSignOut
        let store = services.store
        _counts = State(initialValue: LiveValue(initial: ShellCounts(projects: 0, tasks: 0)) {
            observeStore(store, kinds: [.projects, .tasks]) { reading in
                ShellCounts(
                    projects: try reading.projects().count,
                    tasks: try reading.tasks(matching: TaskQuery(includeDone: false)).count
                )
            }
        })
    }

    var body: some View {
        VStack(spacing: 12) {
            SyncBanner(services: services)
            Text("\(counts.value.projects) projects, \(counts.value.tasks) open tasks")
            Button("Sign out", action: onSignOut)
        }
        .padding()
        .task { await counts.run() }
        .environment(\.services, services)
    }
}

struct ShellCounts: Equatable, Sendable {
    let projects: Int
    let tasks: Int
}
