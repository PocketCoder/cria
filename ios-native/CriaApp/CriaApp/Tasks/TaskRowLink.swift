import CriaKit
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// A task row that opens the detail screen. Each swipe does what Settings > Customise > Swipe actions says
/// (complete and delete by default). Delete goes straight through with an Undo toast (never a full swipe); failed
/// writes show an alert. While the screen is selecting, the row shows a tick circle instead and a tap toggles it.
struct TaskRowLink: View {
    let services: AppServices
    let item: TaskListItem
    var showProject = false
    var tree = TaskRowTree()
    /// Optional so a row shown inside a sheet (no shell environment) still deletes, without the Undo toast.
    @Environment(UndoCenter.self) private var undo: UndoCenter?
    /// Nil on screens that do not offer multi-select (Search).
    @Environment(TaskSelection.self) private var selection: TaskSelection?
    @Environment(\.preferences) private var preferences
    /// Set by the Mac shell: a tap selects the task for the detail column instead of pushing it.
    @Environment(\.taskOpener) private var openTask
    @State private var failure: String?
    @State private var scheduling = false
    /// Counts completions made from a swipe or the menu; the ring plays its own haptic for a tap.
    @State private var completions = 0
    /// Ticked and waiting to be saved, so the tick, strikethrough and fade show before the row leaves the list.
    @State private var completing = false

    var body: some View {
        Group {
            if let selection, selection.isActive {
                selectableRow(selection)
            } else {
                openableRow
            }
        }
        .sensoryFeedback(.success, trigger: completions)
        .errorHaptic(failure)
        .alert("Could not save", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(failure ?? "")
        }
    }

