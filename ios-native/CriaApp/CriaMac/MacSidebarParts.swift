import SwiftUI

/// A sidebar section heading: SF 11 semibold in the tertiary shade, 14pt above, with a 10pt chevron for its collapse
/// state. The optional + (20×20, radius 6) shows while the pointer is over the heading.
struct MacSidebarHeader: View {
    let title: String
    @Binding var isExpanded: Bool
    var addHelp: String?
    var onAdd: (() -> Void)?
    @State private var hovering = false
    @State private var hoveringAdd = false

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
            .macPointer()
            .accessibilityLabel(title)
            .accessibilityValue(isExpanded ? "Expanded" : "Collapsed")
            Spacer(minLength: 4)
            if let addHelp, let onAdd {
                Button(action: onAdd) {
                    // A bare glyph in the heading's shade; a fill only while the pointer is on it.
                    Image(systemName: "plus")
                        .font(.system(size: 11, weight: .medium))
                        .frame(width: 18, height: 18)
                        .background {
                            if hoveringAdd { RoundedRectangle(cornerRadius: 5, style: .continuous).fill(MacTheme.fill) }
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(MacPressStyle())
                .macPointer()
                .foregroundStyle(hoveringAdd ? MacTheme.label2 : MacTheme.label3)
                .onHover { hoveringAdd = $0 }
                .opacity(hovering ? 1 : 0)
                .help(addHelp)
                .accessibilityLabel(addHelp)
            }
        }
        .padding(.top, 14)
        .onHover { hovering = $0 }
    }
}

/// A sidebar row's highlight, drawn here rather than by the system so hover and selection share one shape: the same
/// 8pt rounded rectangle across the full row width, `fill` under the pointer and `selection` once chosen. A click
/// selects the row's destination through the sidebar's `macSidebarSelect`; rows with no destination (Archived
/// projects) only take the hover.
struct MacSidebarRowState: ViewModifier {
    let destination: MacSelection?
    @Environment(\.macSidebarSelection) private var selection
    @Environment(\.macSidebarSelect) private var select
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hovering = false

    private var isSelected: Bool { destination != nil && destination == selection }

    func body(content: Content) -> some View {
        content
            .font(.system(size: 13, weight: isSelected ? .semibold : .regular))
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
            .background {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(isSelected ? MacTheme.selection : hovering ? MacTheme.fill : Color.clear)
                    .padding(.horizontal, -8)
                    .padding(.vertical, -4)
            }
            .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: hovering)
            .animation(reduceMotion ? nil : .snappy(duration: 0.2), value: isSelected)
            .onHover { hovering = $0 }
            .modifier(MacPointer())
            .simultaneousGesture(TapGesture().onEnded {
                if let destination { select(destination) }
            })
            .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

private struct MacSidebarSelectionKey: EnvironmentKey {
    static var defaultValue: MacSelection? { nil }
}

private struct MacSidebarSelectKey: EnvironmentKey {
    static var defaultValue: @MainActor (MacSelection) -> Void { { _ in } }
}

extension EnvironmentValues {
    /// The sidebar's selection, for the rows' highlight and Semibold title.
    var macSidebarSelection: MacSelection? {
        get { self[MacSidebarSelectionKey.self] }
        set { self[MacSidebarSelectionKey.self] = newValue }
    }

    /// Selects a sidebar destination; set by `MacSidebar`.
    var macSidebarSelect: @MainActor (MacSelection) -> Void {
        get { self[MacSidebarSelectKey.self] }
        set { self[MacSidebarSelectKey.self] = newValue }
    }
}

extension View {
    /// A sidebar row for `destination`, or a plain hover row when nil.
    func macSidebarRow(_ destination: MacSelection?) -> some View {
        modifier(MacSidebarRowState(destination: destination))
    }
}
