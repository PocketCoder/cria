#if os(macOS)
import CriaKit
import SwiftUI

/// The Search results scope on the Mac.
enum MacSearchScope: String, CaseIterable, Identifiable {
    case open = "Open", done = "Done", all = "All"
    var id: String { rawValue }
}

/// The design's Search results screen: "Results for “milk”" with the task and project counts and the Open, Done and
/// All scope, then Projects (colour dot rows), Labels, Filters and Tasks groups, or "No matching tasks".
extension SearchScreen {
    func macScoped(_ tasks: [TaskListItem]) -> [TaskListItem] {
        switch scope {
        case .open: return tasks.filter { !$0.task.done || recent.contains($0.task.localId) }
        case .done: return tasks.filter(\.task.done)
        case .all: return tasks
        }
    }

    var macList: some View {
        let tasks = macScoped(results.tasks)
        let hasQuery = !text.trimmingCharacters(in: .whitespaces).isEmpty
        return List {
            if hasQuery {
                MacContentHeader(title: "Results for “\(text)”", subtitle: macSubtitle(tasks: tasks.count)) {
                    Picker("Scope", selection: $scope) {
                        ForEach(MacSearchScope.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .fixedSize()
                }
                .asListRow()
                filterChips
            }
            if !results.projects.isEmpty {
                Section {
                    ForEach(results.projects, id: \.localId) { project in
                        NavigationLink(value: Route.project(project.localId)) {
                            MacSearchPlaceRow(title: project.title) {
                                Circle().fill(Color(hexString: project.hexColor) ?? MacTheme.label3).frame(width: 10, height: 10)
                            }
                        }
                        .macSearchRow()
                    }
                } header: { MacGroupHeader(title: "Projects") }
            }
            if !results.labels.isEmpty {
                Section {
                    ForEach(results.labels, id: \.localId) { label in
                        NavigationLink(value: Route.label(label.localId)) {
                            MacSearchPlaceRow(title: label.title) {
                                Image(systemName: "tag").font(.system(size: 11))
                                    .foregroundStyle(Color(hexString: label.hexColor) ?? MacTheme.label2)
                            }
                        }
                        .macSearchRow()
                    }
                } header: { MacGroupHeader(title: "Labels") }
            }
            if !results.filters.isEmpty {
                Section {
                    ForEach(results.filters, id: \.serverId) { filter in
                        NavigationLink(value: Route.savedFilter(filter.serverId)) {
                            MacSearchPlaceRow(title: filter.title) {
                                Image(systemName: "line.3.horizontal.decrease.circle").font(.system(size: 11))
                                    .foregroundStyle(MacTheme.label2)
                            }
                        }
                        .macSearchRow()
                    }
                } header: { MacGroupHeader(title: "Filters") }
            }
            if !tasks.isEmpty {
                Section {
                    ForEach(tasks, id: \.task.localId) { item in
                        TaskRowLink(
                            services: services, item: item, showProject: true,
                            tree: TaskRowTree(parentTitle: parentTitles[item.task.localId])
                        )
                    }
                    .environment(\.completionGroup, CompletionGroup(key: "tasks", label: "Tasks"))
                } header: { MacGroupHeader(title: "Tasks") }
            } else if hasQuery {
                MacEmptyState(
                    systemImage: "magnifyingglass", title: "No matching tasks",
                    message: "Try another word, or switch the scope to All."
                )
            }
        }
        .environment(\.recentlyCompleted, recent)
    }

    /// "3 tasks · 1 project".
    private func macSubtitle(tasks: Int) -> String {
        let projects = results.projects.count
        return (tasks == 1 ? "1 task" : "\(tasks) tasks") + " · " + (projects == 1 ? "1 project" : "\(projects) projects")
    }
}

/// A Projects, Labels or Filters result: 34pt high, the mark then the title, with the row's hover fill.
private struct MacSearchPlaceRow<Mark: View>: View {
    let title: String
    @ViewBuilder let mark: () -> Mark
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 10) {
            mark().frame(width: 18)
            Text(title).font(.system(size: 13)).foregroundStyle(Color(.foreground)).lineLimit(1)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .frame(height: 34)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(hovering ? MacTheme.fill : .clear))
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
    }
}

private extension View {
    /// The task rows' insets, no separators.
    func macSearchRow() -> some View {
        listRowSeparator(.hidden)
            .listRowInsets(EdgeInsets(top: 1, leading: 10, bottom: 1, trailing: 10))
    }
}

/// The design's empty state (`Empty`): a 26pt symbol in a 56pt accent tile (radius 18), the title in SF 15
/// Semibold and a line of secondary text, 80pt clear above and below.
struct MacEmptyState: View {
    let systemImage: String
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: 0) {
            Image(systemName: systemImage)
                .font(.system(size: 26))
                .foregroundStyle(Color(.primary))
                .frame(width: 56, height: 56)
                .background(MacTheme.selection, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .padding(.bottom, 14)
                .accessibilityHidden(true)
            Text(title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color(.foreground))
                .accessibilityAddTraits(.isHeader)
            Text(message)
                .font(.system(size: 13))
                .foregroundStyle(MacTheme.label2)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 280)
                .padding(.top, 4)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 80)
        .listRowSeparator(.hidden)
        .listRowBackground(Color.clear)
    }
}
#endif