    private func selectableRow(_ selection: TaskSelection) -> some View {
        let picked = selection.contains(item.task.localId)
        return Button { selection.toggle(item.task.localId) } label: {
            HStack(spacing: 10) {
                Image(systemName: picked ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(picked ? Color(.primary) : Color(.mutedForeground))
                    .accessibilityHidden(true)
                TaskRowView(item: item, showProject: showProject, tree: tree) {}
                    .allowsHitTesting(false)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(picked ? .isSelected : [])
    }

    private var openableRow: some View {
        let swipes = preferences.custom
        return rowLink
        .swipeActions(edge: .leading, allowsFullSwipe: swipes.swipeRight != .delete) { swipeButton(swipes.swipeRight) }
        .swipeActions(edge: .trailing, allowsFullSwipe: swipes.swipeLeft != .delete) { swipeButton(swipes.swipeLeft) }
        .sheet(isPresented: $scheduling) {
            DateSheet(
                title: "Date", iso: item.task.dueDate,
                repeatValue: RepeatValue(after: item.task.repeatAfter, mode: item.task.repeatMode)
            ) { iso, chosen in schedule(iso, repeatValue: chosen) }
        }
        .contextMenu { menuItems } preview: {
            TaskRowView(item: item, showProject: true) {}
                .padding()
                .frame(width: 360)
                .background(Color(.cell))
        }
        .accessibilityActions {
            // Swipe actions reach VoiceOver on their own; these are the context-menu-only ones.
            Button("Due tomorrow") { dueTomorrow() }
            ForEach(DeferPreset.allCases, id: \.self) { preset in
                Button("Defer: \(preset.title)") { deferTask(preset) }
            }
            Button("Duplicate") { duplicate() }
            if services.taskWebURL(item.task) != nil { Button("Copy link") { copyLink() } }
            if let selection { Button("Select") { selection.start(with: item.task.localId) } }
            if let collapsed = tree.isCollapsed {
                Button(collapsed ? "Show subtasks" : "Hide subtasks") { tree.onToggleCollapsed() }
            }
        }
    }

    @ViewBuilder private var rowLink: some View {
        if let openTask {
            Button { click(openTask) } label: {
                TaskRowView(item: item, showProject: showProject, tree: tree, completing: completing) { toggle() }
            }
            .buttonStyle(.plain)
            .modifier(PanelRowHighlight(taskLocalId: item.task.localId))
        } else {
            NavigationLink(value: Route.task(item.task.localId)) {
                TaskRowView(item: item, showProject: showProject, tree: tree, completing: completing) { toggle() }
            }
        }
    }

    /// A plain click opens the task; ⌘ or ⇧ with a click starts multi-select with this row ticked.
    private func click(_ open: @MainActor (String) -> Void) {
        if PlatformApp.extendsSelection, let selection {
            selection.start(with: item.task.localId)
        } else {
            open(item.task.localId)
        }
    }

    @ViewBuilder private var menuItems: some View {
        Button(item.task.done ? "Mark as not done" : "Complete", systemImage: "checkmark.circle") { toggleWithHaptic() }
        Button(item.task.isFavorite ? "Unstar" : "Star", systemImage: "star") { toggleStar() }
        Button("Due tomorrow", systemImage: "sunrise") { dueTomorrow() }
        Button("Schedule…", systemImage: "calendar") { scheduling = true }
        Menu("Defer", systemImage: "clock.arrow.circlepath") {
            ForEach(DeferPreset.allCases, id: \.self) { preset in
                Button(preset.title) { deferTask(preset) }
            }
        }
        if let collapsed = tree.isCollapsed {
            Button(collapsed ? "Show subtasks" : "Hide subtasks", systemImage: "list.bullet.indent") {
                tree.onToggleCollapsed()
            }
        }
        Divider()
        Button("Duplicate", systemImage: "plus.square.on.square") { duplicate() }
        // A task that has not synced has no web address yet.
        Button("Copy link", systemImage: "link") { copyLink() }
            .disabled(services.taskWebURL(item.task) == nil)
        if let selection {
            Button("Select", systemImage: "checkmark.circle") { selection.start(with: item.task.localId) }
        }
        Divider()
        Button("Delete", systemImage: "trash", role: .destructive) { delete() }
    }

    @ViewBuilder
    private func swipeButton(_ action: SwipeAction) -> some View {
        switch action {
        case .none:
            EmptyView()
        case .complete:
            // Swipe buttons show only the icon; the title is what VoiceOver offers as the row's action.
            Button(item.task.done ? "Mark not done" : "Complete", systemImage: "checkmark") { toggleWithHaptic() }
                .tint(Color(.meadow500))
        case .schedule:
            Button("Schedule", systemImage: "calendar") { scheduling = true }
                .tint(Color(.sky500))
        case .star:
            Button(item.task.isFavorite ? "Unstar" : "Star", systemImage: "star") { toggleStar() }
                .tint(Color(.marigold500))
        case .delete:
            // Not `.destructive`: that role animates the row away before the write, even when it fails.
            Button("Delete", systemImage: "trash") { delete() }
                .tint(Color(.destructive))
        }
    }
}

/// The Mac row's hover and open-task highlight. A modifier with its own state, so hovering a row or opening a task
/// redraws this background, not the row it sits behind.
private struct PanelRowHighlight: ViewModifier {
    let taskLocalId: String
    @Environment(\.openTaskState) private var openTask
    @State private var hovering = false

    func body(content: Content) -> some View {
        content
            .padding(.horizontal, 6)
            .background(RoundedRectangle(cornerRadius: 6).fill(fill))
            .onHover { hovering = $0 }
    }

    private var fill: Color {
        if openTask?.id == taskLocalId { return Color.accentColor.opacity(0.16) }
        return hovering ? Color.primary.opacity(0.06) : .clear
    }
}

// MARK: Actions

extension TaskRowLink {
    private func schedule(_ iso: String, repeatValue: RepeatValue?) {
        var patch = TaskPatch(dueDate: iso)
        if let repeatValue, repeatValue != RepeatValue(after: item.task.repeatAfter, mode: item.task.repeatMode) {
            patch.repeatAfter = repeatValue.after
            patch.repeatMode = repeatValue.mode
        }
        attempt { _ = try services.store.updateTask(localId: item.task.localId, patch: patch) }
    }

    private func attempt(_ work: () throws -> Void) {
        do {
            try work()
        } catch {
            failure = String(describing: error)
        }
    }

    private func delete() {
        attempt {
            if let undo {
                try undo.deleteTask(localId: item.task.localId, title: item.task.title)
            } else {
                try services.store.deleteTask(localId: item.task.localId)
            }
        }
    }

    private func toggleStar() {
        let patch = TaskPatch(isFavorite: !item.task.isFavorite)
        attempt { _ = try services.store.updateTask(localId: item.task.localId, patch: patch) }
    }

    private func dueTomorrow() {
        let day = Calendar.cria.date(byAdding: .day, value: 1, to: Date()) ?? Date()
        let patch = TaskPatch(dueDate: DueDates.allDayISO(for: day))
        attempt { _ = try services.store.updateTask(localId: item.task.localId, patch: patch) }
    }

    /// Undoing a done task saves at once. Completing shows the done state first and saves after a beat, so the
    /// burst and the strikethrough are seen before the row leaves a list of open tasks.
    private func toggle() {
        let localId = item.task.localId
        guard !item.task.done else {
            completing = false
            attempt { _ = try services.store.updateTask(localId: localId, patch: TaskPatch(done: false)) }
            return
        }
        guard !completing else { return }
        completing = true
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(900))
            attempt { _ = try services.store.updateTask(localId: localId, patch: TaskPatch(done: true)) }
            if failure != nil { withAnimation { completing = false } }
        }
    }

    /// For the swipe and the menu, which have no ring to play the completion haptic. Completing only, as the ring does.
    private func toggleWithHaptic() {
        if !item.task.done { completions += 1 }
        toggle()
    }

    /// Moves the due date on by the preset, counting from the later of the current date and today.
    private func deferTask(_ preset: DeferPreset) {
        let patch = TaskPatch(dueDate: preset.dueDate(from: item.task.dueDate))
        attempt { _ = try services.store.updateTask(localId: item.task.localId, patch: patch) }
    }

    private func duplicate() {
        attempt { _ = try services.store.duplicateTask(localId: item.task.localId) }
    }

    private func copyLink() {
        guard let url = services.taskWebURL(item.task) else { return }
        Pasteboard.copy(url.absoluteString)
        Haptics.success()
    }
}
