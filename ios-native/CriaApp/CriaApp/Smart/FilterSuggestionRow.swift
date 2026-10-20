import CriaKit
import SwiftUI

/// Suggestions for the word at the end of a filter query: field names, or label and project titles after a field that
/// takes them. Tapping one completes the word. Shared by the saved-filter editor and the view and board-column filters.
struct FilterSuggestionRow: View {
    let services: AppServices
    @Binding var query: String

    var body: some View {
        let options = suggestions
        if !options.isEmpty, let context = autocompleteContext(query, cursor: query.utf16.count) {
            #if os(macOS)
            // Wrapped rather than a sideways scroller, which clipped the last chip.
            ChipFlowLayout { chips(options, context: context) }
            #else
            ScrollView(.horizontal, showsIndicators: false) {
                HStack { chips(options, context: context) }
            }
            #endif
        }
    }

    private func chips(_ options: [String], context: AutocompleteContext) -> some View {
        ForEach(options, id: \.self) { option in
            Button { apply(option, context: context) } label: { CriaChip(text: option, tint: Color(.primary)) }
                .buttonStyle(.plain)
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
}
