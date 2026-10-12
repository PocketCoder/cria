import CriaKit
import SwiftUI

/// What a project screen reads for its title, subtitle and view pills.
struct ProjectScreenData: Equatable, Sendable {
    var views: [ViewRecord] = []
    var project: ProjectRecord?
    var openCount = 0
}

/// The line under a project's large title (colour dot and open count, like Today's date line) and a scrolling row
/// of view pills. The last pill opens Manage views.
struct ProjectHeader: View {
    let views: [ViewRecord]
    let selectedId: String?
    let colour: Color?
    let openCount: Int
    let canManage: Bool
    let onSelect: (String) -> Void
    let onManage: () -> Void

    /// One view and nothing to manage: a single pill would only repeat the title.
    private var showsPills: Bool { views.count > 1 || canManage }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            subtitle
            if showsPills { pills }
        }
        .textCase(nil)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var subtitle: some View {
        HStack(spacing: 6) {
            if let colour {
                Circle().fill(colour).frame(width: 8, height: 8).accessibilityHidden(true)
            }
            Text("\(openCount) open")
        }
        .font(Theme.rowSubtitle)
        .foregroundStyle(Color(.mutedForeground))
    }

    private var pills: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(views, id: \.localId) { view in pill(view) }
                if canManage { managePill }
            }
        }
        .scrollIndicators(.hidden)
        .scrollClipDisabled()
        .sensoryFeedback(.selection, trigger: selectedId)
    }

    private func pill(_ view: ViewRecord) -> some View {
        let selected = view.localId == selectedId
        return Button {
            onSelect(view.localId)
        } label: {
            Label(ViewManagement.label(view.slot), systemImage: Self.icon(view.viewKind))
                .modifier(PillStyle(selected: selected))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private var managePill: some View {
        Button(action: onManage) {
            Label("Manage", systemImage: "slider.horizontal.3")
                .modifier(PillStyle(selected: false))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Manage views")
    }

    static func icon(_ kind: ViewKind) -> String {
        switch kind {
        case .list: return "list.bullet"
        case .kanban: return "rectangle.split.3x1"
        case .table: return "tablecells"
        case .gantt: return "chart.bar.doc.horizontal"
        }
    }
}

/// Selected pills are filled with the accent; the others sit on the cell colour.
private struct PillStyle: ViewModifier {
    let selected: Bool
    @ScaledMetric(relativeTo: .subheadline) private var height: CGFloat = 36

    func body(content: Content) -> some View {
        content
            .font(Theme.rowSubtitle.weight(.medium))
            .lineLimit(1)
            .padding(.horizontal, 14)
            .frame(minHeight: height)
            .foregroundStyle(selected ? Color(.primaryForeground) : Color(.foreground))
            .background(selected ? Color(.primary) : Color(.cell), in: Capsule())
            .contentShape(Capsule())
    }
}

/// The header pinned above a view that is not a list (board, timeline, wide table).
struct PinnedProjectHeader<Content: View>: View {
    let header: ProjectHeader
    @ViewBuilder let content: Content

    var body: some View {
        VStack(spacing: 0) {
            header
                .padding(.horizontal, 16)
                .padding(.top, 4)
                .padding(.bottom, 12)
            content
        }
        .background(Color(.grouped))
    }
}
