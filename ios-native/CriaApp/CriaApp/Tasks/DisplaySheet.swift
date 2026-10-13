import CriaKit
import SwiftUI

/// The Display sheet: show completed, group by, sort, and filters. Every change is saved at once, for this view only.
struct DisplaySheet: View {
    let display: DisplayModel
    let services: AppServices
    @AppStorage("cria.taskList.showDone") private var defaultShowDone = true
    @Environment(\.dismiss) private var dismiss
    @State private var draft: DisplayConfig
    @State private var labels: [LabelRecord] = []
    @State private var projects: [ProjectRecord] = []

    init(display: DisplayModel, services: AppServices) {
        self.display = display
        self.services = services
        _draft = State(initialValue: display.config)
    }

    private var sections: DisplaySections { display.sections }

    var body: some View { sheetContent.macSheetFrame() }

    @ViewBuilder private var sheetContent: some View {
        NavigationStack {
            List {
                if sections.completed {
                    Section {
                        Toggle("Show completed", isOn: Binding(
                            get: { draft.showCompleted ?? defaultShowDone }, set: { draft.showCompleted = $0 }
                        ))
                    }
                }
                Section("Group and sort") {
                    if sections.groupings.count > 1 {
                        Picker("Group by", selection: $draft.groupBy) {
                            ForEach(sections.groupings, id: \.self) { Text($0.title).tag($0) }
                        }
                    }
                    Picker("Sort by", selection: $draft.sort) {
                        ForEach(DisplaySort.options, id: \.self) { Text($0.title).tag($0) }
                    }
                    .pickerStyle(.navigationLink)
                }
                filterSection
                if draft != DisplayConfig.defaults(for: display.key) {
                    Section {
                        Button("Reset to defaults", role: .destructive) { draft = DisplayConfig.defaults(for: display.key) }
                    }
                }
            }
            .criaSurface()
            .navigationTitle("Display")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done", systemImage: "checkmark") { dismiss() } }
            }
            .onChange(of: draft) { _, next in display.update { $0 = next } }
            .task {
                labels = (try? services.store.labels()) ?? []
                projects = ProjectTree.visible((try? services.store.projects()) ?? [])
            }
        }
        .presentationDetents([.medium, .large])
    }

    @ViewBuilder private var filterSection: some View {
        Section("Filter") {
            if sections.assignee {
                Picker("Assignee", selection: $draft.filters.assignee) {
                    ForEach(DisplayAssigneeFilter.allCases, id: \.self) { Text($0.title).tag($0) }
                }
            }
            if sections.dueDate { datePicker("Due date", selection: $draft.filters.dueDate) }
            if sections.deadline { datePicker("Deadline", selection: $draft.filters.deadline) }
            if sections.priority {
                multiLink(
                    "Priority", selection: $draft.filters.priorities,
                    options: [5, 4, 3, 2, 1, 0].map { DisplayChoice(id: $0, title: Self.priorityTitle($0)) }
                )
            }
            if sections.label {
                multiLink(
                    "Label", selection: $draft.filters.labelIds,
                    options: labels.map { DisplayChoice(id: $0.localId, title: $0.title) }
                )
            }
            if sections.project {
                multiLink(
                    "Project", selection: $draft.filters.projectIds,
                    options: projects.map { DisplayChoice(id: $0.localId, title: $0.title) }
                )
            }
        }
    }

    private func datePicker(_ title: String, selection: Binding<DisplayDateFilter>) -> some View {
        Picker(title, selection: selection) {
            ForEach(DisplayDateFilter.allCases, id: \.self) { Text($0.title).tag($0) }
        }
    }

    private func multiLink<ID: Hashable>(
        _ title: String, selection: Binding<Set<ID>>, options: [DisplayChoice<ID>]
    ) -> some View {
        NavigationLink {
            DisplayMultiPicker(title: title, options: options, selection: selection)
        } label: {
            LabeledContent(title, value: Self.summary(selection.wrappedValue, options))
        }
    }

    private static func summary<ID: Hashable>(_ selected: Set<ID>, _ options: [DisplayChoice<ID>]) -> String {
        let names = options.filter { selected.contains($0.id) }.map(\.title)
        switch names.count {
        case 0: return selected.isEmpty ? "All" : "\(selected.count) selected"
        case 1: return names[0]
        default: return "\(names.count) selected"
        }
    }

    private static func priorityTitle(_ priority: Int) -> String {
        priority == 0 ? "No priority" : TableCells.priorityNames[priority]
    }
}

struct DisplayChoice<ID: Hashable>: Identifiable {
    let id: ID
    let title: String
}

/// A checklist for a multi-value filter. Nothing ticked means no constraint.
struct DisplayMultiPicker<ID: Hashable>: View {
    let title: String
    let options: [DisplayChoice<ID>]
    @Binding var selection: Set<ID>

    var body: some View {
        List {
            ForEach(options) { option in
                Button {
                    if selection.contains(option.id) { selection.remove(option.id) } else { selection.insert(option.id) }
                } label: {
                    HStack {
                        Text(option.title).foregroundStyle(Color(.foreground))
                        Spacer()
                        if selection.contains(option.id) {
                            Image(systemName: "checkmark").foregroundStyle(Color(.primary)).accessibilityHidden(true)
                        }
                    }
                }
                .accessibilityAddTraits(selection.contains(option.id) ? .isSelected : [])
            }
            if options.isEmpty {
                Text("Nothing to choose from yet.").foregroundStyle(Color(.mutedForeground))
            }
        }
        .criaSurface()
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !selection.isEmpty {
                ToolbarItem(placement: .primaryAction) { Button("Clear") { selection.removeAll() } }
            }
        }
    }
}
