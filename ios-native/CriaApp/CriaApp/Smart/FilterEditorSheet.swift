import CriaKit
import SwiftUI

/// Create or edit a saved filter. The query is coloured as it is typed (`highlightSpans`), with suggestions from
/// `autocompleteContext`. Saving needs the network, like the web client.
struct FilterEditorSheet: View {
    let services: AppServices
    let existing: SavedFilterRecord?
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var details = ""
    @State private var query = ""
    @State private var includeNulls = false
    @State private var busy = false
    @State private var errorMessage: String?

    private var parseError: String? {
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        do {
            _ = try parseFilterQuery(query)
            return nil
        } catch {
            return String(describing: error)
        }
    }

    private var canSave: Bool {
        !busy && !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && parseError == nil
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Title", text: $title)
                    TextField("Description", text: $details)
                }
                Section {
                    // Hidden where the on-device model is not offered.
                    DescribeFilterRow(services: services) { query = $0 }
                    TextField("done = false && priority >= 3", text: $query, axis: .vertical)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    if !query.isEmpty { Text(FilterHighlightStyle.attributed(query)).font(.callout.monospaced()) }
                    suggestionRow
                    if let parseError { Text(parseError).font(Theme.caption).foregroundStyle(Color(.destructive)) }
                    Toggle("Include tasks with empty values", isOn: $includeNulls)
                } header: {
                    Text("Filter")
                }
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(Color(.destructive)) }
                }
            }
                .criaSurface()
            .navigationTitle(existing == nil ? "New filter" : "Edit filter")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { Task { await save() } }.disabled(!canSave) }
            }
            .onAppear(perform: load)
        }
    }

    @ViewBuilder private var suggestionRow: some View {
        let options = suggestions
        if !options.isEmpty, let context = autocompleteContext(query, cursor: query.utf16.count) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    ForEach(options, id: \.self) { option in
                        Button { apply(option, context: context) } label: { CriaChip(text: option, tint: Color(.primary)) }
                            .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var suggestions: [String] {
        guard let context = autocompleteContext(query, cursor: query.utf16.count) else { return [] }
        let pool: [String]
        switch context.kind {
        case .field: pool = filterFields
        case .label: pool = ((try? services.store.labels()) ?? []).map(\.title)
        case .project: pool = ((try? services.store.projects()) ?? []).map(\.title)
        case .assignee: pool = []
        }
        let wanted = context.prefix.lowercased()
        return Array(pool.filter { $0.lowercased().hasPrefix(wanted) && $0.lowercased() != wanted }.prefix(8))
    }

    private func apply(_ option: String, context: AutocompleteContext) {
        let text = NSString(string: query)
        let value = option.contains(" ") && context.kind != .field ? "'\(option)'" : option
        query = text.substring(to: context.replaceStart) + value + " "
    }

    private func load() {
        guard let existing else { return }
        title = existing.title
        details = existing.description ?? ""
        query = existing.filterQuery
        includeNulls = existing.filterIncludeNulls
    }

    private func save() async {
        busy = true
        defer { busy = false }
        do {
            if let existing {
                try await services.updateSavedFilter(
                    serverId: existing.serverId, title: title, description: details, query: query, includeNulls: includeNulls
                )
            } else {
                try await services.createSavedFilter(title: title, description: details, query: query, includeNulls: includeNulls)
            }
            dismiss()
        } catch {
            errorMessage = String(describing: error)
        }
    }
}

/// Colours for the filter syntax.
enum FilterHighlightStyle {
    static func attributed(_ query: String) -> AttributedString {
        let chars = Array(query)
        var output = AttributedString()
        var cursor = 0
        for span in highlightSpans(query) {
            if span.start > cursor { output += AttributedString(String(chars[cursor..<span.start])) }
            var piece = AttributedString(String(chars[span.start..<span.end]))
            piece.foregroundColor = color(for: span.kind)
            output += piece
            cursor = span.end
        }
        if cursor < chars.count { output += AttributedString(String(chars[cursor...])) }
        return output
    }

    private static func color(for kind: HighlightKind) -> Color {
        switch kind {
        case .field: return Color(.primary)
        case .operator: return Color(.warning)
        case .value: return Color(.success)
        case .logical: return Color(.info)
        case .paren: return Color(.mutedForeground)
        case .unknown: return Color(.destructive)
        }
    }
}
