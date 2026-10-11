import CriaKit
import SwiftUI

/// Quick add: one line of text with Quick Add Magic, a live preview, and pickers that stay in step with the
/// parsed tokens (`followParsed`). Creates the task through the store, so it is saved locally at once.
struct QuickAddSheet: View {
    let services: AppServices
    let contextProjectId: String?
    /// Text to start with, e.g. from a `cria://add?title=` link.
    var initialLine = ""
    @Environment(\.dismiss) private var dismiss
    @AppStorage("cria.quickAddMagicMode") private var modeRaw = QuickAddMagicMode.default.rawValue
    @State private var line = ""
    @State private var projects: [ProjectRecord] = []
    @State private var projectId = ""
    @State private var priority = 0
    @State private var dueISO = ""
    @State private var labelTitles: [String] = []
    @State private var errorMessage: String?
    @FocusState private var focused: Bool

    private var mode: QuickAddMagicMode { QuickAddMagicMode(rawValue: modeRaw) ?? .default }
    private var parsed: QuickAddResult { parseQuickAddTask(line, mode: mode) }

    private var baseProjectId: String {
        pickFallbackProjectId(projects: projects, selectedLocalId: contextProjectId, defaultServerProjectId: nil) ?? ""
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 12) {
                TextField("Buy milk tomorrow *errands !2", text: $line, axis: .vertical)
                    .font(Theme.title)
                    .focused($focused)
                    .submitLabel(.done)
                    .onSubmit(submit)
                if !line.isEmpty {
                    Text(QuickAddPreview.highlighted(parsed)).font(Theme.rowTitle)
                }
                pickers
                chips
                if let errorMessage {
                    Text(errorMessage).foregroundStyle(Color(.destructive)).font(Theme.caption)
                }
                Spacer()
            }
            .padding()
            .navigationTitle("New task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Add", action: submit).disabled(!canSubmit) }
            }
            .onAppear(perform: load)
            .onChange(of: line) { old, new in lineChanged(from: old, to: new) }
        }
        .presentationDetents([.medium, .large])
    }

    private var canSubmit: Bool {
        canSubmitQuickAdd(title: parsed.title, projectTitle: parsed.projectTitle, projectLocalId: projectId.isEmpty ? nil : projectId)
    }

    private var pickers: some View {
        HStack {
            Menu {
                Picker("Project", selection: $projectId) {
                    ForEach(projects, id: \.localId) { Text($0.title).tag($0.localId) }
                }
            } label: {
                let chip = resolveProjectChip(parsedProjectTitle: parsed.projectTitle, projects: projects, projectLocalId: projectId)
                CriaChip(text: chip.title ?? "Project", systemImage: "folder", tint: Color(.primary))
            }
            Menu {
                Picker("Priority", selection: $priority) {
                    ForEach(0...5, id: \.self) { Text($0 == 0 ? "No priority" : "Priority \($0)").tag($0) }
                }
            } label: {
                CriaChip(text: priority == 0 ? "Priority" : "P\(priority)", systemImage: "flag", tint: Color(.warning))
            }
            Menu {
                Button("Today") { setDue(daysFromNow: 0) }
                Button("Tomorrow") { setDue(daysFromNow: 1) }
                Button("Next week") { setDue(daysFromNow: 7) }
                Button("No date", role: .destructive) { dueISO = "" }
            } label: {
                CriaChip(text: dueISO.isEmpty ? "Due" : DueDates.label(dueISO, now: Date()), systemImage: "calendar", tint: Color(.info))
            }
        }
    }

    @ViewBuilder private var chips: some View {
        if !labelTitles.isEmpty || parsed.repeatAfter != nil || parsed.repeatMode != nil {
            HStack {
                ForEach(labelTitles, id: \.self) { CriaChip(text: $0, systemImage: "tag", tint: Color(.success)) }
                if parsed.repeatAfter != nil || parsed.repeatMode != nil {
                    CriaChip(text: "Repeats", systemImage: "repeat", tint: Color(.mutedForeground))
                }
            }
        }
    }

    private func load() {
        projects = ProjectTree.visible((try? services.store.projects()) ?? [])
        projectId = baseProjectId
        if line.isEmpty { line = initialLine }
        focused = true
    }

    private func setDue(daysFromNow: Int) {
        let day = Calendar.current.date(byAdding: .day, value: daysFromNow, to: Date()) ?? Date()
        dueISO = DueDates.allDayISO(for: day)
    }

    /// Keeps the pickers in step with what the typed line parses to.
    private func lineChanged(from old: String, to new: String) {
        let before = parseQuickAddTask(old, mode: mode)
        let after = parseQuickAddTask(new, mode: mode)
        priority = followParsed(priority, before: before.priority, after: after.priority, empty: 0)
        dueISO = followParsed(dueISO, before: before.dueDate, after: after.dueDate, empty: "")
        labelTitles = followParsedLabels(labelTitles, before: before.labelTitles, after: after.labelTitles)
        let beforeProject = before.projectTitle.flatMap { findProject(titled: $0, in: projects)?.localId }
        let afterProject = after.projectTitle.flatMap { findProject(titled: $0, in: projects)?.localId }
        projectId = followParsed(projectId, before: beforeProject, after: afterProject, empty: baseProjectId)
    }

    private func submit() {
        let result = parsed
        let fields = QuickAddFields(
            dueDate: dueISO.isEmpty ? nil : dueISO, priority: priority,
            repeatAfter: result.repeatAfter, repeatMode: result.repeatMode
        )
        guard let input = buildQuickAddInput(
            title: result.title, projectTitle: result.projectTitle, projects: projects,
            selectedProjectId: projectId.isEmpty ? nil : projectId, fallbackProjectId: baseProjectId, fields: fields
        ) else {
            errorMessage = "Choose a project first."
            return
        }
        do {
            try services.store.persistQuickAdd(
                input, labelTitles: labelTitles, assigneeUsernames: parsed.assigneeUsernames
            )
            dismiss()
        } catch {
            errorMessage = String(describing: error)
        }
    }
}

/// Colours the typed line by what each part became.
enum QuickAddPreview {
    static func highlighted(_ result: QuickAddResult) -> AttributedString {
        var output = AttributedString()
        for token in result.tokens {
            var piece = AttributedString(token.text)
            if let tint = tint(for: token.kind) {
                piece.foregroundColor = tint
                piece.font = Theme.rowTitle.weight(.semibold)
            }
            output += piece
        }
        return output
    }

    private static func tint(for kind: QuickAddTokenKind) -> Color? {
        switch kind {
        case .text: return nil
        case .date: return Color(.info)
        case .priority: return Color(.warning)
        case .label: return Color(.success)
        case .assignee: return Color(.primary)
        case .project: return Color(.primary)
        case .recurrence: return Color(.mutedForeground)
        }
    }
}

/// Adds the floating + button that opens quick add, for the screens that list tasks.
struct QuickAddButton: ViewModifier {
    let services: AppServices
    var contextProjectId: String?
    @State private var isPresented = false

    func body(content: Content) -> some View {
        content
            .criaFab { isPresented = true }
            .sheet(isPresented: $isPresented) {
                QuickAddSheet(services: services, contextProjectId: contextProjectId)
            }
    }
}

extension View {
    func quickAdd(services: AppServices, contextProjectId: String? = nil) -> some View {
        modifier(QuickAddButton(services: services, contextProjectId: contextProjectId))
    }
}
