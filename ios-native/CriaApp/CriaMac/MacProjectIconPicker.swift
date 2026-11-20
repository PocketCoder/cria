import CriaKit
import SwiftUI

/// Choose Icon…: the project's icon as a grid with a search field, its colour behind the current choice. The first
/// tile is the progress ring, the default. A click saves at once (to the account, so other devices follow); Done
/// closes.
struct MacProjectIconPicker: View {
    let project: ProjectRecord
    let services: AppServices
    @Environment(\.dismiss) private var dismiss
    @Environment(\.preferences) private var preferences
    @State private var search = ""

    private let columns = Array(repeating: GridItem(.fixed(40), spacing: 6), count: 8)

    private var current: String? {
        MacProjectIcons.symbol(for: project, custom: preferences.custom)
    }

    private var matches: [MacProjectIconChoice] {
        let query = search.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return MacProjectIcons.choices }
        return MacProjectIcons.choices.filter {
            $0.name.localizedCaseInsensitiveContains(query) || $0.symbol.localizedCaseInsensitiveContains(query)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header
            TextField("Search icons", text: $search)
                .textFieldStyle(.roundedBorder)
            LazyVGrid(columns: columns, alignment: .leading, spacing: 6) {
                if search.isEmpty { ringTile }
                ForEach(matches) { choice in tile(choice) }
            }
            if matches.isEmpty {
                Text("No icons match \u{201C}\(search)\u{201D}.")
                    .font(.system(size: 12))
                    .foregroundStyle(MacTheme.label2)
            }
            HStack {
                Spacer()
                Button("Done") { dismiss() }
                    .keyboardShortcut(.defaultAction)
            }
        }
        .padding(20)
        .frame(width: 400)
    }

    private var header: some View {
        HStack(spacing: 12) {
            MacProjectGlyph(project: project, size: 20)
                .frame(width: 40, height: 40)
                .background(MacTheme.fill, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(project.title).font(.system(size: 15, weight: .semibold))
                Text("The icon shows in the sidebar and the project's title.")
                    .font(.system(size: 11))
                    .foregroundStyle(MacTheme.label2)
            }
        }
    }

    private var ringTile: some View {
        let colour = MacTheme.projectColour(hex: project.hexColor)
        return tileButton(isCurrent: current == nil, help: "Progress ring") {
            MacProjectIcons.set(nil, for: project, services: services)
        } label: {
            Circle().strokeBorder(colour, lineWidth: 2).frame(width: 16, height: 16)
        }
    }

    private func tile(_ choice: MacProjectIconChoice) -> some View {
        let colour = MacTheme.projectColour(hex: project.hexColor)
        let isCurrent = current == choice.symbol
        return tileButton(isCurrent: isCurrent, help: choice.name) {
            MacProjectIcons.set(choice.symbol, for: project, services: services)
        } label: {
            Image(systemName: choice.symbol)
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(isCurrent ? colour : MacTheme.label2)
        }
    }

    private func tileButton<Content: View>(
        isCurrent: Bool, help: String, action: @escaping () -> Void, @ViewBuilder label: () -> Content
    ) -> some View {
        Button(action: action) {
            label()
                .frame(width: 40, height: 40)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(isCurrent ? MacTheme.selection : Color.clear)
                )
                .contentShape(Rectangle())
        }
        .buttonStyle(MacPressStyle())
        .macPointer()
        .help(help)
        .accessibilityLabel(help)
        .accessibilityAddTraits(isCurrent ? .isSelected : [])
    }
}
