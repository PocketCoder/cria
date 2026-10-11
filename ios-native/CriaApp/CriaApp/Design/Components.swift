import CriaKit
import SwiftUI

/// Small rounded label used for labels, dates and project names.
struct CriaChip: View {
    let text: String
    var systemImage: String?
    var tint: Color = Color(.mutedForeground)
    var filled = false

    var body: some View {
        HStack(spacing: 4) {
            if let systemImage {
                Image(systemName: systemImage)
            }
            Text(text).lineLimit(1)
        }
        .font(Theme.caption)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .foregroundStyle(filled ? Color(.primaryForeground) : tint)
        .background(filled ? tint : tint.opacity(0.12), in: Capsule())
    }
}

struct CriaPrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.headline)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .foregroundStyle(Color(.primaryForeground))
            .background(Color(.primary), in: RoundedRectangle(cornerRadius: Theme.radius))
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}

struct CriaSecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.headline)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .foregroundStyle(Color(.primary))
            .background(Color(.primarySoft), in: RoundedRectangle(cornerRadius: Theme.radius))
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}

/// The coloured dot for priority 1...5. Renders nothing for an unset priority.
struct PriorityDot: View {
    let level: Int

    var body: some View {
        if let token = ThemeToken.priority(level) {
            Circle().fill(Color(token)).frame(width: 8, height: 8).accessibilityLabel("Priority \(level)")
        }
    }
}

/// Round completion checkbox used by task rows.
struct CheckCircle: View {
    let isDone: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: isDone ? "checkmark.circle.fill" : "circle")
                .font(.title2)
                .foregroundStyle(isDone ? Color(.success) : Color(.mutedForeground))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isDone ? "Mark not done" : "Mark done")
    }
}

/// Generic list row: leading accessory, title, optional subtitle and trailing accessory.
struct CriaRow<Leading: View, Trailing: View>: View {
    let title: String
    var subtitle: String?
    @ViewBuilder var leading: Leading
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(spacing: 12) {
            leading
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(Theme.rowTitle).foregroundStyle(Color(.foreground))
                if let subtitle {
                    Text(subtitle).font(Theme.caption).foregroundStyle(Color(.mutedForeground))
                }
            }
            Spacer(minLength: 0)
            trailing
        }
        .contentShape(Rectangle())
    }
}

struct ComponentCatalogue: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Cria").font(Theme.largeTitle)
            HStack {
                CriaChip(text: "Today", systemImage: "calendar", tint: Color(.primary))
                CriaChip(text: "Errands", tint: Color(.info))
                CriaChip(text: "Urgent", tint: Color(.destructive), filled: true)
            }
            HStack {
                ForEach(0...5, id: \.self) { level in PriorityDot(level: level) }
            }
            HStack {
                Button("Save") {}.buttonStyle(CriaPrimaryButtonStyle())
                Button("Cancel") {}.buttonStyle(CriaSecondaryButtonStyle())
            }
            CriaRow(title: "Buy milk", subtitle: "Tomorrow, Inbox") {
                CheckCircle(isDone: false) {}
            } trailing: {
                PriorityDot(level: 3)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color(.background))
    }
}

#Preview("Catalogue light") {
    ComponentCatalogue().preferredColorScheme(.light)
}

#Preview("Catalogue dark") {
    ComponentCatalogue().preferredColorScheme(.dark)
}

extension View {
    /// Cria's warm background behind a `List` or `Form`, with rows on the card colour and hairlines in the
    /// border colour. Scrolling, swipe actions and edit mode stay native.
    func criaSurface() -> some View {
        scrollContentBackground(.hidden)
            .background(Color(.background))
            .listRowBackground(Color(.card))
            .listRowSeparatorTint(Color(.border))
    }
}
