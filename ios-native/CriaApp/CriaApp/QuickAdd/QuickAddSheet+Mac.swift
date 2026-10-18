import CriaKit
import SwiftUI

#if os(macOS)
/// The Mac quick-add panel's layout (`QuickAddPanel`): the line in SF 20, the parsed tokens tinted under it, the chips
/// row, a hint and a footer with Add Task. Same state and actions as the sheet.
extension QuickAddSheet {
    var panelForm: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 10) {
                if !queue.isEmpty { QuickAddQueueList(queue: $queue) }
                HStack(spacing: 12) {
                    Circle()
                        .strokeBorder(priorityTint, lineWidth: 1.5)
                        .frame(width: 20, height: 20)
                        .accessibilityHidden(true)
                    TextField("Buy milk tomorrow *errand !2", text: $line)
                        .font(.system(size: 20))
                        .focused($focused, equals: .title)
                        .onSubmit(returnPressed)
                }
                VStack(alignment: .leading, spacing: 8) {
                    if !line.isEmpty && parsedSomething {
                        Text(QuickAddPreview.highlighted(parsed, overridden: picked)).font(.system(size: 12))
                    }
                    TextField("Description", text: $note, axis: .vertical)
                        .font(.system(size: 13))
                        .foregroundStyle(MacTheme.label2)
                        .lineLimit(1...4)
                        .focused($focused, equals: .description)
                    subtaskSection
                    HStack(spacing: 6) {
                        panelProjectMenu
                        pickers
                    }
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
    }

    private var priorityTint: Color {
        ThemeToken.priority(priority).map { Color($0) } ?? MacTheme.label3
    }

    private var panelProjectMenu: some View {
        Menu {
            Picker("Project", selection: projectPick) {
                ForEach(projects, id: \.localId) { Text($0.title).tag($0.localId) }
            }
        } label: {
            let chip = resolveProjectChip(parsedProjectTitle: typedProjectTitle, projects: projects, projectLocalId: projectId)
            CriaChip(text: chip.title ?? "Project", systemImage: "tray", tint: Color(.primary))
        }
        .macChipMenu()
        .accessibilityLabel("Project")
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
            if let onRamble, aiStatus.isOfferable {
                Button { closeSheet(); onRamble() } label: { Label("Ramble", systemImage: "mic") }
                    .disabled(aiStatus.notReadyMessage != nil)
            }
            if let onPhoto {
                Button { closeSheet(); onPhoto() } label: { Label("From photo", systemImage: "photo") }
            }
            multipleToggle.controlSize(.small)
            Spacer(minLength: 8)
            Text("esc to close").font(.system(size: 12)).foregroundStyle(MacTheme.label3)
            Button(action: sendPressed) {
                Text(queue.isEmpty && !multiple ? "Add Task ↩" : "\(sendLabel) ↩").padding(.horizontal, 4)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(!canSend)
        }
        .font(.system(size: 13))
        .padding(.horizontal, 18)
        .padding(.vertical, 10)
    }
}
#endif
