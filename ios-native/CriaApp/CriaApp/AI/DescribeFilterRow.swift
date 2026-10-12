import CriaKit
import SwiftUI

/// "Describe it in words" for the saved-filter editor: the on-device model writes the filter query. The answer must
/// pass the same parser Save uses; on a parse error the model gets one retry with the error fed back, then the
/// result lands in the query field for the user to fix. Shows nothing where the device cannot run the model.
struct DescribeFilterRow: View {
    let services: AppServices
    let onQuery: (String) -> Void
    @State private var text = ""
    @State private var working = false
    @State private var errorMessage: String?

    private var isBlank: Bool { text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        if AIStatus.shared.isOfferable {
            HStack {
                TextField("Describe it: overdue work tasks with high priority", text: $text)
                    .submitLabel(.go)
                    .onSubmit { Task { await write() } }
                    .accessibilityLabel("Describe the filter")
                Button {
                    Task { await write() }
                } label: {
                    if working {
                        ProgressView()
                    } else {
                        Label("Write", systemImage: "sparkles")
                    }
                }
                .buttonStyle(.borderless)
                .disabled(working || isBlank || AIStatus.shared.notReadyMessage != nil)
                .accessibilityLabel("Write the filter query")
            }
            if let errorMessage {
                Text(errorMessage).font(Theme.caption).foregroundStyle(Color(.destructive))
            } else if let reason = AIStatus.shared.notReadyMessage {
                Text(reason).font(Theme.caption).foregroundStyle(Color(.mutedForeground))
            }
        }
    }

    private func write() async {
        guard !isBlank, !working else { return }
        working = true
        errorMessage = nil
        defer { working = false }
        do {
            let projects = ProjectTree.visible(try services.store.projects()).map(\.title)
            let labels = try services.store.labels().map(\.title)
            let query = try await AIStatus.shared.features.filterQuery(describing: text, projects: projects, labels: labels)
            if query.isEmpty {
                errorMessage = "The model did not write a query. Try describing it another way."
            } else {
                onQuery(query)
            }
        } catch {
            errorMessage = AIPrompts.errorMessage(String(describing: error))
        }
    }
}
