import SwiftUI

/// A collapsed kanban column: a narrow strip with the count and the title running down it. Tap to open the column.
struct KanbanCollapsedStrip: View {
    static let width: CGFloat = 48

    let title: String
    let count: Int
    let onExpand: () -> Void

    var body: some View {
        Button(action: onExpand) {
            VStack(spacing: 12) {
                Image(systemName: "chevron.right")
                    .font(Theme.caption.weight(.semibold))
                    .foregroundStyle(Color(.mutedForeground))
                Text("\(count)")
                    .font(Theme.caption)
                    .monospacedDigit()
                    .foregroundStyle(Color(.mutedForeground))
                Text(title)
                    .font(Theme.rowSubtitle.weight(.semibold))
                    .foregroundStyle(Color(.foreground))
                    .lineLimit(1)
                    .fixedSize()
                    .rotationEffect(.degrees(90))
                    .frame(width: 20, height: min(max(CGFloat(title.count) * 8, 24), 200))
                Spacer(minLength: 0)
            }
            .padding(.vertical, 12)
            .frame(width: Self.width)
            .frame(minHeight: 160, alignment: .top)
            .background(Color(.foreground).opacity(0.05), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(title), \(count) \(count == 1 ? "task" : "tasks"), collapsed")
        .accessibilityHint("Opens the column")
    }
}
