import CriaKit
import SwiftUI

#if os(macOS)
/// The Mac quick-add panel's layout (`QuickAddPanel`): a 20pt priority ring, the line in SF 20/28 with its parsed
/// tokens tinted in place, the chips row, a hint and a footer with Ramble, From photo and Add Task. Same state and
/// actions as the sheet.
extension QuickAddSheet {
    var panelForm: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 10) {
                if !queue.isEmpty { QuickAddQueueList(queue: $queue) }
                HStack(spacing: 12) {
                    QuickAddPriorityRing(priority: priority)
                    tintedField
                }
                VStack(alignment: .leading, spacing: 8) {
                    TextField("Description", text: $note, axis: .vertical)
                        .font(.system(size: 13))
                        .foregroundStyle(MacTheme.label2)
                        .lineLimit(1...4)
                        .focused($focused, equals: .description)
                    subtaskSection
                    panelChips
                    panelHint
                    addedLine
                    if let errorMessage {
                        Text(errorMessage).foregroundStyle(Color(.destructive)).font(.system(size: 12))
                    }
                }
                .padding(.leading, 32)
            }
            .padding(EdgeInsets(top: 18, leading: 18, bottom: 14, trailing: 18))
            Divider()
            panelFooter
        }
        .textFieldStyle(.plain)
        .focusEffectDisabled()
        .onExitCommand { closeSheet() }
        .task { allLabelTitles = ((try? services.store.labels()) ?? []).map(\.title) }
    }

    /// The single-line field, with each recognised token's span tinted at 14% behind the typed text. The tint is a
    /// copy of the line drawn underneath in the same font with clear glyphs, so it lines up with what is typed.
    private var tintedField: some View {
        ZStack(alignment: .leading) {
            if parsedSomething {
                Text(tokenUnderlay)
                    .font(.system(size: 20))
                    .lineLimit(1)
                    .fixedSize()
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
            TextField("Buy milk tomorrow *errand !2", text: $line)
                .font(.system(size: 20))
                .focused($focused, equals: .title)
                .onSubmit(returnPressed)
        }
        .frame(minHeight: 28)
        .clipped()
    }

    private var tokenUnderlay: AttributedString {
        var output = AttributedString()
        for token in parsed.tokens {
            var piece = AttributedString(token.text)
            piece.foregroundColor = .clear
            if let tint = Self.tokenTint(token.kind) { piece.backgroundColor = tint.opacity(0.14) }
            output += piece
        }
        return output
    }

    static func tokenTint(_ kind: QuickAddTokenKind) -> Color? {
        switch kind {
        case .label: return Color(.meadow700)
        case .project: return Color(.primary)
        case .priority: return Color(.marigold700)
        case .date: return Color(.sky700)
        default: return nil
        }
    }

    /// "Type *label, +project, !1–5 or a day like tomorrow.", each token in its colour.
    private var panelHint: some View {
        let label = Text("*label").foregroundStyle(Color(.meadow700))
        let project = Text("+project").foregroundStyle(Color(.primary))
        let bang = Text("!1–5").foregroundStyle(Color(.marigold700))
        let day = Text("tomorrow").foregroundStyle(Color(.sky700))
        return Text("Type \(label), \(project), \(bang) or a day like \(day).")
            .font(.system(size: 12))
            .foregroundStyle(MacTheme.label2)
    }

    private var panelFooter: some View {
        HStack(spacing: 8) {
            // The panel swaps itself to the Ramble or photo screen, so it is not closed first.
            if let onRamble, aiStatus.isOfferable {
                Button(action: onRamble) { Label("Ramble", systemImage: "mic") }
                    .macGlassButton()
                    .disabled(aiStatus.notReadyMessage != nil)
            }
            if let onPhoto {
                Button(action: onPhoto) { Label("From photo", systemImage: "photo") }
                    .macGlassButton()
            }
            multipleToggle.controlSize(.small)
            Spacer(minLength: 8)
            Text("esc to close").font(.system(size: 12)).foregroundStyle(MacTheme.label3)
            Button(action: sendPressed) {
                Text(queue.isEmpty && !multiple ? "Add Task ↩" : "\(sendLabel) ↩")
                    .padding(.horizontal, 4)
                    .frame(height: 30)
            }
            .buttonStyle(.borderedProminent)
            .disabled(!canSend)
        }
        .font(.system(size: 13))
        .padding(.horizontal, 18)
        .padding(.vertical, 10)
    }
}

/// The 20pt ring before the field: grey with no priority, the priority's colour once one is set.
struct QuickAddPriorityRing: View {
    let priority: Int

    var body: some View {
        Circle()
            .strokeBorder(ThemeToken.priority(priority).map { Color($0) } ?? MacTheme.label3, lineWidth: 1.5)
            .frame(width: 20, height: 20)
            .accessibilityHidden(true)
    }
}

extension View {
    /// A glass button on macOS 26, bordered before.
    @ViewBuilder
    func macGlassButton() -> some View {
        if #available(macOS 26, *) {
            buttonStyle(.glass)
        } else {
            buttonStyle(.bordered)
        }
    }
}
#endif
