import SwiftUI

/// The large title at the top of every Mac list screen (the design's content header): Onest Bold 28 with an SF 13
/// subtitle under it and optional buttons on the title's baseline. It replaces the window title, which the screens
/// hide with `macHidesWindowTitle()`.
struct MacContentHeader<Trailing: View>: View {
    let title: String
    var subtitle: String?
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(MacTheme.largeTitle)
                    .tracking(MacTheme.largeTitleTracking)
                    .foregroundStyle(Color(.foreground))
                    .lineLimit(1)
                    .frame(minHeight: 34)
                    .accessibilityAddTraits(.isHeader)
                if let subtitle {
                    Text(subtitle)
                        .font(.system(size: 13))
                        .foregroundStyle(MacTheme.label2)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            trailing()
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 18)
    }

    /// As a row at the top of a `List`: no inset beyond the task rows', no separator and no row background.
    func asListRow() -> some View {
        self
            .listRowInsets(EdgeInsets(top: 0, leading: 10, bottom: 0, trailing: 10))
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
    }
}

extension MacContentHeader where Trailing == EmptyView {
    init(title: String, subtitle: String? = nil) {
        self.init(title: title, subtitle: subtitle) { EmptyView() }
    }
}

/// A group of task rows: SF 13 semibold title, the count in the tertiary shade, an optional action on the right and a
/// hairline under it.
struct MacGroupHeader: View {
    let title: String
    var count: Int?
    var tint: Color = Color(.foreground)
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(tint)
                    .accessibilityAddTraits(.isHeader)
                if let count {
                    Text("\(count)")
                        .font(.system(size: 12))
                        .monospacedDigit()
                        .foregroundStyle(MacTheme.label3)
                }
                Spacer(minLength: 8)
                if let actionTitle, let action {
                    Button(actionTitle, action: action)
                        .buttonStyle(.plain)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Color(.primary))
                }
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 6)
            Rectangle()
                .fill(Color.primary.opacity(0.1))
                .frame(height: 0.5)
                .padding(.horizontal, 12)
        }
        .padding(.top, 22)
        .textCase(nil)
    }
}

/// The last row of a group: a plus and "New Task", which opens quick add with that group's date or project filled in.
struct MacNewTaskRow: View {
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: "plus")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color(.primary))
                    .frame(width: 18, height: 18)
                Text("New Task")
                    .font(.system(size: 13))
                    .foregroundStyle(MacTheme.label3)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .frame(height: 34)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(hovering ? MacTheme.fill : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .listRowSeparator(.hidden)
        .listRowInsets(EdgeInsets(top: 1, leading: 10, bottom: 1, trailing: 10))
    }
}

extension View {
    /// The in-content large title replaces the window's title on the Mac. The title stays set (`navigationTitle`) so
    /// the Window menu and Mission Control still name the screen.
    func macHidesWindowTitle() -> some View {
        toolbar(removing: .title)
    }
}
