import SwiftUI

/// A sidebar section heading: SF 11 semibold in the tertiary shade, 14pt above, with a 10pt chevron for its collapse
/// state. The optional + (20×20, radius 6) shows while the pointer is over the heading.
struct MacSidebarHeader: View {
    let title: String
    @Binding var isExpanded: Bool
    var addHelp: String?
    var onAdd: (() -> Void)?
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 4) {
            Button {
                withAnimation(.snappy(duration: 0.2)) { isExpanded.toggle() }
            } label: {
                HStack(spacing: 4) {
                    Text(title)
                        .font(.system(size: 11, weight: .semibold))
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                        .rotationEffect(.degrees(isExpanded ? 90 : 0))
                }
                .foregroundStyle(MacTheme.label3)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(title)
            .accessibilityValue(isExpanded ? "Expanded" : "Collapsed")
            Spacer(minLength: 4)
            if let addHelp, let onAdd {
                Button(action: onAdd) {
                    Image(systemName: "plus")
                        .font(.system(size: 11, weight: .semibold))
                        .frame(width: 20, height: 20)
                        .background(MacTheme.fill, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                        .contentShape(Rectangle())
                }
                .buttonStyle(MacPressStyle())
                .foregroundStyle(MacTheme.label2)
                .opacity(hovering ? 1 : 0)
                .help(addHelp)
                .accessibilityLabel(addHelp)
            }
        }
        .padding(.top, 14)
        .onHover { hovering = $0 }
    }
}

/// A sidebar row's own states on top of the system selection: Semibold title when selected, the `fill` shade under
/// the pointer.
struct MacSidebarRowState: ViewModifier {
    let isSelected: Bool
    @State private var hovering = false

    func body(content: Content) -> some View {
        content
            .font(.system(size: 13, weight: isSelected ? .semibold : .regular))
            .background {
                if hovering && !isSelected {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(MacTheme.fill)
                        .padding(.horizontal, -8)
                        .padding(.vertical, -4)
                }
            }
            .onHover { hovering = $0 }
    }
}

private struct MacSidebarSelectionKey: EnvironmentKey {
    static var defaultValue: MacSelection? { nil }
}

extension EnvironmentValues {
    /// The sidebar's selection, for the rows' Semibold title.
    var macSidebarSelection: MacSelection? {
        get { self[MacSidebarSelectionKey.self] }
        set { self[MacSidebarSelectionKey.self] = newValue }
    }
}

extension View {
    func macSidebarRow(selected: Bool) -> some View {
        modifier(MacSidebarRowState(isSelected: selected))
    }
}
