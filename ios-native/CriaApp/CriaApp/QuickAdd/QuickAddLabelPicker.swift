import CriaKit
import SwiftUI

/// Picks labels for a new task by title: existing labels, searchable, plus "Create" for a name with no label yet.
/// Nothing is written here; the task's labels (and any new ones) are saved when the task is added.
struct QuickAddLabelPicker: View {
    let services: AppServices
    @Binding var selected: [String]
    @Environment(\.dismiss) private var dismiss
    @State private var labels: [LabelRecord] = []
    @State private var query = ""

    var body: some View {
        NavigationStack {
            List {
                if let newTitle {
                    Button { toggle(newTitle) } label: {
                        Label("Create ‘\(newTitle)’", systemImage: "plus.circle")
                    }
                }
                ForEach(rows, id: \.self) { title in
                    Button { toggle(title) } label: { row(title) }
                        .foregroundStyle(Color(.foreground))
                }
            }
            .overlay {
                if rows.isEmpty && newTitle == nil {
                    ContentUnavailableView("No labels", systemImage: "tag", description: Text("Type a name to create one."))
                }
            }
            .macRowButtons()
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search or create")
            .textInputAutocapitalization(.never)
            .navigationTitle("Labels")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", systemImage: "checkmark") { dismiss() }
                }
            }
        }
        .macSheetFrame(width: 380, height: 460)
        .onAppear { labels = (try? services.store.labels()) ?? [] }
    }

    private func row(_ title: String) -> some View {
        HStack(spacing: 10) {
            Circle()
                .fill(color(for: title))
                .frame(width: 10, height: 10)
            Text(title)
            Spacer()
            if isSelected(title) {
                Image(systemName: "checkmark").foregroundStyle(Color(.primary)).fontWeight(.semibold)
            }
        }
        .contentShape(Rectangle())
        .accessibilityAddTraits(isSelected(title) ? .isSelected : [])
    }

    /// Existing labels, then picks that have no label yet (typed or created here), filtered by the search.
    private var rows: [String] {
        var titles = labels.map(\.title)
        for title in selected where !titles.contains(where: { $0.caseInsensitiveCompare(title) == .orderedSame }) {
            titles.append(title)
        }
        let needle = trimmedQuery
        return needle.isEmpty ? titles : titles.filter { $0.localizedCaseInsensitiveContains(needle) }
    }

    /// The search text, when no label has exactly that name.
    private var newTitle: String? {
        let title = trimmedQuery
        guard !title.isEmpty, !rows.contains(where: { $0.caseInsensitiveCompare(title) == .orderedSame }) else { return nil }
        return title
    }

    private var trimmedQuery: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    private func isSelected(_ title: String) -> Bool {
        selected.contains { $0.caseInsensitiveCompare(title) == .orderedSame }
    }

    private func color(for title: String) -> Color {
        let label = labels.first { $0.title.caseInsensitiveCompare(title) == .orderedSame }
        return Color(hexString: label?.hexColor) ?? Color(.meadow500)
    }

    private func toggle(_ title: String) {
        if isSelected(title) {
            selected.removeAll { $0.caseInsensitiveCompare(title) == .orderedSame }
        } else {
            selected.append(title)
            query = ""
        }
    }
}
