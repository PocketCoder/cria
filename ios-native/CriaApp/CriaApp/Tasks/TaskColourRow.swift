import CriaKit
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// The swatches offered for a task: the project and label editors' set (`PROJECT_COLORS` in `sidebarLogic.ts`).
private let taskColours = [
    "ef4444", "f97316", "eab308", "22c55e", "06b6d4", "3b82f6", "8b5cf6", "ec4899", "78716c", "000000"
]

/// Spoken names for the swatches, in the same order, so VoiceOver does not read out raw hex.
private let taskColourNames = ["Red", "Orange", "Yellow", "Green", "Cyan", "Blue", "Purple", "Pink", "Grey", "Black"]

/// A task's colour: one row that opens to the swatches, a colour picker for any other colour, and None. The colour
/// syncs to Vikunja as the task's `hex_color`, so Vikunja-web shows it too. `apply` saves a patch and returns false
/// (after reporting it) when the save failed.
struct TaskColourRow: View {
    let task: TaskRecord
    let apply: (TaskPatch) -> Bool
    @State private var expanded = false
    /// Counts swatch taps, for the selection haptic.
    @State private var swatchPicks = 0
    @State private var custom = Color(.mutedForeground)
    /// A picker drag sends many values; only the one it settles on is saved.
    @State private var pending: Task<Void, Never>?

    /// The stored colour as six lowercase digits, so it matches a swatch whatever case or `#` it came with.
    private var current: String? {
        guard let raw = task.hexColor?.trimmingCharacters(in: CharacterSet(charactersIn: "# ")).lowercased(), !raw.isEmpty
        else { return nil }
        return raw
    }

    var body: some View {
        Button {
            withAnimation(.snappy) { expanded.toggle() }
        } label: {
            HStack {
                Label("Colour", systemImage: "paintpalette").foregroundStyle(Color(.foreground))
                Spacer()
                if let tint = Color(hexString: current) {
                    Circle().fill(tint).frame(width: 18, height: 18).accessibilityHidden(true)
                } else {
                    Text("None").foregroundStyle(Color(.mutedForeground))
                }
                Image(systemName: "chevron.right")
                    .font(Theme.caption)
                    .foregroundStyle(Color(.mutedForeground))
                    .rotationEffect(.degrees(expanded ? 90 : 0))
                    .accessibilityHidden(true)
            }
        }
        .accessibilityValue(spokenColour)
        .onChange(of: current, initial: true) { _, hex in
            if let tint = Color(hexString: hex) { custom = tint }
        }
        if expanded {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    swatch(nil)
                    ForEach(swatches, id: \.self) { swatch($0) }
                }
                .padding(.vertical, 4)
            }
            .sensoryFeedback(.selection, trigger: swatchPicks)
            ColorPicker("Custom colour", selection: $custom, supportsOpacity: false)
                .onChange(of: custom) { _, picked in
                    guard let hex = Self.hex(picked), hex != current else { return }
                    save(hex, after: .milliseconds(600))
                }
        }
    }

    private var spokenColour: String {
        guard let current else { return "None" }
        return taskColours.firstIndex(of: current).map { taskColourNames[$0] } ?? "Custom"
    }

    /// The fixed swatches, then the stored colour when it is not among them (set elsewhere), so it can be seen and kept.
    private var swatches: [String] {
        guard let current, !taskColours.contains(current) else { return taskColours }
        return taskColours + [current]
    }

    private func swatch(_ hex: String?) -> some View {
        Button {
            swatchPicks += 1
            save(hex, after: .zero)
        } label: {
            Circle()
                .fill(Color(hexString: hex) ?? Color(.muted))
                .frame(width: 28, height: 28)
                .overlay(Circle().stroke(Color(.primary), lineWidth: current == hex ? 3 : 0))
                .overlay { if hex == nil { Image(systemName: "slash.circle").font(Theme.caption) } }
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(hex.map { taskColours.firstIndex(of: $0).map { taskColourNames[$0] } ?? "Custom colour" } ?? "No colour")
        .accessibilityAddTraits(current == hex ? .isSelected : [])
    }

    /// Saves the colour (an empty string clears it) after `delay`; a newer pick replaces one still waiting.
    private func save(_ hex: String?, after delay: Duration) {
        pending?.cancel()
        pending = Task {
            if delay > .zero { try? await Task.sleep(for: delay) }
            guard !Task.isCancelled else { return }
            var patch = TaskPatch()
            patch.hexColor = hex ?? ""
            _ = apply(patch)
        }
    }

    /// Six lowercase hex digits for a picked colour, clamped to sRGB.
    private static func hex(_ color: Color) -> String? {
        guard let rgb = color.srgbComponents() else { return nil }
        let byte = { (value: CGFloat) in Int((min(max(value, 0), 1) * 255).rounded()) }
        return String(format: "%02x%02x%02x", byte(rgb.red), byte(rgb.green), byte(rgb.blue))
    }
}
