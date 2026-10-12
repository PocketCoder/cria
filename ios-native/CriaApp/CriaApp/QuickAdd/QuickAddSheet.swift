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
    @Environment(\.preferences) private var preferences
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
    @FocusState private var focused: QuickAddFocus?
    /// Plain-text description, saved as a paragraph.
    @State private var note = ""
    /// Height of the field, chips and hint, so the sheet hugs them above the keyboard.
    @State private var contentHeight: CGFloat = 260
    @State private var detent: PresentationDetent = .height(260 + QuickAddSheet.navigationBarAllowance)

    private var mode: QuickAddMagicMode { QuickAddMagicMode(rawValue: modeRaw) ?? .default }
    private var parsed: QuickAddResult { parseQuickAddTask(line, mode: mode, detectDates: preferences.custom.detectDates) }
    /// The typed `+project`, unless a project was picked over it.
    private var typedProjectTitle: String? { picked.contains(.project) ? nil : parsed.projectTitle }
    private var aiStatus: AIStatus { AIStatus.shared }

    private var baseProjectId: String {
        pickFallbackProjectId(projects: projects, selectedLocalId: contextProjectId, defaultServerProjectId: defaultServerId) ?? ""
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            TextField("Task name", text: $line, axis: .vertical)
                .font(.title3.weight(.semibold))
                .focused($focused, equals: .title)
                .submitLabel(.done)
                .onSubmit(submit)
            TextField("Description", text: $note, axis: .vertical)
                .font(Theme.rowSubtitle)
                .foregroundStyle(Color(.mutedForeground))
                .lineLimit(1...4)
                .focused($focused, equals: .description)
            if !line.isEmpty && parsedSomething {
                Text(QuickAddPreview.highlighted(parsed, overridden: picked)).font(Theme.caption)
            }
            pickers
            addedLine
            if let errorMessage {
                Text(errorMessage).foregroundStyle(Color(.destructive)).font(Theme.caption)
            }
            Divider().padding(.horizontal, -16)
            bottomBar
        }
        .padding(.horizontal, 16)
        .padding(.top, 20)
        .padding(.bottom, 10)
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { fitContent($0) }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .presentationDragIndicator(.visible)
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
        .sheet(item: $pickerSheet, onDismiss: { focused = .title }, content: { which in
            QuickAddPickerSheetView(
                which: which, services: services, dueISO: dueISO, labelTitles: $labelTitles, reminders: $reminders,
                onDue: { setDue($0) }
            )
        })
        .presentationDetents([fittedDetent, .large], selection: $detent)
        .task { await aiStatus.refresh() }
        .task { await adoptServerDefault() }
    }

    /// True when the typed line holds Quick Add Magic tokens, so the preview is worth showing.
    private var parsedSomething: Bool {
        parsed.title != line.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The grabber above the content.
    private static let navigationBarAllowance: CGFloat = 16

    private var fittedDetent: PresentationDetent { .height(contentHeight + Self.navigationBarAllowance) }

    /// Follows the content as chips and the preview come and go, unless the sheet was pulled up to full height.
    private func fitContent(_ height: CGFloat) {
        guard height > 0, abs(height - contentHeight) > 1 else { return }
        let wasFitted = detent != .large
        contentHeight = height
        if wasFitted { detent = fittedDetent }
    }

    private var canSubmit: Bool {
        canSubmitQuickAdd(title: parsed.title, projectTitle: typedProjectTitle, projectLocalId: projectId.isEmpty ? nil : projectId)
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
        focused = .title
    }

    /// A date chosen with the picker ("" for no date) wins over a typed one.
    private func setDue(_ iso: String) {
        dueISO = iso
        picked.insert(.due)
    }

    /// Keeps the pickers in step with what the typed line parses to, except fields set by hand.
    private func lineChanged(from old: String, to new: String) {
        let before = parseQuickAddTask(old, mode: mode, detectDates: preferences.custom.detectDates)
        let after = parseQuickAddTask(new, mode: mode, detectDates: preferences.custom.detectDates)
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
        guard let built = buildQuickAddInput(
            title: result.title, projectTitle: typedProjectTitle, projects: projects,
            selectedProjectId: projectId.isEmpty ? nil : projectId, fallbackProjectId: baseProjectId, fields: fields
        ) else {
            errorMessage = "Choose a project first."
            return
        }
        var input = built
        let description = note.trimmingCharacters(in: .whitespacesAndNewlines)
        if !description.isEmpty { input.description = Self.paragraphHTML(description) }
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
        note = ""
        addedTitle = title
        focused = .title
    }
}

