import CriaKit
import SwiftUI

/// Today's empty state: "Nothing left today", a picker to pull a task due this week forward, and a few things to work
/// on. Shown in place of the task rows when no open task is due. Ported from `NothingDue` in the desktop app.
struct TodayEmptyView: View {
    let services: AppServices
    @State private var live: LiveValue<TodayEmptyData>
    @State private var picking = false
    @State private var failure: String?
    @Environment(\.dateDisplay) private var dateDisplay

    init(services: AppServices) {
        self.services = services
        let store = services.store
        _live = State(initialValue: LiveValue(initial: TodayEmptyData()) {
            observeStore(store, kinds: [.tasks, .projects]) { reading in try reading.todayEmptyData() }
        })
    }

    private var data: TodayEmptyData { live.value }

    var body: some View {
        Section {
            VStack(spacing: 10) {
                #if os(macOS)
                // The macOS design's empty state: a sun in a soft accent tile, then the line and the ⌘N hint.
                Image(systemName: "sun.max")
                    .font(.system(size: 26))
                    .foregroundStyle(Color(.primary))
                    .frame(width: 56, height: 56)
                    .background(MacTheme.selection, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    // 14pt to the title and 4pt from it to the line, within the stack's 10pt spacing.
                    .padding(.bottom, 4)
                    .accessibilityHidden(true)
                Text("All clear for today")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color(.foreground))
                    .accessibilityAddTraits(.isHeader)
                Text("Nothing due. Press ⌘N to add something, or enjoy the quiet.")
                    .font(.system(size: 13))
                    .foregroundStyle(MacTheme.label2)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 280)
                    .padding(.top, -6)
                #else
                Image(systemName: "party.popper")
                    .font(.largeTitle)
                    .foregroundStyle(Color(.primary))
                    .accessibilityHidden(true)
                Text("Nothing left today")
                    .font(Theme.title)
                    .foregroundStyle(Color(.foreground))
                    .accessibilityAddTraits(.isHeader)
                Text(nextLine)
                    .font(Theme.rowSubtitle)
                    .foregroundStyle(Color(.mutedForeground))
                    .multilineTextAlignment(.center)
                #endif
                if !data.upcoming.isEmpty {
                    Button("Pull something forward") { picking = true }
                        .buttonStyle(.bordered)
                        .padding(.top, 4)
                }
            }
            .frame(maxWidth: .infinity)
            #if os(macOS)
            .padding(.vertical, 80)
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
            #else
            .padding(.vertical, 12)
            #endif
            // On the row, not the Section: a modifier on a Section is applied to every row in it.
            .task { await live.run() }
            .sheet(isPresented: $picking) {
                PullForwardSheet(items: data.upcoming) { ids in pull(ids) }
            }
            .errorHaptic(failure)
            .alert("Could not move", isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(failure ?? "")
            }
        }
        if !data.suggestions.isEmpty {
            Section {
                ForEach(data.suggestions, id: \.task.localId) { item in suggestionRow(item) }
            } header: {
                #if os(macOS)
                MacGroupHeader(title: "You could work on")
                #else
                Text("You could work on").font(Theme.headline).textCase(nil).foregroundStyle(Color(.foreground))
                    .accessibilityAddTraits(.isHeader)
                #endif
            }
        }
    }

    /// "2 done. Next up: Tomorrow." or, with nothing due in the coming week, "Nothing scheduled this week."
    private var nextLine: String {
        let done = data.doneToday > 0 ? "\(data.doneToday) done. " : ""
        guard let due = data.upcoming.first?.task.dueDate else { return done + "Nothing scheduled this week." }
        return done + "Next up: \(DueDates.label(due, now: Date(), display: dateDisplay))."
    }

    private func suggestionRow(_ item: TaskListItem) -> some View {
        Button { pull([item.task.localId]) } label: {
            HStack(spacing: 12) {
                Image(systemName: "plus.circle").foregroundStyle(Color(.primary)).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.task.title).font(Theme.rowTitle).foregroundStyle(Color(.foreground)).lineLimit(1)
                    Text(detail(item)).font(Theme.caption).foregroundStyle(Color(.mutedForeground)).lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint("Adds it to today")
    }

    private func detail(_ item: TaskListItem) -> String {
        let when = item.task.dueDate.map { "due \(DueDates.label($0, now: Date(), display: dateDisplay))" } ?? "no due date"
        return [item.projectTitle, when].compactMap { $0 }.joined(separator: " · ")
    }

    /// Moves each task to today. A timed due date keeps its time of day.
    private func pull(_ ids: [String]) {
        var failures: [String] = []
        for item in (data.upcoming + data.suggestions) where ids.contains(item.task.localId) {
            let patch = TaskPatch(dueDate: TodaySuggestions.pulledForward(item.task.dueDate, now: Date()))
            do {
                _ = try services.store.updateTask(localId: item.task.localId, patch: patch)
            } catch {
                failures.append("\(item.task.title): \(error)")
            }
        }
        if !failures.isEmpty { failure = failures.joined(separator: "\n") }
    }
}

/// A checklist of tasks due in the coming week; the ticked ones move to today.
struct PullForwardSheet: View {
    let items: [TaskListItem]
    let onConfirm: ([String]) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dateDisplay) private var dateDisplay
    @State private var chosen: Set<String> = []

    var body: some View { sheetContent.macSheetFrame() }

    @ViewBuilder private var sheetContent: some View {
        NavigationStack {
            List(items, id: \.task.localId) { item in
                let picked = chosen.contains(item.task.localId)
                Button {
                    if picked { chosen.remove(item.task.localId) } else { chosen.insert(item.task.localId) }
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: picked ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(picked ? Color(.primary) : Color(.mutedForeground))
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.task.title).font(Theme.rowTitle).foregroundStyle(Color(.foreground)).lineLimit(1)
                            Text(detail(item)).font(Theme.caption).foregroundStyle(Color(.mutedForeground)).lineLimit(1)
                        }
                        Spacer(minLength: 0)
                    }
                    .contentShape(Rectangle())
                }
                .accessibilityAddTraits(picked ? .isSelected : [])
            }
            .criaSurface()
            .navigationTitle("Pull forward")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel", systemImage: "xmark") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(chosen.isEmpty ? "Move to today" : "Move \(chosen.count) to today", systemImage: "checkmark") {
                        onConfirm(Array(chosen))
                        dismiss()
                    }
                    .disabled(chosen.isEmpty)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func detail(_ item: TaskListItem) -> String {
        let when = item.task.dueDate.map { DueDates.label($0, now: Date(), display: dateDisplay) }
        return [item.projectTitle, when].compactMap { $0 }.joined(separator: " · ")
    }
}
