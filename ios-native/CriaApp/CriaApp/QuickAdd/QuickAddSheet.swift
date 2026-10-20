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
    #if os(macOS)
    /// Set when the sheet is hosted in the Mac quick-add panel, which has no sheet to dismiss: closes the panel.
    var onClose: (() -> Void)?
    #endif
    @Environment(\.dismiss) var dismiss
    @Environment(\.preferences) var preferences
    @Environment(\.dateDisplay) var dateDisplay
    @AppStorage("cria.quickAddMagicMode") private var modeRaw = QuickAddMagicMode.default.rawValue
    @State var line = ""
    @State var projects: [ProjectRecord] = []
    @State var projectId = ""
    /// The server's default (inbox) project: the remembered one at once, then the server's when it answers.
    @State var defaultServerId: Int?
    @State var priority = 0
    @State var dueISO = ""
    @State var labelTitles: [String] = []
    @State var reminders: [QuickAddReminder] = []
    /// Fields set with a picker: the typed line no longer changes them.
    @State var picked: Set<QuickAddField> = []
    @State var pickerSheet: QuickAddPickerSheet?
    @State var addAnother = false
    @State var addedTitle: String?
    /// Clearing the line after "Add another" must not take the project back out with the typed `+project`.
    @State var skipNextFollow = false
    @State var errorMessage: String?
    @FocusState var focused: QuickAddFocus?
    /// Plain-text description, saved as a paragraph.
    @State var note = ""
    /// Height of the field, chips and hint, so the sheet hugs them above the keyboard.
    @State var contentHeight: CGFloat = 260
    /// Multiple mode: Return queues the task and send adds every queued one. Remembered on this device.
    @AppStorage("cria.quickAddMultiple") var multiple = false
    @State var queue: [QueuedQuickAdd] = []
    /// Subtasks typed for the task being added, created under it.
    @State var subtasks: [String] = []
    @State var subtaskLine = ""
    @State var addingSubtask = false
    /// Every label title, for the Mac panel's Labels menu. Loaded off the body.
    @State var allLabelTitles: [String] = []

    private var mode: QuickAddMagicMode { QuickAddMagicMode(rawValue: modeRaw) ?? .default }
    var parsed: QuickAddResult {
        parseQuickAddTask(line, mode: mode, detectDates: preferences.custom.detectDates, defaultDueTime: defaultDueTime)
    }
    /// The account's default due time (Vikunja-web's `default_due_time`), kept in UserDefaults by Settings.
    private var defaultDueTime: DefaultDueTime? { QuickAddDefaults.current().dueTime }
    /// The typed `+project`, unless a project was picked over it.
    var typedProjectTitle: String? { picked.contains(.project) ? nil : parsed.projectTitle }
    var aiStatus: AIStatus { AIStatus.shared }

    var baseProjectId: String {
        pickFallbackProjectId(projects: projects, selectedLocalId: contextProjectId, defaultServerProjectId: defaultServerId) ?? ""
    }

    var body: some View {
        form
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { fitContent($0) }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .presentationDragIndicator(.visible)
        .onAppear(perform: load)
        .onChange(of: line) { old, new in
            // A multi-line field inserts a newline on Return instead of calling onSubmit: strip it and submit.
            if new.contains("\n") {
                line = new.replacingOccurrences(of: "\n", with: "")
                if canSubmit { returnPressed() }
            } else if skipNextFollow {
                skipNextFollow = false
            } else {
                lineChanged(from: old, to: new)
            }
        }
        // Relative reminders follow the due date, so they go when it does.
        .onChange(of: dueISO) { old, new in
            if new.isEmpty { reminders.removeAll { $0.needsDueDate } }
            // Settings > General > Default reminders (Vikunja-web's quick_add_default_reminders): a task that gains a
            // due date gets them, as in Vikunja-web, unless reminders were already chosen. They show in the chip.
            if old.isEmpty, !new.isEmpty, reminders.isEmpty { reminders = QuickAddDefaults.current().reminders }
        }
        .sheet(item: $pickerSheet, onDismiss: { focused = .title }, content: { which in
            QuickAddPickerSheetView(
                which: which, services: services, dueISO: dueISO, labelTitles: $labelTitles, reminders: $reminders,
                onDue: { setDue($0) }
            )
        })
        // One fitted height only: with a taller detent available, iOS moves the sheet up to it as soon as the
        // keyboard opens, which left a screen of empty space above the keyboard.
        .presentationDetents([fittedDetent])
        // Solid, so nothing behind the sheet (the + button's glow, list rows) shows through the glass.
        .presentationBackground(Color(.background))
        // Queued tasks would be lost to a swipe down; send adds them, Clear throws them away.
        .interactiveDismissDisabled(!queue.isEmpty)
        .task { await aiStatus.refresh() }
        .task { await adoptServerDefault() }
    }

    @ViewBuilder private var form: some View {
        #if os(macOS)
        if onClose != nil { panelForm } else { sheetForm }
        #else
        sheetForm
        #endif
    }

    private var sheetForm: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !queue.isEmpty { QuickAddQueueList(queue: $queue) }
            TextField("Task name", text: $line, axis: .vertical)
                .font(.title3.weight(.semibold))
                .focused($focused, equals: .title)
                .submitLabel(multiple ? .next : .done)
                .onSubmit(returnPressed)
            if multiple && queue.isEmpty {
                Text("Return adds it to the list; send adds them all.").font(Theme.caption).foregroundStyle(Color(.mutedForeground))
            }
            TextField("Description", text: $note, axis: .vertical)
                .font(Theme.rowSubtitle)
                .foregroundStyle(Color(.mutedForeground))
                .lineLimit(1...4)
                .focused($focused, equals: .description)
            subtaskSection
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
        #if os(macOS)
        // Bare fields, as in the desktop app: no grey box per field and no focus ring round the one being typed in.
        .textFieldStyle(.plain)
        .focusEffectDisabled()
        #endif
    }

    /// Closes the Mac panel when hosted in one, else dismisses the sheet.
    func closeSheet() {
        #if os(macOS)
        if let onClose {
            onClose()
            return
        }
        #endif
        dismiss()
    }

    /// True when the typed line holds Quick Add Magic tokens, so the preview is worth showing.
    var parsedSomething: Bool {
        parsed.title != line.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The grabber above the content.
    private static let navigationBarAllowance: CGFloat = 16

    private var fittedDetent: PresentationDetent { .height(contentHeight + Self.navigationBarAllowance) }

    /// Follows the content as chips, the preview and a longer description come and go.
    private func fitContent(_ height: CGFloat) {
        guard height > 0, abs(height - contentHeight) > 1 else { return }
        contentHeight = height
    }

    var canSubmit: Bool {
        canSubmitQuickAdd(title: parsed.title, projectTitle: typedProjectTitle, projectLocalId: projectId.isEmpty ? nil : projectId)
    }

    /// Picker bindings that mark their field as set by hand, so the typed line stops changing it.
    var projectPick: Binding<String> {
        Binding(get: { projectId }, set: { projectId = $0; picked.insert(.project) })
    }

    var priorityPick: Binding<Int> {
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
    func setDue(_ iso: String) {
        dueISO = iso
        picked.insert(.due)
    }

    /// Keeps the pickers in step with what the typed line parses to, except fields set by hand.
    private func lineChanged(from old: String, to new: String) {
        let detect = preferences.custom.detectDates
        let before = parseQuickAddTask(old, mode: mode, detectDates: detect, defaultDueTime: defaultDueTime)
        let after = parseQuickAddTask(new, mode: mode, detectDates: detect, defaultDueTime: defaultDueTime)
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
            .macChipMenu()
            .accessibilityLabel("Project")
            Spacer(minLength: 8)
            multipleToggle
            if let onRamble, aiStatus.isOfferable {
                Button { closeSheet(); onRamble() } label: {
                    Image(systemName: "waveform")
                        .font(.body.weight(.semibold))
                        .frame(width: Theme.roundButton, height: Theme.roundButton)
                        .foregroundStyle(Color(.primary))
                        .background(Color(.primarySoft), in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(aiStatus.notReadyMessage != nil)
                .accessibilityLabel("Ramble")
            }
            Button(action: sendPressed) {
                Image(systemName: "arrow.up")
                    .font(.body.weight(.bold))
                    .frame(width: Theme.roundButton, height: Theme.roundButton)
                    .foregroundStyle(Color(.primaryForeground))
                    .background(canSend ? Color(.primary) : Color(.mutedForeground).opacity(0.4), in: Circle())
            }
            .buttonStyle(.plain)
            .disabled(!canSend)
            .accessibilityLabel(sendLabel)
        }
    }

    var addedLine: some View {
        Group {
            if let addedTitle {
                Text(addedTitle).font(Theme.caption).foregroundStyle(Color(.mutedForeground))
            }
        }
    }

    /// One row of compact chips, in the order Settings > Customise > Quick Add sets. Ones left out sit in the •••
    /// menu.
    var pickers: some View {
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
            .macChipMenu()
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
                Button("List from photo", systemImage: "camera") { closeSheet(); onPhoto() }
            }
            Section("Type to set") {
                Text("*label  +project  !1–5  tomorrow 5pm")
                Text("remind day before at 9am")
            }
        } label: {
            CriaChip(text: "•••", tint: Color(.mutedForeground))
        }
        .macChipMenu()
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
}
