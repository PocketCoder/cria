import CriaKit
import SwiftUI
import UIKit

/// A label opened in the editor.
struct LabelEditTarget: Identifiable {
    let label: LabelRecord
    var id: String { label.localId }
}

/// The swatches offered for labels: the project editor's set (`PROJECT_COLORS` in `sidebarLogic.ts`).
private let labelColours = [
    "ef4444", "f97316", "eab308", "22c55e", "06b6d4", "3b82f6", "8b5cf6", "ec4899", "78716c", "000000"
]

/// Spoken names for the swatches, in the same order, so VoiceOver does not read out raw hex.
private let labelColourNames = ["Red", "Orange", "Yellow", "Green", "Cyan", "Blue", "Purple", "Pink", "Grey", "Black"]

/// Renames and recolours a label. A colour set elsewhere (Vikunja-web allows any) is offered as an extra swatch, so
/// saving keeps it; the colour picker sets any other.
struct LabelEditorSheet: View {
    let services: AppServices
    let label: LabelRecord
    var onSaved: (LabelRecord) -> Void = { _ in }
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var colour: String?
    /// Counts swatch taps, for the selection haptic.
    @State private var swatchPicks = 0
    @State private var errorMessage: String?

    /// The stored colour as six lowercase digits, so it matches a swatch whatever case or `#` it came with.
    private static func normalised(_ hex: String?) -> String? {
        guard let raw = hex?.trimmingCharacters(in: CharacterSet(charactersIn: "# ")).lowercased(), !raw.isEmpty
        else { return nil }
        return raw
    }

    /// The fixed swatches, then the label's stored colour and the picked one when they are not among them.
    private var swatches: [String] {
        var all = labelColours
        for extra in [Self.normalised(label.hexColor), colour].compactMap({ $0 }) where !all.contains(extra) {
            all.append(extra)
        }
        return all
    }

    private var customColour: Binding<Color> {
        Binding(
            get: { Color(hexString: colour) ?? Color(.mutedForeground) },
            set: { colour = Self.hex($0) ?? colour }
        )
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Title", text: $title)
                }
                Section("Colour") {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack {
                            swatch(nil)
                            ForEach(swatches, id: \.self) { swatch($0) }
                        }
                    }
                    .sensoryFeedback(.selection, trigger: swatchPicks)
                    ColorPicker("Custom colour", selection: customColour, supportsOpacity: false)
                }
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(Color(.destructive)) }
                }
            }
                .criaSurface()
            .navigationTitle("Edit label")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: save)
                        .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .onAppear {
                title = label.title
                colour = Self.normalised(label.hexColor)
            }
        }
    }

    private func swatch(_ hex: String?) -> some View {
        Button {
            colour = hex
            swatchPicks += 1
        } label: {
            Circle()
                .fill(Color(hexString: hex) ?? Color(.muted))
                .frame(width: 28, height: 28)
                .overlay(Circle().stroke(Color(.primary), lineWidth: colour == hex ? 3 : 0))
                .overlay { if hex == nil { Image(systemName: "slash.circle").font(Theme.caption) } }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(swatchName(hex))
        .accessibilityAddTraits(colour == hex ? .isSelected : [])
    }

    private func swatchName(_ hex: String?) -> String {
        guard let hex else { return "No colour" }
        return labelColours.firstIndex(of: hex).map { labelColourNames[$0] } ?? "Custom colour"
    }

    /// Six lowercase hex digits for a picked colour, clamped to sRGB.
    private static func hex(_ color: Color) -> String? {
        var red: CGFloat = 0
        var green: CGFloat = 0
        var blue: CGFloat = 0
        var alpha: CGFloat = 0
        guard UIColor(color).getRed(&red, green: &green, blue: &blue, alpha: &alpha) else { return nil }
        let byte = { (value: CGFloat) in Int((min(max(value, 0), 1) * 255).rounded()) }
        return String(format: "%02x%02x%02x", byte(red), byte(green), byte(blue))
    }

    private func save() {
        do {
            let saved = try services.store.updateLabel(localId: label.localId, title: title, hexColor: colour)
            onSaved(saved)
            dismiss()
        } catch LabelEditError.emptyTitle {
            errorMessage = "A label needs a title."
        } catch {
            errorMessage = String(describing: error)
        }
    }
}
