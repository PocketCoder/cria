import CriaKit
import KeyboardShortcuts
import SwiftUI

/// The menu bar extra: today's open tasks with rings to complete them, a field that adds to Inbox due today, then New
/// Task, Open Cria, Settings and Quit.
struct MacMenuBarContent: View {
    let model: AppModel
    /// The configured global shortcut (Settings > General), read when the popover opens.
    @State private var quickAddShortcut: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let services = model.services {
                MacTodayList(services: services)
            } else {
                Text("Today").font(.custom(Theme.brandFont, size: 17)).tracking(-0.34).padding(.horizontal, 6)
                Text("Sign in to see today's tasks.")
                    .font(.system(size: 13))
                    .foregroundStyle(MacTheme.label2)
                    .padding(.horizontal, 6)
            }
            Divider().padding(.vertical, 2)
            VStack(alignment: .leading, spacing: 0) {
                MenuBarItem(title: "New Task…", shortcut: quickAddShortcut) { MacWindows.requestQuickAdd() }
                    .disabled(model.services == nil)
                MenuBarItem(title: "Open Cria") { MacWindows.showMain() }
                SettingsLink { MenuBarItemLabel(title: "Settings…", shortcut: "⌘,") }
                    .buttonStyle(MenuBarItemStyle())
                MenuBarItem(title: "Quit Cria", shortcut: "⌘Q") { NSApplication.shared.terminate(nil) }
            }
        }
        .padding(8)
        .frame(width: 330)
        .onAppear { quickAddShortcut = KeyboardShortcuts.getShortcut(for: .quickAdd)?.description }
    }
}

/// One menu-style row of the popover.
private struct MenuBarItem: View {
    let title: String
    var shortcut: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) { MenuBarItemLabel(title: title, shortcut: shortcut) }
            .buttonStyle(MenuBarItemStyle())
    }
}

private struct MenuBarItemLabel: View {
    let title: String
    var shortcut: String?

    var body: some View {
        HStack {
            Text(title)
            Spacer()
            if let shortcut { Text(shortcut).foregroundStyle(MacTheme.label3) }
        }
        .font(.system(size: 13))
        .padding(.horizontal, 8)
        .frame(height: 24)
        .contentShape(Rectangle())
    }
}

/// Highlights the row under the pointer, as a menu does.
private struct MenuBarItemStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        MenuBarItemBody(configuration: configuration)
    }
}

private struct MenuBarItemBody: View {
    let configuration: ButtonStyleConfiguration
    @State private var hovering = false
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        configuration.label
            .foregroundStyle(isEnabled ? Color(.foreground) : MacTheme.label3)
            .background(
                hovering && isEnabled ? MacTheme.fill : Color.clear,
                in: RoundedRectangle(cornerRadius: 6, style: .continuous)
            )
            .onHover { hovering = $0 }
    }
}

private struct MacTodayList: View {
    let services: AppServices
    @State private var live: LiveValue<[TaskListItem]>
    @State private var failure: String?
    @State private var newTitle = ""
    @Environment(\.playsCompletionSound) private var playsSound
    @Environment(\.preferences) private var preferences
    @Environment(\.dateDisplay) private var dateDisplay

    init(services: AppServices) {
        self.services = services
        let store = services.store
        _live = State(initialValue: LiveValue(initial: []) {
            observeStore(store, kinds: [.tasks]) { (reading: CriaStore) throws -> [TaskListItem] in
                try reading.smartGroups(.today).flatMap(\.items).filter { !$0.task.done }
            }
        })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text("Today").font(.custom(Theme.brandFont, size: 17)).tracking(-0.34)
                Spacer()
                Text("\(live.value.count) left").font(.system(size: 12)).foregroundStyle(MacTheme.label2)
            }
            .padding(.horizontal, 6)
            .padding(.top, 2)
            newTaskField
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if live.value.isEmpty {
                        Text("Nothing due.")
                            .font(.system(size: 13))
                            .foregroundStyle(MacTheme.label2)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 6)
                    }
                    ForEach(live.value, id: \.task.localId) { item in
                        row(item.task)
                    }
                }
            }
            .frame(maxHeight: 280)
            .fixedSize(horizontal: false, vertical: true)
            if let failure {
                Text(failure).font(.system(size: 11)).foregroundStyle(Color(.destructive)).padding(.horizontal, 6)
            }
        }
        .task { await live.run() }
    }

    /// "New task for today": Return adds it to Inbox, due today.
    private var newTaskField: some View {
        HStack(spacing: 8) {
            Image(systemName: "plus").font(.system(size: 12, weight: .semibold)).foregroundStyle(Color(.primary))
            TextField("New task for today", text: $newTitle)
                .textFieldStyle(.plain)
                .font(.system(size: 13))
                .onSubmit(addToday)
        }
        .padding(.horizontal, 10)
        .frame(height: 32)
        .background(MacTheme.fill, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .focusEffectDisabled()
    }

    private func row(_ task: TaskRecord) -> some View {
        HStack(spacing: 10) {
            Button {
                complete(task)
            } label: {
                Circle()
                    .strokeBorder(ThemeToken.priority(task.priority).map { Color($0) } ?? MacTheme.label3, lineWidth: 1.5)
                    .frame(width: 16, height: 16)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Complete \(task.title)")
            Text(task.title).font(.system(size: 13)).lineLimit(1)
            Spacer(minLength: 6)
            if let due = task.dueDate, DueDates.hasTimeOfDay(due), let date = DueDates.parse(due) {
                Text(DueDates.timeLabel(date, display: dateDisplay))
                    .font(.system(size: 11))
                    .foregroundStyle(DueDates.isOverdue(due, now: Date()) ? MacTheme.coral : MacTheme.label3)
            }
        }
        .padding(.horizontal, 8)
        .frame(height: 28)
    }

    private func addToday() {
        let title = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { return }
        let projects = ProjectTree.visible((try? services.store.projects()) ?? [])
        guard let inbox = pickFallbackProjectId(
            projects: projects, selectedLocalId: services.rememberedDefaultProjectLocalId(), defaultServerProjectId: nil
        ) else {
            failure = "Choose a project first."
            return
        }
        let input = TaskInput(title: title, projectLocalId: inbox, dueDate: DueDates.allDayISO(for: Date()))
        do {
            _ = try services.store.createTask(input)
            newTitle = ""
            failure = nil
        } catch {
            failure = "Could not add \u{201C}\(title)\u{201D}: \(error)"
        }
    }

    private func complete(_ task: TaskRecord) {
        do {
            // The popover has no toast: the step waits for the main window, which shows Undo when it is up.
            PendingUndo.save(try services.store.updateTaskUndoable(localId: task.localId, patch: TaskPatch(done: true)))
            NotificationCenter.default.post(name: .criaPendingUndo, object: nil)
            failure = nil
            if playsSound { CompletionSound.play(preferences.custom.completionTone) }
        } catch {
            failure = "Could not complete \u{201C}\(task.title)\u{201D}: \(error)"
        }
    }
}