extension QuickAddSheet {
    /// Project on the left; Ramble and send on the right, as in Todoist's add sheet.
    private var bottomBar: some View {
        HStack(spacing: 12) {
            Menu {
                Picker("Project", selection: projectPick) {
                    ForEach(projects, id: \.localId) { Text($0.title).tag($0.localId) }
                }
            } label: {
                let chip = resolveProjectChip(parsedProjectTitle: typedProjectTitle, projects: projects, projectLocalId: projectId)
                HStack(spacing: 6) {
                    Image(systemName: "tray").imageScale(.small)
                    Text(chip.title ?? "Project").lineLimit(1)
                    Image(systemName: "chevron.down").imageScale(.small).foregroundStyle(Color(.mutedForeground))
                }
                .font(Theme.rowSubtitle.weight(.medium))
                .foregroundStyle(Color(.foreground))
            }
            .accessibilityLabel("Project")
            Spacer(minLength: 8)
            if let onRamble, aiStatus.isOfferable {
                Button { dismiss(); onRamble() } label: {
                    Image(systemName: "waveform")
                        .font(.body.weight(.semibold))
                        .frame(width: 40, height: 40)
                        .foregroundStyle(Color(.primary))
                        .background(Color(.primarySoft), in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(aiStatus.notReadyMessage != nil)
                .accessibilityLabel("Ramble")
            }
            Button(action: submit) {
                Image(systemName: "arrow.up")
                    .font(.body.weight(.bold))
                    .frame(width: 40, height: 40)
                    .foregroundStyle(Color(.primaryForeground))
                    .background(canSubmit ? Color(.primary) : Color(.mutedForeground).opacity(0.4), in: Circle())
            }
            .buttonStyle(.plain)
            .disabled(!canSubmit)
            .accessibilityLabel(addAnother ? "Add and keep open" : "Add task")
        }
    }

    private var addedLine: some View {
        Group {
            if let addedTitle {
                Text("Added ‘\(addedTitle)’").font(Theme.caption).foregroundStyle(Color(.mutedForeground))
            }
        }
    }

    /// One row of compact chips, in the order Settings > Customise > Quick Add sets. Ones left out sit in the •••
    /// menu.
    private var pickers: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(preferences.custom.quickAddActions) { chip($0) }
                if parsed.repeatAfter != nil || parsed.repeatMode != nil {
                    CriaChip(text: "Repeats", systemImage: "repeat", tint: Color(.mutedForeground))
                }
                moreMenu
            }
            .padding(.vertical, 2)
        }
    }

    @ViewBuilder
    private func chip(_ action: QuickAddAction) -> some View {
        let showsLabels = preferences.custom.quickAddShowsLabels
        switch action {
        case .date:
            QuickAddDateChip(dueISO: dueISO, showsLabel: showsLabels) { pickerSheet = .date }
        case .priority:
            Menu {
                Picker("Priority", selection: priorityPick) {
                    ForEach(0...5, id: \.self) { Text($0 == 0 ? "No priority" : "Priority \($0)").tag($0) }
                }
            } label: {
                CriaChip(
                    text: priority == 0 ? (showsLabels ? "Priority" : "") : "P\(priority)",
                    systemImage: "flag", tint: Color(.marigold700)
                )
            }
            .accessibilityLabel("Priority")
        case .reminders:
            QuickAddReminderMenu(
                reminders: $reminders, hasDueDate: !dueISO.isEmpty, showsLabel: showsLabels, onCustom: { pickerSheet = .reminder }
            )
        case .labels:
            Button { pickerSheet = .labels } label: {
                CriaChip(
                    text: labelTitles.isEmpty ? (showsLabels ? "Labels" : "") : labelTitles.joined(separator: ", "),
                    systemImage: "tag", tint: Color(.meadow700)
                )
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Labels")
        }
    }

    private var moreMenu: some View {
        Menu {
            let hidden = QuickAddAction.allCases.filter { !preferences.custom.quickAddActions.contains($0) }
            if !hidden.isEmpty {
                Section {
                    ForEach(hidden) { hiddenAction($0) }
                }
            }
            Toggle("Keep open after adding", isOn: $addAnother)
            if let onPhoto {
                Button("List from photo", systemImage: "camera") { dismiss(); onPhoto() }
            }
            Section("Type to set") {
                Text("*label  +project  !1–5  tomorrow 5pm")
            }
        } label: {
            CriaChip(text: "•••", tint: Color(.mutedForeground))
        }
        .accessibilityLabel("More options")
    }

    @ViewBuilder
    private func hiddenAction(_ action: QuickAddAction) -> some View {
        switch action {
        case .date:
            Button("Date", systemImage: "calendar") { pickerSheet = .date }
        case .priority:
            Picker(selection: priorityPick) {
                ForEach(0...5, id: \.self) { Text($0 == 0 ? "No priority" : "Priority \($0)").tag($0) }
            } label: {
                Label("Priority", systemImage: "flag")
            }
            .pickerStyle(.menu)
        case .reminders:
            Button("Reminder", systemImage: "bell") { pickerSheet = .reminder }
        case .labels:
            Button("Labels", systemImage: "tag") { pickerSheet = .labels }
        }
    }

    /// Plain text as a paragraph, escaped, with line breaks kept.
    static func paragraphHTML(_ text: String) -> String {
        let escaped = text
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\n", with: "<br>")
        return "<p>\(escaped)</p>"
    }
}

enum QuickAddFocus: Hashable {
    case title, description
}
