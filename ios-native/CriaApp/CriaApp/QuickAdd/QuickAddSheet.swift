import CriaKit
import SwiftUI

/// Quick add: one line of text with Quick Add Magic, a live preview, and pickers that stay in step with the
/// parsed tokens (`followParsed`) until one is set by hand, after which the picker wins. Creates the task through the
/// store, so it is saved locally at once. "Add another" keeps the sheet (and project) for the next task.
struct QuickAddSheet: View {
    let services: AppServices
    let contextProjectId: String?
    /// Text to start with, e.g. from a `cria://add?title=` link.
    var initialLine = ""
    /// Day to start with as the due date, e.g. from "Nothing planned" on Upcoming.
    var initialDueDate: Date?
    /// Hand off to the Ramble or photo sheet. The parent dismisses this sheet and presents the other.
    var onRamble: (() -> Void)?
    var onPhoto: (() -> Void)?
    @Environment(\.dismiss) private var dismiss
    @AppStorage("cria.quickAddMagicMode") private var modeRaw = QuickAddMagicMode.default.rawValue
    @State private var line = ""
    @State private var projects: [ProjectRecord] = []
    @State private var projectId = ""
    /// The server's default (inbox) project: the remembered one at once, then the server's when it answers.
    @State private var defaultServerId: Int?
    @State private var priority = 0
    @State private var dueISO = ""
    @State private var labelTitles: [String] = []
    @State private var reminders: [QuickAddReminder] = []
    /// Fields set with a picker: the typed line no longer changes them.
    @State private var picked: Set<QuickAddField> = []
    @State private var pickerSheet: QuickAddPickerSheet?
    @State private var addAnother = false
    @State private var addedTitle: String?
    /// Clearing the line after "Add another" must not take the project back out with the typed `+project`.
    @State private var skipNextFollow = false
    @State private var errorMessage: String?
    @FocusState private var focused: Bool
    /// Height of the field, chips and hint, so the sheet hugs them above the keyboard.
    @State private var contentHeight: CGFloat = 260
    @State private var detent: PresentationDetent = .height(260 + QuickAddSheet.navigationBarAllowance)

    private var mode: QuickAddMagicMode { QuickAddMagicMode(rawValue: modeRaw) ?? .default }
    private var parsed: QuickAddResult { parseQuickAddTask(line, mode: mode) }
    /// The typed `+project`, unless a project was picked over it.
    private var typedProjectTitle: String? { picked.contains(.project) ? nil : parsed.projectTitle }
    private var aiStatus: AIStatus { AIStatus.shared }

