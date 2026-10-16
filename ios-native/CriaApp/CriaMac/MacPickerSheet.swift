import SwiftUI

/// The Mac's `pickerDialog`: a title, a filter field for longer lists, the options as rows (colour dot, title, a tick
/// on the current one) and Cancel. Return picks the first match; Esc closes.
struct MacPickerSheet: View {
    let title: String
    let options: [PickerOption]
    let onPick: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @FocusState private var filtering: Bool

    private var showsFilter: Bool { options.count > 8 }

    private var shown: [PickerOption] {
        let text = query.trimmingCharacters(in: .whitespaces)
        return text.isEmpty ? options : options.filter { $0.title.localizedCaseInsensitiveContains(text) }
    }

    var body: some View {
        VStack(spacing: 0) {
            Text(title)
                .font(Theme.headline)
                .foregroundStyle(Color(.foreground))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.top, 14)
                .padding(.bottom, 8)
            if showsFilter {
                TextField("Filter", text: $query)
                    .textFieldStyle(.roundedBorder)
                    .focused($filtering)
                    .onSubmit { if let first = shown.first { choose(first) } }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 8)
            }
            List(shown) { option in
                Button { choose(option) } label: { row(option) }
                    .listRowSeparator(.hidden)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .macRowButtons()
            Divider()
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
            }
            .padding(12)
        }
        .frame(width: 340, height: min(520, CGFloat(shown.count) * 30 + (showsFilter ? 150 : 110)))
        .background(Color(.background))
        .onAppear { filtering = showsFilter }
    }

    private func row(_ option: PickerOption) -> some View {
        HStack(spacing: 10) {
            Circle()
                .fill(option.tint ?? Color.clear)
                .frame(width: 9, height: 9)
            Text(option.title)
                .foregroundStyle(Color(.foreground))
                .lineLimit(1)
            Spacer()
            if option.isCurrent {
                Image(systemName: "checkmark")
                    .font(Theme.caption.weight(.semibold))
                    .foregroundStyle(Color(.primary))
            }
        }
        .padding(.vertical, 3)
        .accessibilityAddTraits(option.isCurrent ? .isSelected : [])
    }

    private func choose(_ option: PickerOption) {
        onPick(option.id)
        dismiss()
    }
}
