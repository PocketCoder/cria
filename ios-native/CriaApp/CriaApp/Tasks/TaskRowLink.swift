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
    /// Double-click (or Rename in the menu) on the Mac: the title is a field until Return, Esc or a click elsewhere.
    @State private var renaming = false
    @State private var draftTitle = ""
    #if os(macOS)
    /// The screen's completed rows, which stay struck through until the screen goes, and the section this row is in.
    @Environment(\.recentlyCompleted) private var recent
    @Environment(\.completionGroup) private var group
    #endif

    /// Shown done: just ticked, or (on the Mac) completed on this screen and kept in place.
    private var showsCompleting: Bool {
        #if os(macOS)
        if recent?.contains(item.task.localId) == true { return true }
        #endif
        return completing
    }

    var body: some View {
        Group {
            if let selection, selection.isActive {
                selectableRow(selection)
            } else {
                openableRow
            }
        }
        .sensoryFeedback(.success, trigger: completions)
        #if os(macOS)
        // Undo (the toast or ⌘Z) reopened a task this screen kept struck through: let the row show it open again.
        .onChange(of: item.task.done) { _, done in
            if !done { recent?.forget(item.task.localId) }
        }
        #endif
        #if os(macOS)
        // One look in every list (Today, Inbox, projects, labels, search): no separators, which the Mac draws from the
        // title rather than the ring, and the same insets, with room for the open and hover washes.
        .listRowSeparator(.hidden)
        .listRowInsets(EdgeInsets(top: 1, leading: 10, bottom: 1, trailing: 10))
        #endif
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
            #if os(macOS)
            if renaming {
                // No button around the field, so clicks in it place the caret rather than open the task.
                TaskRowView(
                    item: item, showProject: showProject, tree: tree, completing: showsCompleting,
                    rename: RowRename(text: $draftTitle, commit: commitRename, cancel: { renaming = false })
                ) { toggle() }
                .modifier(PanelRowHighlight(taskLocalId: item.task.localId))
            } else {
                openButton(openTask)
                    // Alongside the button, so a single click still opens the task at once.
                    .simultaneousGesture(TapGesture(count: 2).onEnded { startRename() })
            }
            #else
            openButton(openTask)
            #endif
        } else {
            NavigationLink(value: Route.task(item.task.localId)) {
                TaskRowView(item: item, showProject: showProject, tree: tree, completing: showsCompleting) { toggle() }
            }
        }
    }

    private func openButton(_ openTask: @escaping @MainActor (String) -> Void) -> some View {
        Button { click(openTask) } label: {
            TaskRowView(item: item, showProject: showProject, tree: tree, completing: showsCompleting) { toggle() }
        }
        .buttonStyle(.plain)
        .modifier(PanelRowHighlight(taskLocalId: item.task.localId))
        #if os(macOS)
        .modifier(TaskHoverPreview(item: item))
        // Onto a sidebar project to move it there (MacProjectLabel); the same payload as a Kanban card's.
        .draggable(KanbanPayload.make(item.task.localId))
        #endif
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
        #if os(macOS)
        macMenuItems
        #else
        iosMenuItems
        #endif
    }

    @ViewBuilder private var iosMenuItems: some View {
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

#if os(macOS)
// MARK: Mac menu

extension TaskRowLink {
    /// Open, for the menu; nil where rows push instead (no opener), which leaves Open out.
    fileprivate var macOpenAction: (@MainActor () -> Void)? {
        guard let openTask else { return nil }
        let localId = item.task.localId
        return { openTask(localId) }
    }

    /// The Mac task menu from the design handoff: done and open, the date, priority, label and project submenus, then
    /// favourite, link, duplicate and delete. Every item runs the same action as the iOS menu.
    @ViewBuilder fileprivate var macMenuItems: some View {
        TaskMacMenuItems(
            services: services, task: item.task, labels: item.labels, onOpen: macOpenAction,
            onToggleDone: { toggleWithHaptic() }, onPickDate: { scheduling = true }, onDuplicate: { duplicate() },
            onCopyLink: { copyLink() }, onDelete: { delete() }, onFailure: { failure = $0 }
        )
    }
}
#endif

// MARK: Actions

extension TaskRowLink {
    private func schedule(_ iso: String, repeatValue: RepeatValue?) {
        var patch = TaskPatch(dueDate: iso)
        if let repeatValue, repeatValue != RepeatValue(after: item.task.repeatAfter, mode: item.task.repeatMode) {
            patch.repeatAfter = repeatValue.after
            patch.repeatMode = repeatValue.mode
        }
        attempt { try undo.updateTask(services, localId: item.task.localId, patch: patch) }
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
        attempt { try undo.updateTask(services, localId: item.task.localId, patch: patch) }
    }

    private func dueTomorrow() {
        let day = Calendar.cria.date(byAdding: .day, value: 1, to: Date()) ?? Date()
        let patch = TaskPatch(dueDate: DueDates.allDayISO(for: day))
        attempt { try undo.updateTask(services, localId: item.task.localId, patch: patch) }
    }

    /// Undoing a done task saves at once. Completing shows the done state first and saves after a beat, so the
    /// burst and the strikethrough are seen before the row leaves a list of open tasks.
    private func toggle() {
        let localId = item.task.localId
        #if os(macOS)
        // A row kept after completing still holds the open snapshot: unticking it reopens the task.
        if let recent, recent.contains(localId) {
            recent.forget(localId)
            completing = false
            attempt { try undo.updateTask(services, localId: localId, patch: TaskPatch(done: false)) }
            return
        }
        #endif
        guard !item.task.done else {
            completing = false
            attempt { try undo.updateTask(services, localId: localId, patch: TaskPatch(done: false)) }
            return
        }
        guard !completing else { return }
        completing = true
        #if os(macOS)
        // Kept on screen once saved; the save waits only for the burst (60ms in, 560ms long).
        recent?.record(item, group: group)
        let delay = recent == nil ? 900 : 620
        #else
        let delay = 900
        #endif
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(delay))
            attempt { try undo.updateTask(services, localId: localId, patch: TaskPatch(done: true)) }
            if failure != nil {
                #if os(macOS)
                recent?.forget(localId)
                #endif
                withAnimation { completing = false }
            }
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
        attempt { try undo.updateTask(services, localId: item.task.localId, patch: patch) }
    }

    private func startRename() {
        draftTitle = item.task.title
        renaming = true
    }

    /// Saves a changed, non-empty title; an emptied field keeps the old one.
    private func commitRename() {
        renaming = false
        let title = draftTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty, title != item.task.title else { return }
        attempt { _ = try services.store.updateTask(localId: item.task.localId, patch: TaskPatch(title: title)) }
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
