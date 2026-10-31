#if os(macOS)
import SwiftUI

/// One row of an inspector field box: a 14pt `label2` icon, an 84pt `label2` title, then the value. 36pt high.
struct InspectorFieldRow<Value: View>: View {
    let title: String
    let systemImage: String
    @ViewBuilder let value: Value

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: systemImage)
                .font(.system(size: 14))
                .foregroundStyle(MacTheme.label2)
                .frame(width: 18)
                .accessibilityHidden(true)
            Text(title)
                .font(.system(size: 13))
                .foregroundStyle(MacTheme.label2)
                .frame(width: 84, alignment: .leading)
            value
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 36)
    }
}

/// The look of a pop-up value: 24pt, radius 7, `fill`, SF 13, with the 11pt up-down chevron. `dot` leads with a
/// colour swatch.
struct InspectorPopUpLabel: View {
    let text: String
    var tint: Color = .primary
    var dot: Color?

    var body: some View {
        HStack(spacing: 4) {
            if let dot {
                Circle().fill(dot).frame(width: 10, height: 10).accessibilityHidden(true)
            }
            Text(text).font(.system(size: 13)).foregroundStyle(tint).lineLimit(1)
            Image(systemName: "chevron.up.chevron.down")
                .font(.system(size: 11))
                .foregroundStyle(MacTheme.label2)
                .accessibilityHidden(true)
        }
        .padding(.horizontal, 8)
        .frame(height: 24)
        .background(MacTheme.fill, in: RoundedRectangle(cornerRadius: 7))
    }
}

/// A pop-up value whose choices are a menu.
struct InspectorPopUp<Content: View>: View {
    let text: String
    var tint: Color = .primary
    @ViewBuilder let content: Content

    var body: some View {
        Menu {
            content
        } label: {
            InspectorPopUpLabel(text: text, tint: tint)
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
    }
}

/// A field box: `cell` background, radius 12, a 0.5pt hairline inside the edge.
struct InspectorFieldBoxStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(MacTheme.cell, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.primary.opacity(0.1), lineWidth: 0.5))
    }
}
#endif