    private var baseProjectId: String {
        pickFallbackProjectId(projects: projects, selectedLocalId: contextProjectId, defaultServerProjectId: defaultServerId) ?? ""
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                TextField("Buy milk tomorrow *errand !2", text: $line, axis: .vertical)
                    .font(.title2)
                    .focused($focused)
                    .submitLabel(.done)
                    .onSubmit(submit)
                if !line.isEmpty {
                    Text(QuickAddPreview.highlighted(parsed, overridden: picked)).font(Theme.rowTitle)
                }
                pickers
                chips
                if let errorMessage {
                    Text(errorMessage).foregroundStyle(Color(.destructive)).font(Theme.caption)
                }
                QuickAddHint()
                QuickAddAIRow(onRamble: onRamble, onPhoto: onPhoto, close: { dismiss() })
                addAnotherRow
            }
            .padding()
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { fitContent($0) }
            // Pinned to the top: the stack sat centred in the sheet, with empty space above and below.
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .navigationTitle("New task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", systemImage: "xmark") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add", systemImage: "arrow.up", action: submit)
                        .disabled(!canSubmit)
                        .modifier(CriaProminentToolbarButton())
                }
            }
            .onAppear(perform: load)
            .onChange(of: line) { old, new in
                // A multi-line field inserts a newline on Return instead of calling onSubmit: strip it and submit.
                if new.contains("\n") {
                    line = new.replacingOccurrences(of: "\n", with: "")
                    if canSubmit { submit() }
                } else if skipNextFollow {
                    skipNextFollow = false
                } else {
                    lineChanged(from: old, to: new)
                }
            }
            // Relative reminders follow the due date, so they go when it does.
            .onChange(of: dueISO) { _, new in
                if new.isEmpty { reminders.removeAll { $0.needsDueDate } }
            }
            .sheet(item: $pickerSheet, onDismiss: { focused = true }, content: { which in
                QuickAddPickerSheetView(
                    which: which, services: services, dueISO: dueISO, labelTitles: $labelTitles, reminders: $reminders,
                    onDue: { setDue($0) }
                )
            })
        }
        .presentationDetents([fittedDetent, .large], selection: $detent)
        .task { await aiStatus.refresh() }
        .task { await adoptServerDefault() }
    }

    /// The inline navigation bar and grabber above the content.
    private static let navigationBarAllowance: CGFloat = 64

    private var fittedDetent: PresentationDetent { .height(contentHeight + Self.navigationBarAllowance) }

    /// Follows the content as chips and the preview come and go, unless the sheet was pulled up to full height.
    private func fitContent(_ height: CGFloat) {
        guard height > 0, abs(height - contentHeight) > 1 else { return }
        let wasFitted = detent != .large
        contentHeight = height
        if wasFitted { detent = fittedDetent }
    }

    private var addAnotherRow: some View {
        Toggle(isOn: $addAnother) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Add another").font(Theme.rowTitle)
                if let addedTitle {
                    Text("Added ‘\(addedTitle)’").font(Theme.caption).foregroundStyle(Color(.mutedForeground))
                }
            }
        }
        .tint(Color(.primary))
    }

    private var canSubmit: Bool {
        canSubmitQuickAdd(title: parsed.title, projectTitle: typedProjectTitle, projectLocalId: projectId.isEmpty ? nil : projectId)
    }

    private var pickers: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Menu {
                    Picker("Project", selection: projectPick) {
                        ForEach(projects, id: \.localId) { Text($0.title).tag($0.localId) }
                    }
                } label: {
                    let chip = resolveProjectChip(parsedProjectTitle: typedProjectTitle, projects: projects, projectLocalId: projectId)
                    CriaChip(text: chip.title ?? "Project", systemImage: "folder", tint: Color(.primary))
                }
                QuickAddDateMenu(dueISO: dueISO, onPick: { setDue($0) }, onCustom: { pickerSheet = .date })
                Menu {
                    Picker("Priority", selection: priorityPick) {
                        ForEach(0...5, id: \.self) { Text($0 == 0 ? "No priority" : "Priority \($0)").tag($0) }
                    }
                } label: {
                    CriaChip(text: priority == 0 ? "Priority" : "P\(priority)", systemImage: "flag", tint: Color(.marigold700))
                }
                Button { pickerSheet = .labels } label: {
                    CriaChip(
                        text: labelTitles.isEmpty ? "Labels" : "\(labelTitles.count) label\(labelTitles.count == 1 ? "" : "s")",
                        systemImage: "tag", tint: Color(.meadow700)
                    )
                }
                .buttonStyle(.plain)
                QuickAddReminderMenu(reminders: $reminders, hasDueDate: !dueISO.isEmpty, onCustom: { pickerSheet = .reminder })
            }
        }
    }

    @ViewBuilder private var chips: some View {
        if !labelTitles.isEmpty || parsed.repeatAfter != nil || parsed.repeatMode != nil {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    ForEach(labelTitles, id: \.self) { title in
                        Button { pickerSheet = .labels } label: {
                            CriaChip(text: title, systemImage: "tag", tint: Color(.meadow700))
                        }
                        .buttonStyle(.plain)
                    }
                    if parsed.repeatAfter != nil || parsed.repeatMode != nil {
                        CriaChip(text: "Repeats", systemImage: "repeat", tint: Color(.mutedForeground))
                    }
                }
            }
        }
    }

    /// Picker bindings that mark their field as set by hand, so the typed line stops changing it.
    private var projectPick: Binding<String> {
        Binding(get: { projectId }, set: { projectId = $0; picked.insert(.project) })
    }

    private var priorityPick: Binding<Int> {
        Binding(get: { priority }, set: { priority = $0; picked.insert(.priority) })
    }

    /// Starts on the server's default project, unless the user or a parsed `+project` has already picked another.
    private func adoptServerDefault() async {
        guard let serverId = await services.defaultProjectServerId() else { return }
        let before = baseProjectId
        defaultServerId = serverId
        if !picked.contains(.project), projectId == before || projectId.isEmpty { projectId = baseProjectId }
    }

    private func load() {
        projects = ProjectTree.visible((try? services.store.projects()) ?? [])
        // Offline the server read never answers, so start on the remembered default (Inbox), not the first project.
        if defaultServerId == nil, let remembered = services.rememberedDefaultProjectLocalId() {
            defaultServerId = projects.first { $0.localId == remembered }?.serverId
        }
        projectId = baseProjectId
        if line.isEmpty { line = initialLine }
        if dueISO.isEmpty, let initialDueDate { dueISO = DueDates.allDayISO(for: initialDueDate) }
        focused = true
    }

    /// A date chosen with the picker ("" for no date) wins over a typed one.
    private func setDue(_ iso: String) {
        dueISO = iso
        picked.insert(.due)
    }

    /// Keeps the pickers in step with what the typed line parses to, except fields set by hand.
    private func lineChanged(from old: String, to new: String) {
        let before = parseQuickAddTask(old, mode: mode)
        let after = parseQuickAddTask(new, mode: mode)
        if !picked.contains(.priority) {
            priority = followParsed(priority, before: before.priority, after: after.priority, empty: 0)
        }
        if !picked.contains(.due) {
            dueISO = followParsed(dueISO, before: before.dueDate, after: after.dueDate, empty: "")
        }
        labelTitles = followParsedLabels(labelTitles, before: before.labelTitles, after: after.labelTitles)
        if !picked.contains(.project) {
            let beforeProject = before.projectTitle.flatMap { findProject(titled: $0, in: projects)?.localId }
            let afterProject = after.projectTitle.flatMap { findProject(titled: $0, in: projects)?.localId }
            projectId = followParsed(projectId, before: beforeProject, after: afterProject, empty: baseProjectId)
        }
    }

    private func submit() {
        let result = parsed
        let fields = QuickAddFields(
            dueDate: dueISO.isEmpty ? nil : dueISO, priority: priority,
            repeatAfter: result.repeatAfter, repeatMode: result.repeatMode
        )
        guard let input = buildQuickAddInput(
            title: result.title, projectTitle: typedProjectTitle, projects: projects,
            selectedProjectId: projectId.isEmpty ? nil : projectId, fallbackProjectId: baseProjectId, fields: fields
        ) else {
            errorMessage = "Choose a project first."
            return
        }
        do {
            try services.store.persistQuickAdd(
                input, labelTitles: labelTitles, assigneeUsernames: result.assigneeUsernames, reminders: reminders
            )
            if addAnother { startNext(after: input.title) } else { dismiss() }
        } catch {
            errorMessage = String(describing: error)
        }
    }

    /// Clears the form for the next task, keeping the project, as desktop's add-and-keep-open does.
    private func startNext(after title: String) {
        skipNextFollow = true
        line = ""
        priority = 0
        dueISO = ""
        labelTitles = []
        reminders = []
        picked.subtract([.due, .priority])
        errorMessage = nil
        addedTitle = title
        focused = true
    }
}

