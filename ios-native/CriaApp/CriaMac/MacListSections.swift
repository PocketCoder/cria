import CriaKit
import SwiftUI

/// A board column's header in the List view: a chevron that folds the section, the column's title and its count.
struct MacListSectionHeader: View {
    let title: String
    let count: Int
    @Binding var folded: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button {
            withAnimation(reduceMotion ? nil : .snappy(duration: 0.2)) { folded.toggle() }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(MacTheme.label3)
                    .rotationEffect(.degrees(folded ? 0 : 90))
                    .frame(width: 12)
                Text(title).font(.system(size: 14, weight: .semibold)).foregroundStyle(Color(.foreground))
                Text("\(count)").font(.system(size: 12)).foregroundStyle(MacTheme.label2).monospacedDigit()
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .macPointer()
        .textCase(nil)
        .accessibilityLabel("\(title), \(count) tasks")
        .accessibilityValue(folded ? "Collapsed" : "Expanded")
        .accessibilityAddTraits(.isHeader)
    }
}
