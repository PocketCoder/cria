import CriaKit
import SwiftUI

/// Quick add: one line of text with Quick Add Magic, a live preview, and pickers that stay in step with the
/// parsed tokens (`followParsed`). Creates the task through the store, so it is saved locally at once.
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
    @State private var priority = 0
    @State private var dueISO = ""
    @State private var labelTitles: [String] = []
    @State private var errorMessage: String?
    @FocusState private var focused: Bool

    private var mode: QuickAddMagicMode { QuickAddMagicMode(rawValue: modeRaw) ?? .default }
    private var parsed: QuickAddResult { parseQuickAddTask(line, mode: mode) }
    private var aiStatus: AIStatus { AIStatus.shared }

    private var baseProjectId: String {
        pickFallbackProjectId(projects: projects, selectedLocalId: contextProjectId, defaultServerProjectId: nil) ?? ""
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
                    Text(QuickAddPreview.highlighted(parsed)).font(Theme.rowTitle)
                }
                pickers
                chips
                if let errorMessage {
                    Text(errorMessage).foregroundStyle(Color(.destructive)).font(Theme.caption)
                }
                hint
                aiRow
            }
            .padding()
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
            .onChange(of: line) { old, new in lineChanged(from: old, to: new) }
        }
        .presentationDetents([.medium, .large])
        .task { await aiStatus.refresh() }
    }

    private var hint: some View {
        Text(hintText).font(Theme.caption).foregroundStyle(Color(.mutedForeground))
    }

    private var hintText: AttributedString {
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

    @ViewBuilder private var aiRow: some View {
        if onPhoto != nil || onRamble != nil {
            Divider()
            HStack(spacing: 10) {
                if let onRamble, aiStatus.isOfferable {
                    aiButton("Ramble", symbol: "mic") { dismiss(); onRamble() }
                }
                if let onPhoto {
                    aiButton("From photo", symbol: "camera") { dismiss(); onPhoto() }
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

    private var canSubmit: Bool {
        canSubmitQuickAdd(title: parsed.title, projectTitle: parsed.projectTitle, projectLocalId: projectId.isEmpty ? nil : projectId)
    }

    private var pickers: some View {
        ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 8) {
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
                CriaChip(text: priority == 0 ? "Priority" : "P\(priority)", systemImage: "flag", tint: Color(.marigold700))
            }
            Menu {
                Button("Today") { setDue(daysFromNow: 0) }
                Button("Tomorrow") { setDue(daysFromNow: 1) }
                Button("Next week") { setDue(daysFromNow: 7) }
                Button("No date", role: .destructive) { dueISO = "" }
            } label: {
                CriaChip(text: dueISO.isEmpty ? "Due" : DueDates.label(dueISO, now: Date()), systemImage: "calendar", tint: Color(.sky700))
            }
        }
        }
    }

    @ViewBuilder private var chips: some View {
        if !labelTitles.isEmpty || parsed.repeatAfter != nil || parsed.repeatMode != nil {
            HStack {
                ForEach(labelTitles, id: \.self) { CriaChip(text: $0, systemImage: "tag", tint: Color(.meadow700)) }
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
        if dueISO.isEmpty, let initialDueDate { dueISO = DueDates.allDayISO(for: initialDueDate) }
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
        case .date: return Color(.sky700)
        case .priority: return Color(.marigold700)
        case .label: return Color(.meadow700)
        case .assignee: return Color(.primary)
        case .project: return Color(.primary)
        case .recurrence: return Color(.mutedForeground)
        }
    }
}

/// Quick add shows the Ramble or photo sheet in its place, so the parent holds all three.
private enum AddSheet: Identifiable {
    case quickAdd, ramble, photo
    var id: Int { hashValue }
}

/// Adds the floating + button that opens quick add, for the screens that list tasks.
struct QuickAddButton: ViewModifier {
    let services: AppServices
    var contextProjectId: String?
    @State private var sheet: AddSheet?

    func body(content: Content) -> some View {
        content
            .criaFab { sheet = .quickAdd }
            .sheet(item: $sheet) { which in
                switch which {
                case .quickAdd:
                    QuickAddSheet(
                        services: services, contextProjectId: contextProjectId,
                        onRamble: { handOff(.ramble) }, onPhoto: { handOff(.photo) }
                    )
                case .ramble:
                    RambleSheet(services: services)
                case .photo:
                    ShoppingPhotoSheet(services: services)
                }
            }
    }

    /// Present the next sheet after the current one has gone, or SwiftUI drops the request.
    private func handOff(_ next: AddSheet) {
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(400))
            sheet = next
        }
    }
}

extension View {
    func quickAdd(services: AppServices, contextProjectId: String? = nil) -> some View {
        modifier(QuickAddButton(services: services, contextProjectId: contextProjectId))
    }
}
