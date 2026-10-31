#if os(macOS)
import CriaKit
import SwiftUI

/// Start, End, Progress and Colour in a second field box under the first: what the iOS Details and Schedule sections
/// hold beyond the Mac field box. The values write through the same paths: the date sheet, `apply`, and the hand-set
/// progress flag.
struct TaskInspectorMoreFields: View {
    let task: TaskRecord
    /// Progress follows the subtasks unless set by hand.
    let hasSubtasks: Bool
    /// Saves a patch; false (with the error shown) when that failed.
    let apply: (TaskPatch) -> Bool
    let onPickDate: (TaskDateField) -> Void
    let onFollowSubtasks: () -> Void
    @Environment(\.dateDisplay) private var dateDisplay
    /// Bumped when the hand-set flag changes, so the row re-reads it.
    @State private var manualRevision = 0

    var body: some View {
        VStack(spacing: 0) {
            InspectorFieldRow(title: "Start", systemImage: "calendar.badge.clock") { dateValue(.start, iso: task.startDate) }
            Divider()
            InspectorFieldRow(title: "End", systemImage: "calendar.badge.checkmark") { dateValue(.end, iso: task.endDate) }
            Divider()
            InspectorFieldRow(title: "Progress", systemImage: followsSubtasks ? "chart.pie.fill" : "chart.pie") {
                progressMenu
            }
            Divider()
            InspectorFieldRow(title: "Colour", systemImage: "paintpalette") { InspectorColourValue(task: task, apply: apply) }
        }
        .modifier(InspectorFieldBoxStyle())
    }

    /// Opens the date sheet, which also clears the date.
    private func dateValue(_ field: TaskDateField, iso: String?) -> some View {
        let value = iso.flatMap { $0.isEmpty ? nil : $0 }
        let text = value.map { DueDates.label($0, now: Date(), display: dateDisplay) } ?? "None"
        return Button { onPickDate(field) } label: { InspectorPopUpLabel(text: text) }
            .buttonStyle(.plain)
            .accessibilityLabel("\(field.title), \(text)")
    }

    /// 0 to 100% in 10% steps, as in Vikunja-web, and "Follow subtasks" once set by hand.
    private var progressMenu: some View {
        let percent = Int((task.percentDone * 100).rounded())
        return InspectorPopUp(text: followsSubtasks ? "\(percent)% from subtasks" : "\(percent)%") {
            ForEach(0...10, id: \.self) { step in
                Toggle("\(step * 10)%", isOn: Binding(get: { percent == step * 10 }, set: { isOn in
                    if isOn { setProgress(Double(step) / 10) }
                }))
            }
            if hasSubtasks && !followsSubtasks {
                Divider()
                Button("Follow subtasks") {
                    onFollowSubtasks()
                    manualRevision += 1
                }
            }
        }
    }

    private var followsSubtasks: Bool {
        _ = manualRevision
        return hasSubtasks && !ProgressOverride.isManual(task.localId)
    }

    private func setProgress(_ value: Double) {
        var patch = TaskPatch()
        patch.percentDone = value
        guard apply(patch) else { return }
        // A value set by hand wins over the subtasks until the user hands it back.
        ProgressOverride.setManual(task.localId, true)
        manualRevision += 1
    }
}

/// The Colour value: the swatch and its name, opening a popover with the swatches, a colour picker and None. The
/// colour syncs as the task's `hex_color`, as from the iOS Colour row.
struct InspectorColourValue: View {
    let task: TaskRecord
    let apply: (TaskPatch) -> Bool
    @State private var showing = false
    @State private var custom = Color(.mutedForeground)
    /// A picker drag sends many values; only the one it settles on is saved.
    @State private var pending: Task<Void, Never>?

    /// The stored colour as six lowercase digits, so it matches a swatch whatever case or `#` it came with.
    private var current: String? {
        guard let raw = task.hexColor?.trimmingCharacters(in: CharacterSet(charactersIn: "# ")).lowercased(), !raw.isEmpty
        else { return nil }
        return raw
    }

    private var name: String {
        guard let current else { return "None" }
        return taskColours.firstIndex(of: current).map { taskColourNames[$0] } ?? "Custom"
    }

    var body: some View {
        Button { showing = true } label: {
            InspectorPopUpLabel(text: name, dot: Color(hexString: current))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Colour, \(name)")
        .popover(isPresented: $showing, arrowEdge: .bottom) { palette }
        .onChange(of: current, initial: true) { _, hex in
            if let tint = Color(hexString: hex) { custom = tint }
        }
    }

    private var palette: some View {
        VStack(alignment: .leading, spacing: 12) {
            LazyVGrid(columns: Array(repeating: GridItem(.fixed(24), spacing: 8), count: 6), alignment: .leading, spacing: 8) {
                swatch(nil)
                ForEach(swatches, id: \.self) { swatch($0) }
            }
            ColorPicker("Custom colour", selection: $custom, supportsOpacity: false)
                .onChange(of: custom) { _, picked in
                    guard let hex = TaskColourRow.hex(picked), hex != current else { return }
                    save(hex, after: .milliseconds(600))
                }
        }
        .padding(14)
    }

    /// The fixed swatches, then the stored colour when it is not among them (set elsewhere), so it can be kept.
    private var swatches: [String] {
        guard let current, !taskColours.contains(current) else { return taskColours }
        return taskColours + [current]
    }

    private func swatch(_ hex: String?) -> some View {
        Button { save(hex, after: .zero) } label: {
            Circle()
                .fill(Color(hexString: hex) ?? MacTheme.fill)
                .frame(width: 22, height: 22)
                .overlay(Circle().stroke(Color(.primary), lineWidth: current == hex ? 2 : 0).padding(-2))
                .overlay { if hex == nil { Image(systemName: "slash.circle").font(.system(size: 11)) } }
        }
        .buttonStyle(.plain)
        .help(hex.map { taskColours.firstIndex(of: $0).map { taskColourNames[$0] } ?? "Custom colour" } ?? "No colour")
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
}
#endif