/// Which tokens the typed line understands.
private struct QuickAddHint: View {
    var body: some View {
        Text(text).font(Theme.caption).foregroundStyle(Color(.mutedForeground))
    }

    private var text: AttributedString {
        func token(_ text: String, _ tint: Color) -> AttributedString {
            var piece = AttributedString(text)
            piece.font = Theme.caption.bold()
            piece.foregroundColor = tint
            return piece
        }
        var out = AttributedString("Type ")
        out += token("*label", Color(.meadow700))
        out += AttributedString(", ")
        out += token("+project", Color(.primary))
        out += AttributedString(", ")
        out += token("!1–5", Color(.marigold700))
        out += AttributedString(" or a day like ")
        out += token("tomorrow", Color(.sky700))
        out += AttributedString(".")
        return out
    }
}

/// Hands off to Ramble (where the on-device model is offered) or the photo import.
private struct QuickAddAIRow: View {
    var onRamble: (() -> Void)?
    var onPhoto: (() -> Void)?
    let close: () -> Void
    private var aiStatus: AIStatus { AIStatus.shared }

    var body: some View {
        if onPhoto != nil || onRamble != nil {
            Divider()
            HStack(spacing: 10) {
                if let onRamble, aiStatus.isOfferable {
                    aiButton("Ramble", symbol: "mic") { close(); onRamble() }
                }
                if let onPhoto {
                    aiButton("From photo", symbol: "camera") { close(); onPhoto() }
                }
            }
        }
    }

    private func aiButton(_ title: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.system(size: 16, weight: .semibold))
                .frame(maxWidth: .infinity, minHeight: 48)
                .foregroundStyle(Color(.primary))
                .background(Color(.primarySoft), in: Capsule())
        }
        .buttonStyle(.plain)
    }
}
